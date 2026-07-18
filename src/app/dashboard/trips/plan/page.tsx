import { redirect } from 'next/navigation'

// The planner used to live at its own /dashboard/trips/plan sub-page; it now opens
// directly inside the Itineraries section (owner 2026-07-18). Keep this path as a
// permanent redirect so old bookmarks and deep links still land on the builder.
export default function TripPlanRedirect() {
  redirect('/dashboard/trips')
}
