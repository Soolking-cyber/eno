/**
 * WHERE THE THREAD COMPOSER'S TEXT GOES — ONE ANSWER FOR BOTH WAYS OF SENDING IT.
 *
 * The composer has two entry points: Return (ChatComposer's `onSend`) and the tap-Send button.
 * They used to carry their own copies of this decision, and the copies drifted: Return honoured the
 * armed TRIP concierge, the tap did not, so on a phone — where the tap is the primary path — a
 * traveller's question went to the human desk as a plain message while the placeholder still read
 * "Ask Eno concierge…". Both entry points now ask this function, so they cannot disagree again.
 *
 * ⚠️ THE ORDER IS FIXED AND WRITTEN OUT. A thread is one kind, so the visa and trip flags are never
 * both true; the explicit order is there so a future third desk has an obvious place to go and can
 * never silently steal the other desks' questions.
 *
 * Pure on purpose: messages/[id]/page.tsx is a Next page module and may not export helpers, and a
 * pure function is testable without booting the page.
 */
export type SendRoute = 'concierge' | 'trip' | 'send'

export function routeSend({
  conciergeArmed,
  tripConciergeArmed,
}: {
  /** The VISA desk's assistant is armed on this thread. */
  conciergeArmed: boolean
  /** The TRIP desk's assistant is armed on this thread. */
  tripConciergeArmed: boolean
}): SendRoute {
  if (conciergeArmed) return 'concierge'
  if (tripConciergeArmed) return 'trip'
  return 'send'
}
