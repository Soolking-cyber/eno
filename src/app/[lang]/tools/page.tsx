import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Header } from '@/components/marketplace/header'
import { Footer } from '@/components/marketplace/footer'
import { T, toolPageMetadata } from '@/components/marketplace/rent-tool-page'
import { IS_SERVICES } from '@/lib/edition'
import { RENT_TOOLS, RENT_TOOL_SLUGS, rentToolPath } from '@/lib/rent-tools/registry'
import { liveTools, toolPath } from '@/lib/tools/content'
import { ViTwinLink } from '@/components/marketplace/vi-twin-link'

/**
 * /tools (and /vi/tools): every tool on eno.vn — the four rent tools written by hand, then the ones eno Reach wrote and a person
 * approved (src/lib/tools/registry.ts), oldest first. With none of those it still lists the four, so it is never an empty page.
 * MARKETPLACE ONLY, like every tool: the services build answers 404.
 */
export const revalidate = 3600

const META = {
  title: { en: 'Tools for renting, buying and moving in Vietnam', vi: 'Công cụ tính toán khi thuê, mua và chuyển nhà ở Việt Nam' },
  description: {
    en: 'Calculators that run in your browser on your own figures: rent against income, cash at signing, homes compared, prices read, and more.',
    vi: 'Các công cụ tính ngay trên trình duyệt từ số liệu của bạn: tiền thuê so với thu nhập, tiền cần khi ký, so sánh các căn, đọc giá và hơn nữa.',
  },
}
// Past 20 characters (Seobility crawl 4, 2026-11-25: "Tools" was an H1 too short, one word), in the <title>'s own words.
const H1 = { en: 'Tools for renting, buying and moving', vi: 'Công cụ khi thuê, mua và chuyển nhà' }
const INTRO = {
  // "These tools": the H1's "Tools" is in the text (Seobility crawl 9, H1 words not in the page's text).
  en: 'These tools work on the figures you type and nothing else: nothing is stored or sent, and none of them assumes what is usual.',
  vi: 'Mỗi công cụ chỉ tính từ số liệu bạn nhập: không lưu hay gửi đi đâu, và không giả định mức nào là phổ biến.',
}

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  // The page is a 404 on eno.forum (below); its head must not carry eno.vn's canonical and title into that 404 (Opus gate 2026-11-23).
  if (IS_SERVICES) return {}
  const { lang } = await params
  return toolPageMetadata('/tools', lang, META)
}

export default async function ToolsHub({ params }: { params: Promise<{ lang: string }> }) {
  if (IS_SERVICES) notFound()
  const { lang } = await params
  const rows = [
    ...RENT_TOOL_SLUGS.map((s) => ({ href: rentToolPath(s, lang), label: RENT_TOOLS[s].label, blurb: RENT_TOOLS[s].blurb })),
    ...liveTools().map(({ spec }) => ({ href: toolPath(spec.slug, lang), label: spec.title, blurb: spec.description })),
  ]
  return (
    <div className="flex min-h-page flex-col blob-bg">
      <Header />
      <main id="main" tabIndex={-1} className="flex-1 max-w-7xl mx-auto w-full px-3 sm:px-6 lg:px-8 pt-10 pb-16">
        <h1 className="h-display text-pretty text-foreground"><T c={H1} /></h1>
        <p className="mt-4 max-w-prose text-base leading-relaxed text-body"><T c={INTRO} /></p>
        <ul className="mt-8 max-w-3xl divide-y divide-border">
          {rows.map((r) => (
            <li key={r.href} className="py-4">
              <Link href={r.href} className="text-lg font-bold text-accent-foreground hover:underline"><T c={r.label} /></Link>
              <p className="mt-1 text-base leading-relaxed text-body"><T c={r.blurb} /></p>
            </li>
          ))}
        </ul>
        <ViTwinLink path="/tools" lang={lang} name={H1.vi} />
      </main>
      <Footer />
    </div>
  )
}
