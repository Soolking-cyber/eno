// The phone's own browser reads back the step-1 answers a teacher left in an app's built-in browser (../route.ts), and
// once they are in its form says `done`, which drops them (src/lib/auth/carry.ts — a repeatable read, never a destructive
// one: a lost response or a reload must be able to ask again). A POST from the page's script, never a GET, so a link
// preview or a prefetch never touches it. `carry: null` when there is none (not yet written — the join form asks again
// for a while — dropped, or expired).
import { z } from 'zod'
import { route } from '@/lib/api/handler'
import { CARRY_TOKEN_RE, dropCarry, readCarry } from '@/lib/auth/carry'

export const dynamic = 'force-dynamic'

export const POST = route(
  {
    auth: 'public',
    // The page asks up to 13 times while the answers land (teacher-form.tsx CARRY_ASK_AT_MS), and carriers share IPs.
    rateLimit: { bucket: 'auth-carry-take', limit: 600, window: '10 m' },
    body: z.object({ t: z.string().regex(CARRY_TOKEN_RE), done: z.literal(true).optional() }),
  },
  async ({ body }) => {
    if (body.done) { await dropCarry(body.t); return { carry: null } }
    return { carry: await readCarry(body.t) }
  },
)
