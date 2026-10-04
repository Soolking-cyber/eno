import { Header } from '@/components/marketplace/header'
import { Footer } from '@/components/marketplace/footer'
import { Skeleton } from '@/components/ui/skeleton'

/** Mirrors PostWizard's <Section> (post-wizard-parts.tsx:59): an `h-section` h2 (18px ×
 *  1.3 = 23.4) with an optional `mt-0.5 text-xs` hint (16), then the content, in a
 *  `space-y-3` stack. The header block therefore measures 41.4 with a one-line hint and
 *  23.4 without — not the flat 44 an `h-6` + `mt-1 h-4` pair produced.
 *  `hintWrap` adds the SECOND hint line the long hints take below lg (57.4 measured on a
 *  phone) — without it the Photos and Contact headers were 16px short there. */
function SectionSkeleton({ titleW, hintW, hintWrap, children }: { titleW: string; hintW?: string; hintWrap?: boolean; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <div>
        <Skeleton className={`h-[calc(var(--text-section)*1.3)] ${titleW}`} />
        {hintW && <Skeleton className={`mt-0.5 h-4 ${hintW} max-w-full`} />}
        {hintWrap && <Skeleton className="mt-0 h-4 w-1/2 lg:hidden" />}
      </div>
      {children}
    </section>
  )
}

/**
 * Skeleton for the post wizard: Exit link → h-display title + intro → the two-column grid
 * (form sections left, sticky live-preview + publish column right at lg).
 *
 * Every block below was measured against the FIRST-RUN wizard at 1280px (2026-08-07, and the
 * blocks the 2026-09-29 sell-flow pass changed re-measured then) — the state this skeleton
 * actually hands over to:
 *   photos 293.4 · category 189.4 · details 292.2 · price 269.4 · location 81.4 · contact 73.4
 *   aside: heading 20 · preview 353.3 · publish 44 · checklist 108 (5 rows) · privacy 21.9
 *
 * ⚠️ THE PREVIEW IS aspect-SQUARE. <Preview> (post-wizard-parts.tsx) renders
 * `aspect-square w-full rounded-xl` — the same ratio listing-card-skeleton.tsx names as a
 * five-surface invariant. This file drew `aspect-[4/3]`, which both broke that invariant
 * and made the whole sticky column ~76px short at a 304px aside.
 *
 * ⚠️ The checklist is FIVE rows, and it is not conditional at this moment: on a cold load
 * every step is outstanding (photos · category · title & description · price · area). It
 * shows publish STEPS now, not the gate's rows (post-wizard-steps.ts): title and description
 * are one step, and neither sign-in nor contact is a step while the account is loading.
 */
export default function PostLoading() {
  return (
    <div className="flex min-h-page flex-col blob-bg">
      <Header />
      <main id="main" tabIndex={-1} className="flex-1 max-w-7xl mx-auto w-full px-3 sm:px-6 lg:px-8 pt-6 pb-12">
        {/* The wizard's own end-of-form reserve below lg: <StickyActionBarSpacer /> (its 4.5rem
            fallback + the safe-area inset, the same max() it uses) plus the tab bar's 4.5rem. */}
        <div className="pb-[calc(9rem+max(env(safe-area-inset-bottom),var(--safe-area-inset-bottom,0px)))] lg:pb-0">
          {/* Exit link (text-sm → 20px) */}
          <Skeleton className="h-5 w-14" />
          {/* h1 — h-display is fluid (28 → 40px at line-height 1.12) */}
          <Skeleton className="mt-3 h-[calc(var(--text-display)*1.12)] w-64 max-w-full" />
          {/* Intro — text-base (24px line), two lines on a phone */}
          <Skeleton className="mt-1 h-6 w-96 max-w-full" />
          <Skeleton className="h-6 w-2/3 sm:hidden" />

          <div className="mt-8 grid gap-10 lg:grid-cols-[1fr_19rem]">
            {/* ── FORM ── */}
            <div className="min-w-0 space-y-10">
              {/* Photos — the empty grid holds TWO square tiles (Add photo + Add video),
                  then the "First photo is your cover" hint line. */}
              <SectionSkeleton titleW="w-16" hintW="w-72" hintWrap>
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                  <Skeleton className="aspect-square rounded-xl" />
                  <Skeleton className="aspect-square rounded-xl" />
                </div>
                <div>
                  <Skeleton className="h-4 w-64 max-w-full" />
                  <Skeleton className="h-4 w-1/2 lg:hidden" />
                </div>
              </SectionSkeleton>

              {/* Category — pill cloud (rounded-full px-4 py-2.5 text-sm → 40px, 3 rows at lg) */}
              <SectionSkeleton titleW="w-24" hintW="w-64">
                {/* The 17 real pills' measured widths at 1280, so the cloud wraps where the real
                    one does (7 · 7 · 3 at lg) — a uniform-width cloud wraps to a different count. */}
                <div className="flex flex-wrap gap-2">
                  {['w-[96px]', 'w-[134px]', 'w-[131px]', 'w-[108px]', 'w-[88px]', 'w-[111px]', 'w-[94px]', 'w-[87px]', 'w-[85px]', 'w-[137px]', 'w-[85px]', 'w-[114px]', 'w-[105px]', 'w-[114px]', 'w-[100px]', 'w-[96px]', 'w-[113px]'].map((w, i) => (
                    <Skeleton key={i} className={`h-10 rounded-full ${w}`} />
                  ))}
                </div>
              </SectionSkeleton>

              {/* Details — title field (70) + description field (label row — "Polish with AI"
                  rides in it now, 22.8 — the rows=5 textarea, and the hint under it) */}
              <SectionSkeleton titleW="w-20">
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <Skeleton className="h-5 w-16" />
                    <Skeleton className="h-5 w-12" />
                  </div>
                  <Skeleton className="h-11 w-full max-w-2xl rounded-xl" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <div className="flex max-w-2xl items-center justify-between">
                    <Skeleton className="h-5 w-24" />
                    <Skeleton className="h-[23px] w-56 rounded-lg" />
                  </div>
                  <Skeleton className="h-[124px] w-full max-w-2xl rounded-xl" />
                  <div>
                    <Skeleton className="h-4 w-72 max-w-full" />
                    <Skeleton className="h-4 w-1/3 lg:hidden" />
                  </div>
                </div>
              </SectionSkeleton>

              {/* Price — amount field + multiplier chips (98), then the Negotiable /
                  Fixed-price pair (two equal columns, 52) and the Urgent-sale switch row (60),
                  mt-3 apart */}
              <SectionSkeleton titleW="w-12">
                <div>
                  <div className="max-w-xs">
                    <Skeleton className="h-11 w-full rounded-xl" />
                    <Skeleton className="mt-2 h-4 w-20" />
                    <div className="mt-1.5 flex gap-2">
                      <Skeleton className="h-6 w-16 rounded-lg" />
                      <Skeleton className="h-6 w-20 rounded-lg" />
                      <Skeleton className="h-6 w-20 rounded-lg" />
                    </div>
                  </div>
                  <div className="mt-3 grid max-w-md grid-cols-2 gap-2">
                    <Skeleton className="h-[52px] rounded-xl" />
                    <Skeleton className="h-[52px] rounded-xl" />
                  </div>
                  <Skeleton className="mt-3 h-[60px] max-w-md rounded-xl" />
                </div>
              </SectionSkeleton>

              {/* Location — area picker + locate button */}
              <SectionSkeleton titleW="w-20">
                <div className="flex max-w-md items-center gap-2">
                  <Skeleton className="h-[46px] flex-1 rounded-xl" />
                  <Skeleton className="h-[46px] w-[46px] shrink-0 rounded-xl" />
                </div>
              </SectionSkeleton>

              {/* Contact — mirrors the wizard's own not-yet-loaded identity line */}
              <SectionSkeleton titleW="w-20" hintW="w-80" hintWrap>
                {/* Byte-for-byte the wizard's OWN not-yet-loaded line
                    (post-wizard-sections.tsx: `h-5 w-56`), so the hand-off is invisible. */}
                <Skeleton className="h-5 w-56" />
              </SectionSkeleton>
            </div>

            {/* ── PREVIEW + PUBLISH (desktop) ── */}
            <aside className="hidden lg:block">
              <div className="sticky top-24 space-y-4">
                <div className="space-y-2">
                  {/* "Preview" heading (text-sm → 20px line) */}
                  <Skeleton className="h-5 w-16" />
                  {/* Preview card: SQUARE cover → title (line-clamp-2 text-sm) → price */}
                  <div className="w-full">
                    <Skeleton className="aspect-square w-full rounded-xl" />
                    <Skeleton className="mt-2 h-[19px] w-3/4" />
                    <Skeleton className="mt-0.5 h-5 w-16" />
                  </div>
                </div>
                {/* Publish button (44px) */}
                <Skeleton className="h-11 w-full rounded-xl" />
                {/* Checklist — 5 text-xs rows with an h-4 bullet */}
                <div className="space-y-1.5 pt-1">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Skeleton key={i} className="h-4 w-40" />
                  ))}
                </div>
                {/* Privacy note — the EnoSeal line (text-2xs leading-relaxed) */}
                <div className="pt-1">
                  <Skeleton className="h-[18px] w-full" />
                </div>
              </div>
            </aside>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  )
}
