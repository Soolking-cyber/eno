import { redirect } from 'next/navigation'

// Account + dashboard were merged into a single hub at /dashboard ("one place to
// rule everything"). Keep this route as a redirect so old links/bookmarks land.
export default function AccountPage() {
  redirect('/dashboard')
}
