import { z } from 'zod'
import { db } from '@/lib/db'
import { getForumAuth } from '@/lib/forum/auth'
import { forumJson, forumPreflight, isAllowedForumOrigin } from '@/lib/forum/cors'
import { rateLimit } from '@/lib/ratelimit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

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
})

export function OPTIONS(request: Request) {
  return forumPreflight(request, 'GET, POST, OPTIONS')
}

export async function GET(request: Request) {
  const auth = await getForumAuth(request)
  if (!auth) return forumJson(request, { error: 'auth_required' }, { status: 401 }, 'GET, POST, OPTIONS')
  try {
    const itineraries = await db.itinerary.findMany({
      where: { profileId: auth.profile.id, status: { not: 'archived' } },
      take: 50,
      orderBy: { updatedAt: 'desc' },
      include: {
        dayPlans: { orderBy: { dayNumber: 'asc' } },
        stays: { orderBy: { position: 'asc' } },
      },
    })
    return forumJson(request, {
      itineraries: itineraries.map((item) => ({
        ...item,
        interests: JSON.parse(item.interests) as string[],
      })),
    }, undefined, 'GET, POST, OPTIONS')
  } catch (error) {
    if ((error as { code?: string }).code === 'P2021') {
      return forumJson(request, { error: 'itinerary_schema_not_ready' }, { status: 503 }, 'GET, POST, OPTIONS')
    }
    throw error
  }
}

export async function POST(request: Request) {
  if (!isAllowedForumOrigin(request)) return forumJson(request, { error: 'origin_not_allowed' }, { status: 403 }, 'GET, POST, OPTIONS')
  const auth = await getForumAuth(request)
  if (!auth) return forumJson(request, { error: 'auth_required' }, { status: 401 }, 'GET, POST, OPTIONS')
  const limit = await rateLimit('itinerary-save', auth.profile.id, 30, '1 h')
  if (!limit.success) return forumJson(request, { error: 'rate_limited' }, { status: 429 }, 'GET, POST, OPTIONS')
  const parsed = itinerarySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return forumJson(request, { error: 'invalid_itinerary', issues: parsed.error.issues }, { status: 400 }, 'GET, POST, OPTIONS')
  const input = parsed.data

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
      dayPlans: { create: input.dayPlans },
      stays: { create: input.stays },
    },
    include: {
      dayPlans: { orderBy: { dayNumber: 'asc' } },
      stays: { orderBy: { position: 'asc' } },
    },
  })
  return forumJson(request, {
    itinerary: { ...itinerary, interests: input.interests },
  }, { status: 201 }, 'GET, POST, OPTIONS')
}

