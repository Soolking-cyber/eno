import { z } from 'zod'
import { db } from '@/lib/db'
import { itineraryQuota } from '@/lib/itinerary-drafts'
import { getForumAuth } from '@/lib/forum/auth'
import { forumJson, forumPreflight, isAllowedForumOrigin } from '@/lib/forum/cors'
import { rateLimit } from '@/lib/ratelimit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const stopSchema = z.object({
  position: z.number().int().min(0).max(30),
  place: z.string().trim().min(1).max(180),
  name: z.string().trim().min(1).max(180),
  time: z.string().trim().max(40).nullable().optional(),
  details: z.string().trim().max(1000).nullable().optional(),
  // Bounds are the coordinate system's own, not Vietnam's — the guard against nonsense
  // coordinates belongs to the geo validator, which this route deliberately does not
  // duplicate. These only stop a wildly out-of-range number reaching the column.
  lat: z.number().min(-90).max(90).nullable().optional(),
  lng: z.number().min(-180).max(180).nullable().optional(),
  travelMinutes: z.number().int().min(0).max(10_000).nullable().optional(),
  estimatedCostVnd: z.number().int().min(0).max(1_000_000_000).nullable().optional(),
  bookingAdvice: z.string().trim().max(1000).nullable().optional(),
})

const daySchema = z.object({
  dayNumber: z.number().int().min(1).max(30),
  area: z.string().trim().min(1).max(120),
  areaVi: z.string().trim().max(120).nullable().optional(),
  title: z.string().trim().min(1).max(180),
  titleVi: z.string().trim().max(180).nullable().optional(),
  morning: z.string().trim().min(1).max(1000),
  morningVi: z.string().trim().max(1000).nullable().optional(),
  afternoon: z.string().trim().min(1).max(1000),
  afternoonVi: z.string().trim().max(1000).nullable().optional(),
  evening: z.string().trim().min(1).max(1000),
  eveningVi: z.string().trim().max(1000).nullable().optional(),
  // ⚠️ OPTIONAL, and it must stay optional: the forum runs its own copy of the builder against
  // this endpoint and sends no stops, so a required field here would 400 every save it makes.
  // Accepts EITHER a bare array (what an HTTP API should take, and what any external caller
  // would send) or Prisma's `{ create: [...] }`, which is what our own builders post — the same
  // payload doubles as Prisma input on the generate route's auto-save path. Normalised to an
  // array either way, so everything downstream sees one shape.
  stops: z.union([
    z.array(stopSchema).max(30),
    z.object({ create: z.array(stopSchema).max(30) }).transform((value) => value.create),
  ]).optional().default([]),
})

const staySchema = z.object({
  position: z.number().int().min(0).max(30),
  name: z.string().trim().min(1).max(180),
  nameVi: z.string().trim().max(180).nullable().optional(),
  area: z.string().trim().min(1).max(120),
  areaVi: z.string().trim().max(120).nullable().optional(),
  note: z.string().trim().max(1000).nullable().optional(),
  noteVi: z.string().trim().max(1000).nullable().optional(),
  estimatedNightly: z.number().int().min(0).max(1_000_000_000).nullable().optional(),
  currency: z.string().trim().length(3).default('VND'),
})

const itinerarySchema = z.object({
  title: z.string().trim().min(3).max(180),
  destinationId: z.string().trim().min(2).max(80),
  days: z.number().int().min(1).max(30),
  budgetId: z.string().trim().min(2).max(80),
  interests: z.array(z.string().trim().min(1).max(80)).max(20),
  status: z.enum(['draft', 'ready']).default('ready'),
  estimatedBudget: z.number().int().min(0).max(100_000_000_000).nullable().optional(),
  currency: z.string().trim().length(3).default('VND'),
  generatedAt: z.string().datetime().nullable().optional(),
  dayPlans: z.array(daySchema).max(30),
  stays: z.array(staySchema).max(30),
}).superRefine((value, context) => {
  if (value.dayPlans.length !== value.days) {
    context.addIssue({ code: 'custom', path: ['dayPlans'], message: 'dayPlans must match days' })
  }
  if (new Set(value.dayPlans.map((day) => day.dayNumber)).size !== value.dayPlans.length) {
    context.addIssue({ code: 'custom', path: ['dayPlans'], message: 'day numbers must be unique' })
  }
  // ItineraryStop is @@unique([dayId, position]); a duplicate position within one day would
  // otherwise surface as an opaque P2002 mid-transaction. Name the offending day in a 400.
  value.dayPlans.forEach((day, index) => {
    const positions = day.stops.map((stop) => stop.position)
    if (new Set(positions).size !== positions.length) {
      context.addIssue({ code: 'custom', path: ['dayPlans', index, 'stops'], message: 'stop positions must be unique within a day' })
    }
  })
})

// ⚠️ WS6 — NOT MIGRATED (all three exports): EVERY response this file returns is built by
// `forumJson`/`forumPreflight`, which set `Access-Control-Allow-Origin` (echoing the caller's
// origin), `Access-Control-Allow-Methods: GET, POST, OPTIONS`, `Access-Control-Allow-Headers:
// Authorization, Content-Type`, `Access-Control-Max-Age: 86400` and APPEND `Vary: Origin`
// (src/lib/forum/cors.ts:53-63). `apiFail()` and route()'s `NextResponse.json(data)` carry none of
// them, so every migrated branch — success and error alike — would lose those five headers, and a
// cross-origin caller's browser would then refuse to hand the body to the fetch that asked for it.
// OPTIONS additionally answers `new NextResponse(null, { status: 204 })` — a bodyless 204. (route()
// CAN return that, via the `data instanceof Response` escape hatch at handler.ts:232; an earlier
// draft said it could not. The reason to skip is simply that with auth, rateLimit and body all
// pinned in the handler, all four options are empty and the wrapper buys nothing.)
export function OPTIONS(request: Request) {
  return forumPreflight(request, 'GET, POST, OPTIONS')
}

// ⚠️ WS6 — NOT MIGRATED: every response carries the CORS headers `forumJson` attaches
// (src/lib/forum/cors.ts:53-63 — ACAO, ACAM, ACAH, Max-Age and an appended `Vary: Origin`), and
// `apiFail()` / `NextResponse.json` carry none. That alone is the blocker, on every branch.
//
// ⚠️ IT IS *NOT* THAT THE WRAPPER IS COOKIES-ONLY — an earlier draft said so and it is FALSE.
// `getCurrentProfile()` and `getCurrentProfileId()` both pass `bearerToken()` to Supabase
// (src/lib/admin.ts:78, :150, helper at :138), against the same project `getForumAuth` uses, so
// `auth: 'profile'` would answer a bearer-token caller 200 exactly as today, not 401. The review
// caught this by reading admin.ts; it matters because the false version made the fix look like two
// wrapper changes (CORS + a bearer mode) when the bearer half already ships.
export async function GET(request: Request) {
  const auth = await getForumAuth(request)
  if (!auth) return forumJson(request, { error: 'auth_required' }, { status: 401 }, 'GET, POST, OPTIONS')
  try {
    const itineraries = await db.itinerary.findMany({
      where: { profileId: auth.profile.id, status: { not: 'archived' } },
      take: 50,
      orderBy: { updatedAt: 'desc' },
      include: {
        dayPlans: { orderBy: { dayNumber: 'asc' }, include: { stops: { orderBy: { position: 'asc' } } } },
        stays: { orderBy: { position: 'asc' } },
      },
    })
    return forumJson(request, {
      itineraries: itineraries.map((item) => ({
        ...item,
        // Legacy rows may hold 'null'/non-array JSON — always ship an array.
        interests: ((v) => (Array.isArray(v) ? (v as string[]) : []))(JSON.parse(item.interests)),
      })),
    }, undefined, 'GET, POST, OPTIONS')
  } catch (error) {
    if ((error as { code?: string }).code === 'P2021') {
      return forumJson(request, { error: 'itinerary_schema_not_ready' }, { status: 503 }, 'GET, POST, OPTIONS')
    }
    throw error
  }
}

// ⚠️ WS6 — NOT MIGRATED: four blockers, any one of which is enough.
// · `isAllowedForumOrigin` runs BEFORE the caller is resolved and answers 403 `origin_not_allowed`.
//   route()'s order is auth → rateLimit → body, so a disallowed origin arriving without a session
//   would be answered `{"error":"auth_required"}` 401 instead of that 403.
// · the caller is `getForumAuth`, which on the bearer path builds its OWN Supabase client and
//   returns null when NEXT_PUBLIC_SUPABASE_URL / _PUBLISHABLE_KEY are absent
//   (src/lib/forum/auth.ts:31-33) — a fail-closed branch no wrapper mode has. It is NOT that the
//   wrapper cannot read a bearer token; it can. See the note on GET.
// · the limiter's key is `auth.profile.id`, which only exists after that helper has run, and its
//   throttled answer `{"error":"rate_limited"}` 429 still carries the CORS headers `apiFail()`
//   omits.
// · the validation failure is `{"error":"invalid_itinerary","issues":[…]}` at 400 — two keys.
//   `apiFail()` emits `{"error":"<code>"}` and nothing else, so `body:` would delete `issues`.
export async function POST(request: Request) {
  if (!isAllowedForumOrigin(request)) return forumJson(request, { error: 'origin_not_allowed' }, { status: 403 }, 'GET, POST, OPTIONS')
  const auth = await getForumAuth(request)
  if (!auth) return forumJson(request, { error: 'auth_required' }, { status: 401 }, 'GET, POST, OPTIONS')
  const limit = await rateLimit('itinerary-save', auth.profile.id, 30, '1 h')
  if (!limit.success) return forumJson(request, { error: 'rate_limited' }, { status: 429 }, 'GET, POST, OPTIONS')
  const parsed = itinerarySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return forumJson(request, { error: 'invalid_itinerary', issues: parsed.error.issues }, { status: 400 }, 'GET, POST, OPTIONS')
  const input = parsed.data

  // P2021 = table does not exist. GET already degrades to 503 that way; POST did not, so an
  // unpushed schema answered a save with an unhandled 500. That matters for THIS change in
  // particular: `Itinerary` is already live in prod while `ItineraryStop` is not until
  // `prisma db push` runs, so there is a real window where the parent exists and the child
  // does not. Reuses GET's error contract rather than inventing a second one.
  // ⚠️ THE CAP, AND THE OTHER CREATE PATH ENFORCES THE SAME ONE. A traveller may keep
  // MAX_SAVED_ITINERARIES trips; generate/route.ts calls the identical guard, because a ceiling on
  // one of two create paths is not a ceiling. Checked before the write rather than caught after:
  // there is no unique constraint expressing "at most N rows", so the row would simply be created.
  // 409, not 400: the request is well-formed and the ACCOUNT is in a state that refuses it — the
  // same reading of 409 the assistance routes use.
  const quota = await itineraryQuota(auth.profile.id)
  if (quota.full) {
    return forumJson(
      request,
      { error: 'itinerary_limit_reached', limit: quota.limit, used: quota.used },
      { status: 409 },
      'GET, POST, OPTIONS',
    )
  }

  try {
    const itinerary = await db.itinerary.create({
      data: {
        profileId: auth.profile.id,
        title: input.title,
        destinationId: input.destinationId,
        days: input.days,
        budgetId: input.budgetId,
        interests: JSON.stringify(input.interests),
        status: input.status,
        estimatedBudget: input.estimatedBudget ?? null,
        currency: input.currency,
        generatedAt: input.generatedAt ? new Date(input.generatedAt) : null,
        // Stops sit one level deeper, so the day rows can't go to Prisma as-is. `undefined`
        // rather than an empty create when a caller sent none — that caller is the forum's
        // builder, which must keep saving exactly as it does today.
        dayPlans: {
          create: input.dayPlans.map(({ stops, ...day }) => ({
            ...day,
            stops: stops.length ? { create: stops } : undefined,
          })),
        },
        stays: { create: input.stays },
      },
      include: {
        dayPlans: { orderBy: { dayNumber: 'asc' }, include: { stops: { orderBy: { position: 'asc' } } } },
        stays: { orderBy: { position: 'asc' } },
      },
    })
    return forumJson(request, {
      itinerary: { ...itinerary, interests: input.interests },
    }, { status: 201 }, 'GET, POST, OPTIONS')
  } catch (error) {
    if ((error as { code?: string }).code === 'P2021') {
      return forumJson(request, { error: 'itinerary_schema_not_ready' }, { status: 503 }, 'GET, POST, OPTIONS')
    }
    throw error
  }
}

