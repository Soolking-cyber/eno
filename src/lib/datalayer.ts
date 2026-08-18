/**
 * PUSH A CONVERSION INTENT INTO THE GTM dataLayer.
 *
 * ⛔ THIS EXISTS BECAUSE THE SERVER EVENT MISSES THE VISITORS ADS ACTUALLY BUY. The e-visa
 * `InitiateCheckout` is sent from POST /api/visa/applications/start, so it only fires once an
 * application is really created — which requires the person to be SIGNED IN. Ad traffic is
 * overwhelmingly new visitors: they click the ad, land on the listing, tap "Apply in chat", and hit
 * a sign-in wall. No POST, no event, and Meta concludes the campaign converts nothing. The two
 * signals answer different questions and both are wanted:
 *   · dataLayer push  → INTENT, fires on the tap, signed in or not. What ads optimise on.
 *   · server CAPI     → an application really exists. The deeper, rarer, truer event.
 *
 * ⚠️ A CUSTOM EVENT, NOT A CSS-SELECTOR CLICK TRIGGER. GTM can trigger on a selector like
 * `div#contact > button`, and it would work until the next styling change silently unhooks the
 * campaign — with nothing failing, no test going red, and spend continuing. A named event is a
 * contract this repo controls; the class list is not.
 *
 * ⚠️ IT IS A NO-OP WHERE THERE IS NO CONTAINER, WHICH IS THE eno.vn CASE. `window.dataLayer` only
 * exists once GTM has loaded, and eno.vn ships no container at all (no GTM id in its env). The
 * optional-chained push means calling this on the marketplace does nothing rather than throwing —
 * so the same component can be shared by both editions without a gate.
 *
 * ⚠️ AND IT REPORTS NOTHING ABOUT THE PERSON. Only what they did and which listing — no id, no
 * email, no phone. The dataLayer is readable by every tag in the container, so anything put here is
 * effectively handed to whatever third party is configured in a web console.
 */
export type IntentEvent = 'apply_evisa_click' | 'start_itinerary_click'

export function pushIntent(event: IntentEvent, params: Record<string, string | undefined> = {}) {
  if (typeof window === 'undefined') return
  const dl = (window as unknown as { dataLayer?: unknown[] }).dataLayer
  if (!Array.isArray(dl)) return
  dl.push({ event, ...Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined)) })
}
