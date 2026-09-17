import { redirect } from 'next/navigation'

// ⚠️ THIS REDIRECT'S DESTINATION STILL WORKS, BUT ITS REASON CHANGED (owner, 2026-07-26:
// "this should be in chat experience only to plan a trip, and my trips page we have to have saved
// trips where they can manage"). It used to send people to /dashboard/trips BECAUSE the builder
// opened there. The builder is gone from that page; what is there now is the saved-trip list, whose
// empty state carries the link into the chat planner.
//
// So the redirect is kept and RE-AIMED at the same path for a different reason: an old bookmark
// lands on trip management and is offered the chat planner from there, rather than 404ing or
// arriving at a builder that no longer exists. The planner itself is not a page any more, so there
// is no deeper path to send them to.
export default function TripPlanRedirect() {
  redirect('/dashboard/trips')
}
