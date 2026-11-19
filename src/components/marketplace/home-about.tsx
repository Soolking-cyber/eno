import { Bilingual } from '@/components/marketplace/bilingual'
import { FOUNDER_QUOTE, HOME_ABOUT, type AboutText } from '@/lib/home-about'

/**
 * The home page's "About eno.vn" questions, below the FAQ (src/lib/home-about.ts has the rules). Each question is an H2 with a
 * direct answer first, and every word is drawn open: nothing tucked behind a tap, so a reader and a crawler see the same text.
 * Plain text, no images or client state, so it adds words and no weight to the first paint above it.
 */
const Para = ({ parts, className }: { parts: readonly AboutText[]; className: string }) => (
  <p className={className}>
    {parts.map((t, i) => (
      <span key={t.en}>
        {i > 0 ? ' ' : null}
        <Bilingual en={t.en} vi={t.vi} />
      </span>
    ))}
  </p>
)

export function HomeAbout() {
  return (
    <div className="grid gap-x-8 gap-y-8 border-t border-border pb-10 pt-6 sm:grid-cols-2">
      {HOME_ABOUT.map((s, i) => (
        <section key={s.id} aria-labelledby={`about-${s.id}`}>
          <h2 id={`about-${s.id}`} className="text-base font-bold text-foreground">
            <Bilingual en={s.q.en} vi={s.q.vi} />
          </h2>
          <Para parts={s.open} className="mt-2 text-sm leading-relaxed text-foreground" />
          {s.more.map((p) => (
            <Para key={p[0].en} parts={p} className="mt-2 text-sm leading-relaxed text-body" />
          ))}
          {i === 0 ? (
            <blockquote className="mt-3">
              <p className="text-sm italic leading-relaxed text-body">
                “<Bilingual en={FOUNDER_QUOTE.text.en} vi={FOUNDER_QUOTE.text.vi} />”
              </p>
              <footer className="mt-1 text-t-meta text-muted-foreground">
                <Bilingual en={FOUNDER_QUOTE.by.en} vi={FOUNDER_QUOTE.by.vi} />
              </footer>
            </blockquote>
          ) : null}
        </section>
      ))}
    </div>
  )
}
