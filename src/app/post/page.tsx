import { db } from '@/lib/db'
import type { Metadata } from 'next'
import type { SerializedCategory } from '@/lib/types'
import { Header } from '@/components/marketplace/header'
import { Footer } from '@/components/marketplace/footer'
import { PostWizard } from '@/components/marketplace/post-wizard'
import { serializeCategoryBasic } from '@/lib/serialize'

export const metadata: Metadata = { title: 'Post a listing | eno.vn', robots: { index: false, follow: false } }

// Draft-first posting: ANYONE can fill the wizard (photos, AI-ready fields, price);
// sign-in is asked at Publish, after the sunk cost — the proven marketplace pattern.
// The server still owns safety: /api/listings, /api/upload and the AI routes are all
// auth-gated + rate-limited, and the wizard never fires them for guests.
export default async function PostPage() {
  const categories = await db.category.findMany({ orderBy: { name: 'asc' } })
  const serialized: SerializedCategory[] = categories.map(serializeCategoryBasic)

  return (
    <div className="flex min-h-screen flex-col blob-bg">
      <Header />
      <main id="main" tabIndex={-1} className="flex-1 max-w-7xl mx-auto w-full px-3 sm:px-6 lg:px-8 pt-6 pb-12">
        {/* The wizard is fully client-side — without JS the page is blank. noscript
            can't run the language hook, so static EN + VI. */}
        <noscript>
          {/* No JS ⇒ no client i18n — deliberately static bilingual copy. */}
          {/* eslint-disable react/jsx-no-literals */}
          <div className="mx-auto mb-6 max-w-xl rounded-xl bg-warning/10 px-4 py-3 text-center text-sm text-foreground">
            <p className="font-semibold">Posting a listing needs JavaScript enabled.</p>
            <p>Đăng tin cần bật JavaScript trong trình duyệt.</p>
          </div>
          {/* eslint-enable react/jsx-no-literals */}
        </noscript>
        <PostWizard categories={serialized} />
      </main>
      <Footer />
    </div>
  )
}
