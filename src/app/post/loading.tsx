import { Header } from '@/components/marketplace/header'
import { Footer } from '@/components/marketplace/footer'
import { Skeleton } from '@/components/ui/skeleton'

// Small building block mirroring PostWizard's <Section>: h-section heading
// (+ optional hint line), then the content, in a space-y-3 stack.
function SectionSkeleton({ titleW, hintW, children }: { titleW: string; hintW?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <div>
        <Skeleton className={`h-6 ${titleW}`} />
        {hintW && <Skeleton className={`mt-1 h-4 ${hintW} max-w-full`} />}
      </div>
      {children}
    </section>
  )
}

// Skeleton for the post wizard. Mirrors PostWizard's single-page form layout:
// Exit link → h-display title + intro → two-column grid (form sections left,
// sticky live-preview + publish column right ≥lg). Inputs are the wizard's real
// rounded-xl bg-tint fields (px-4 py-3 text-sm → 44px; textarea rows=5 → 124px).
export default function PostLoading() {
  return (
    <div className="flex min-h-screen flex-col blob-bg">
      <Header />
      <main id="main" tabIndex={-1} className="flex-1 max-w-7xl mx-auto w-full px-3 sm:px-6 lg:px-8 pt-6 pb-12">
        <div className="pb-[calc(9rem+env(safe-area-inset-bottom))] lg:pb-0">
          {/* Exit link */}
          <Skeleton className="h-5 w-14" />
          {/* h-display title + intro line */}
          <Skeleton className="mt-3 h-9 w-64 max-w-full" />
          <Skeleton className="mt-1 h-5 w-96 max-w-full" />

          <div className="mt-8 grid gap-10 lg:grid-cols-[1fr_19rem]">
            {/* ── FORM ── */}
            <div className="min-w-0 space-y-10">
              {/* Photos — 3/4-col square tiles (just the add tile at first) */}
              <SectionSkeleton titleW="w-16" hintW="w-72">
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                  <Skeleton className="aspect-square rounded-xl" />
                </div>
              </SectionSkeleton>

              {/* Category — chip cloud (px-3.5 py-2 text-sm → 36px) */}
              <SectionSkeleton titleW="w-24" hintW="w-64">
                <div className="flex flex-wrap gap-2">
                  {Array.from({ length: 15 }).map((_, i) => (
                    <Skeleton key={i} className={`h-9 rounded-xl ${i % 3 === 0 ? 'w-32' : i % 3 === 1 ? 'w-24' : 'w-28'}`} />
                  ))}
                </div>
              </SectionSkeleton>

              {/* Details — title input + description textarea */}
              <SectionSkeleton titleW="w-20">
                <div className="space-y-1.5">
                  <Skeleton className="h-5 w-16" />
                  <Skeleton className="h-11 w-full max-w-2xl rounded-xl" />
                </div>
                <div className="space-y-1.5">
                  <Skeleton className="h-5 w-20" />
                  <Skeleton className="h-[124px] w-full max-w-2xl rounded-xl" />
                </div>
              </SectionSkeleton>

              {/* Price */}
              <SectionSkeleton titleW="w-12">
                <Skeleton className="h-11 w-full max-w-xs rounded-xl" />
              </SectionSkeleton>

              {/* Location — area picker + locate button */}
              <SectionSkeleton titleW="w-20">
                <div className="flex max-w-md items-center gap-2">
                  <Skeleton className="h-[46px] flex-1 rounded-xl" />
                  <Skeleton className="h-[46px] w-[46px] shrink-0 rounded-xl" />
                </div>
              </SectionSkeleton>

              {/* Contact — mirrors the wizard's own not-yet-loaded line */}
              <SectionSkeleton titleW="w-20" hintW="w-80">
                <Skeleton className="h-5 w-56" />
              </SectionSkeleton>
            </div>

            {/* ── PREVIEW + PUBLISH (desktop) ── */}
            <aside className="hidden lg:block">
              <div className="sticky top-24 space-y-4">
                <div className="space-y-2">
                  {/* "Live preview" eyebrow */}
                  <Skeleton className="h-3 w-20" />
                  {/* Preview card: cover + title + price */}
                  <div className="w-full">
                    <Skeleton className="aspect-[4/3] w-full rounded-xl" />
                    <Skeleton className="mt-2 h-4 w-3/4" />
                    <Skeleton className="mt-1 h-4 w-16" />
                  </div>
                </div>
                {/* Publish button (w-full rounded-xl py-3 → 44px) */}
                <Skeleton className="h-11 w-full rounded-xl" />
                {/* Checklist rows */}
                <div className="space-y-1.5 pt-1">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Skeleton key={i} className="h-4 w-40" />
                  ))}
                </div>
                {/* Privacy note */}
                <Skeleton className="h-4 w-full" />
              </div>
            </aside>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  )
}
