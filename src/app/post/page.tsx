import { db } from '@/lib/db'
import type { Metadata } from 'next'
import type { SerializedCategory } from '@/lib/types'
import { Header } from '@/components/marketplace/header'
import { Footer } from '@/components/marketplace/footer'
import { PostWizard } from '@/components/marketplace/post-wizard'

// Categories change rarely and there's no per-user data here — cache the shell
// (ISR) so the tab opens from cache instead of a per-request DB fetch.
export const revalidate = 300
export const metadata: Metadata = { title: 'Post a listing | eno.vn' }

export default async function PostPage() {
  const categories = await db.category.findMany({ orderBy: { name: 'asc' } })
  const serialized: SerializedCategory[] = categories.map((c) => ({
    id: c.id, name: c.name, nameVi: c.nameVi, slug: c.slug, icon: c.icon,
    color: c.color as SerializedCategory['color'], description: c.description, verifiedCount: 0,
  }))

  return (
    <div className="flex min-h-screen flex-col blob-bg">
      <Header />
      <main className="flex-1 max-w-2xl mx-auto w-full px-3 sm:px-6 lg:px-8 pt-6 pb-12">
        <PostWizard categories={serialized} />
      </main>
      <Footer />
    </div>
  )
}
