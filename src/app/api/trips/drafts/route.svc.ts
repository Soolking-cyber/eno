import { NextResponse } from 'next/server'
import { getCurrentProfile } from '@/lib/admin'
import { listItineraryDrafts, MAX_SAVED_ITINERARIES } from '@/lib/itinerary-drafts'

/**
 * The saved trips a traveller can pick from, and how many slots are left.
 *
 * ⚠️ READ-ONLY, AND SCOPED TO THE SESSION. There is no id in the path and none accepted in a query
 * string: the profile comes from getCurrentProfile() inside the handler, so there is nothing for a
 * caller to substitute. That is the same rule the assistance module states for every one of its
 * functions — an identity is never an argument — and it is why this endpoint needs no ownership
 * check of its own. Answering only ever about yourself is a stronger guarantee than checking that
 * the id you were given is yours.
 *
 * ⚠️ 401 AND NOTHING ELSE for a signed-out caller. No "which kind of user are you" distinction, and
 * no empty-list-for-strangers, because either would let an unauthenticated probe learn something.
 *
 * The counts come back with the list deliberately: the picker has to render "2 of 3 saved" and the
 * remaining-slots number, and computing that client-side from `drafts.length` would silently go
 * wrong the moment the list is ever paginated or filtered.
 *
 * ⚠️ WS6 — NOT MIGRATED: TWO INDEPENDENT WIRE FACTS, either one sufficient.
 *   1. A guest gets `{"error":"not_signed_in"}` 401. The wrapper's `auth: 'profile'` branch is a
 *      hardcoded `apiFail('auth_required', 401)` (src/lib/api/handler.ts:195) — same status, a
 *      different body, and it is the string the paragraph above treats as the whole answer.
 *   2. The 503 degraded branch is a DOMAIN payload, not an error envelope:
 *      `{"drafts":[],"used":0,"limit":3,"remaining":3,"degraded":true}`. `apiFail()` can only emit
 *      `{"error":"<code>"}`, so that shape can only survive as a hand-built `NextResponse`.
 * The 200 also carries `cache-control: private, no-store`, which would need route()'s Response
 * pass-through rather than a returned object. With auth pinned, there is no limiter and no JSON
 * body to hoist either — all four options empty, so this is churn on top of a wire change.
 */
export async function GET() {
  const profile = await getCurrentProfile()
  if (!profile) return NextResponse.json({ error: 'not_signed_in' }, { status: 401 })

  try {
    const payload = await listItineraryDrafts(profile.id)
    return NextResponse.json(payload, {
      // A traveller's own drafts: never cached by a shared cache, and revalidated on every open.
      headers: { 'cache-control': 'private, no-store' },
    })
  } catch (e) {
    // Degrade rather than 500: the picker can say "couldn't load your trips" and still let the
    // traveller start a new one, which is the more useful failure.
    console.error('[trips/drafts] list', e)
    return NextResponse.json(
      { drafts: [], used: 0, limit: MAX_SAVED_ITINERARIES, remaining: MAX_SAVED_ITINERARIES, degraded: true },
      { status: 503 },
    )
  }
}
