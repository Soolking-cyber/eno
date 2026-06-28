import { redirect } from 'next/navigation'
import { db } from '@/lib/db'
import type { Metadata } from 'next'
import type { SerializedCategory } from '@/lib/types'
import { getCurrentProfileId } from '@/lib/admin'
import { Header } from '@/components/marketplace/header'
import { Footer } from '@/components/marketplace/footer'
import { PostWizard } from '@/components/marketplace/post-wizard'

// Per-user gate below → render dynamically (don't ISR-cache the shell).
export const dynamic = 'force-dynamic'
// noindex: a login-gated post form isn't a public landing page.
export const metadata: Metadata = { title: 'Post a listing | eno.vn', robots: { index: false, follow: false } }

export default async function PostPage() {
  // Require sign-in to post: a guest-posted listing would be orphaned — no owner
  // could edit/delete/mark-sold it, and buyer messages would reach no inbox.
  const pid = await getCurrentProfileId()
  if (!pid) redirect('/signin?next=/post')

  const categories = await db.category.findMany({ orderBy: { name: 'asc' } })
  const serialized: SerializedCategory[] = categories.map((c) => ({
    id: c.id, name: c.name, nameVi: c.nameVi, slug: c.slug, icon: c.icon,
    color: c.color as SerializedCategory['color'], description: c.description, verifiedCount: 0,
  }))

  return (
    <div className="flex min-h-screen flex-col blob-bg">
      <Header />
      <main id="main" tabIndex={-1} className="flex-1 max-w-7xl mx-auto w-full px-3 sm:px-6 lg:px-8 pt-6 pb-12">
        <PostWizard categories={serialized} />
      </main>
      <Footer />
    </div>
  )
}
