import type { Metadata } from 'next'
import Link from 'next/link'
import { cache } from 'react'
import { notFound, redirect } from 'next/navigation'
import { CalendarDays } from 'lucide-react'
import { db } from '@/lib/db'
import { HANDLE_RE } from '@/lib/handle'
import { getInitials } from '@/lib/utils'
import { Header } from '@/components/marketplace/header'
import { Footer } from '@/components/marketplace/footer'
import { Tr } from '@/context/language-context'

// eno.vn/@<handle> — the shareable Telegram-style URL for users and storefronts.
// This is a root-level dynamic segment, so it doubles as the catch-all for unknown
// top-level paths: anything that doesn't start with "@" (or doesn't resolve)
// 404s immediately. Static routes always win over this segment in Next routing.
//
// Resolution: shop handle → the storefront page; user handle → their storefront
// if they own one (the shop is the public destination), else a minimal profile
// card (name/avatar/member-since only — no contact info, noindex).

export const dynamic = 'force-dynamic'

type Props = { params: Promise<{ handle: string }> }

// Shared by generateMetadata + the page (one DB round-trip per request).
const resolve = cache(async (raw: string) => {
  const decoded = decodeURIComponent(raw)
  if (!decoded.startsWith('@')) return null
  const h = decoded.slice(1).toLowerCase()
  if (!HANDLE_RE.test(h)) return null
  return db.handle.findUnique({
    where: { handle: h },
    select: {
      handle: true,
      seller: { select: { id: true } },
      profile: {
        select: {
          displayName: true, avatarUrl: true, avatarColor: true, createdAt: true,
          seller: { select: { id: true } },
        },
      },
    },
  })
})

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { handle } = await params
  const row = await resolve(handle)
  if (!row || row.seller || row.profile?.seller) return {} // 404s and redirects need none
  return {
    title: `@${row.handle} | eno.vn`,
    description: `${row.profile?.displayName || `@${row.handle}`} on eno.vn`,
    // Member cards are not an SEO surface — people land here via shared links only.
    robots: { index: false, follow: false },
  }
}

export default async function HandlePage({ params }: Props) {
  const { handle } = await params
  const row = await resolve(handle)
  if (!row) notFound()

  // Storefront handle — or a user who owns a storefront: the shop page is the
  // public destination people mean when they share the link.
  if (row.seller) redirect(`/sellers/${row.seller.id}`)
  if (row.profile?.seller) redirect(`/sellers/${row.profile.seller.id}`)
  if (!row.profile) notFound()

  const name = row.profile.displayName || `@${row.handle}`
  const memberYear = new Date(row.profile.createdAt).getFullYear()

  return (
    <div className="flex min-h-screen flex-col blob-bg">
      <Header />
      <main id="main" tabIndex={-1} className="flex-1 max-w-7xl mx-auto w-full px-3 sm:px-6 lg:px-8 pt-10 pb-12">
        <div className="mx-auto max-w-md rounded-2xl bg-card p-8 text-center shadow-xs">
          {row.profile.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={row.profile.avatarUrl} alt="" className="mx-auto h-24 w-24 rounded-full object-cover" />
          ) : (
            <span
              className="mx-auto flex h-24 w-24 items-center justify-center rounded-full text-3xl font-bold text-white"
              style={{ backgroundColor: row.profile.avatarColor }}
            >
              {getInitials(name)}
            </span>
          )}
          <h1 className="mt-4 text-xl font-bold text-foreground">{name}</h1>
          <p className="mt-0.5 text-sm font-semibold text-accent-foreground">@{row.handle}</p>
          <p className="mt-3 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <CalendarDays className="h-3.5 w-3.5" /> <Tr text="Member since" /> {memberYear}
          </p>
          <p className="mt-6 text-sm leading-relaxed text-body">
            <Tr text="This member hasn't opened a shop yet. Browse the marketplace to see what's for sale." />
          </p>
          <Link
            href="/"
            className="mt-4 inline-block rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-white transition-transform active:scale-95"
          >
            <Tr text="Explore listings" />
          </Link>
        </div>
      </main>
      <Footer />
    </div>
  )
}
