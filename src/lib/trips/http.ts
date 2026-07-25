import type { AssistanceError } from './assistance'

/**
 * The ONE mapping from a lifecycle error to an HTTP status.
 *
 * It lives here rather than in each route so the two assistance routes cannot answer differently
 * for the same condition — the failure mode being avoided is a client that treats 'forbidden' as
 * retryable on one path and terminal on the other.
 *
 * Kept OUT of assistance.ts on purpose: that module is the domain, and HTTP is a transport it
 * should not know about. Here it sits beside the domain without being part of it.
 */
const STATUS: Record<AssistanceError, number> = {
  // Not signed in at all — the client should send the user to sign in, not retry.
  not_signed_in: 401,
  // Signed in, but not this traveller's case — AND ALSO the answer for a case that does not
  // exist. That collapse happens in the domain (viewAssistance / transitionAsTraveller), not
  // here, and it is load-bearing: mapping 'request_not_found' to 404 while 'forbidden' is 403
  // made this map an EXISTENCE ORACLE, because a signed-in stranger could tell real case ids
  // from fake ones by the status alone. Both external reviewers found it independently, against
  // an earlier version of this very comment claiming the endpoint disclosed nothing.
  forbidden: 403,
  itinerary_not_found: 404,
  // Still mapped, and still reachable — but only on paths where the caller has ALREADY been
  // authorised (the admin actions), so it cannot be used to probe for ids.
  request_not_found: 404,
  invalid_amount: 400,
  // 409, not 400: the request was well-formed, the CASE is in a state that refuses it. A client
  // fixes this by reloading, not by editing the payload.
  invalid_status_transition: 409,
  case_changed_reload: 409,
  update_failed: 500,
}

export function assistanceHttpStatus(error: AssistanceError): number {
  return STATUS[error] ?? 500
}
