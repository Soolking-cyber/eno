import { route } from '@/lib/api/handler'
import { ADMIN_USER_FILTERS, searchAdminUsers, type AdminUserFilter } from '@/lib/admin-users'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// The Users console's list: search by email, name, phone, id or storefront name; filter by what
// needs attention. `auth: 'admin'` — the page gate is UX, this is the boundary.
export const GET = route({ auth: 'admin' }, async ({ req }) => {
  const url = new URL(req.url)
  const filter = url.searchParams.get('filter') ?? 'all'
  return searchAdminUsers({
    q: url.searchParams.get('q') ?? '',
    filter: (ADMIN_USER_FILTERS as readonly string[]).includes(filter) ? (filter as AdminUserFilter) : 'all',
    cursor: url.searchParams.get('cursor'),
  })
})
