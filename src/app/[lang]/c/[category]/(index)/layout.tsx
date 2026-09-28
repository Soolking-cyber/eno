import { notFound } from 'next/navigation'
import Link from 'next/link'
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from '@/components/ui/breadcrumb'
import { Header } from '@/components/marketplace/header'
import { Footer } from '@/components/marketplace/footer'
import { Bilingual } from '@/components/marketplace/bilingual'
import { Tr } from '@/context/language-context'
import { getCategoryRow } from '../load-category'
import { loadRentalsHeadline } from '../category-data'
import { RentalsHeading } from '../category-text'
import { CategoryLedeBlock } from './category-lede-block'
import { LEDE_PLACEMENT } from './lede-placement'

/**
 * ⛔ THE CATEGORY PAGE'S HEADER, BREADCRUMB, H1 AND LEDE RENDER HERE, ABOVE `(index)/loading.tsx`, SO
 * THAT CRAWLERS CAN READ THEM. A loading file wraps its page in a Suspense boundary, and React moves a
 * finished boundary over 500 B into `<div hidden id="S:0">` at the end of the body whenever the shell's
 * bytes plus the boundary's pass 12,800 B — always, on this page, cached HTML and bots included (the
 * rule and its source lines are in src/app/[lang]/crawler-visible-html-contract.test.ts). Before SEO
 * wave B, H1b, the page rendered all of this itself, inside the boundary: Googlebot, OAI-SearchBot,
 * PerplexityBot and bingbot got the H1 under `[hidden]`, the header and `<main>` twice (the skeleton's
 * and the page's), and as visible text only the skeleton's header and footer. A loading file never
 * wraps the layout in its own folder, so what renders here is in place in the first chunk.
 * The grid keeps its skeleton (owner's hybrid, 2026-09-27); only the listing page lost its skeleton.
 *
 * ⛔ ITS OWN CODE AWAITS THE CATEGORY ROW AND, ON /c/rentals, THE CACHED HEADLINE VARIANT — NEVER A COUNT.
 * Whatever this layout awaits delays the whole first chunk (the Header, the CSS, the H1 and the
 * skeleton below it), and, because the `[category]` param changes, every soft navigation from one
 * category to another. The row is one `findUnique` on a unique column, shared with `../layout.tsx` by
 * `cache()`; the rentals variant comes from `loadRentalsHeadline` (category-data.ts), cached across
 * renders, and the `<title>` is built from the same value. The counts live in
 * `category-lede-block.tsx`; the contract test fails if this file awaits anything but the params, the
 * row and the headline.
 * ⚠️ THE LEDE IS THE ONE EXCEPTION, AND IT IS MEASURED. `LEDE_PLACEMENT` (lede-placement.ts, decision
 * H-c) says where it renders, and since H1b it says 'layout': `<CategoryLedeBlock>` renders under the H1
 * here, so crawlers read it too, and the shell waits on its COUNT (and on /c/rentals the three rentals
 * reads) on a cold render and on every category-to-category navigation. The H-gate measured that
 * against the build before H1b and found no regression (numbers in lede-placement.ts); the reads are
 * the same `cache()`d calls `generateMetadata` makes. Set it to 'page' and the lede goes back under
 * the skeleton, with its bars, in one line.
 *
 * ⛔ NOT IN `../layout.tsx`: that layout also wraps `[district]/page.tsx`, which renders its own Header,
 * `<main>`, breadcrumb, H1 and Footer. Anything here would be doubled on every district page.
 *
 * ⚠️ `notFound()` HERE IS THE SECOND LINE OF DEFENCE behind `../layout.tsx`'s guard. It is still a real
 * 404: this layout sits above the `(index)` loading boundary, so the status has not gone out yet.
 * ⚠️ NO `<Suspense>` in this file (contract test): around `{children}` it would hide the page again.
 */
export default async function CategoryIndexLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ lang: string; category: string }>
}) {
  const { category } = await params
  const cat = await getCategoryRow(category)
  if (!cat) notFound()
  const headline = cat.slug === 'rentals' ? await loadRentalsHeadline(cat.id) : null

  return (
    <div className="flex min-h-screen flex-col blob-bg">
      <Header />
      <main id="main" tabIndex={-1} className="flex-1 max-w-7xl mx-auto w-full px-3 sm:px-6 lg:px-8 pt-6 pb-12">
        <Breadcrumb className="mb-4">
          <BreadcrumbList>
            <BreadcrumbItem>
              {/* Base UI render prop (never asChild) — keeps the Next.js client-side nav. */}
              <BreadcrumbLink render={<Link href="/" />} className="hover:text-accent-foreground"><Tr text="Home" /></BreadcrumbLink>
            </BreadcrumbItem>
            {/* Literal "/" separator, and the colour stays pinned to --line-strong: the
                primitive's default is a chevron in text-muted-foreground. */}
            <BreadcrumbSeparator className="text-line-strong">/</BreadcrumbSeparator>
            <BreadcrumbItem>
              <BreadcrumbPage className="font-medium"><Bilingual en={cat.name} vi={cat.nameVi || cat.name} /></BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>

        <h1 className="h-display text-foreground">
          {headline ? <RentalsHeading headline={headline} /> : <><Bilingual en={cat.name} vi={cat.nameVi || cat.name} /> <Tr text="in Vietnam" /></>}
        </h1>
        {LEDE_PLACEMENT === 'layout' && <CategoryLedeBlock slug={cat.slug} />}
        {children}
      </main>
      <Footer />
    </div>
  )
}
