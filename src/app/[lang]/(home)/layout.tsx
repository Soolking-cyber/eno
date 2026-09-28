import { Header } from '@/components/marketplace/header'
import { Footer } from '@/components/marketplace/footer'
import { SITE_NAME } from '@/lib/edition'

/**
 * ⛔ THE HOME PAGE'S HEADER, `<main>` AND H1 RENDER HERE, ABOVE `(home)/loading.tsx`, SO THAT CRAWLERS
 * CAN READ THEM. A loading file wraps its page in a Suspense boundary, and React moves a finished
 * boundary over 500 B into `<div hidden id="S:0">` at the end of the body whenever the shell's bytes plus
 * the boundary's pass 12,800 B — always, on this page, cached HTML and bots included (the rule and its
 * source lines are in src/app/[lang]/crawler-visible-html-contract.test.ts). Before SEO wave B, H1c, the
 * page rendered all of this itself, inside the boundary: crawlers got the header and `<main>` twice (the
 * skeleton's and the page's) and the H1 under `[hidden]`. A loading file never wraps the layout in its
 * own folder, so what renders here is in place in the first chunk.
 * The feed keeps its skeleton (owner's hybrid, 2026-09-27); only the listing page lost its skeleton.
 *
 * ⛔ NO DATA. The H1 is the constant `SITE_NAME`, sr-only as it has been since 2026-08-02 (owner), and
 * nothing here awaits anything: whatever a layout awaits delays the whole first chunk.
 * ⚠️ THE ONE H1 IS THIS ONE. `<ListingsExplorer>` renders the same sr-only heading by default, because
 * `/s/[handle]` renders the explorer too and has no H1 of its own; `(home)/page.tsx` turns it off with
 * `siteHeading={false}`. Both at once is two H1s once `S:0` is revealed.
 * ⚠️ NO `<Suspense>` in this file (contract test): around `{children}` it would hide the page again.
 */
export default function HomeLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col home-wash">
      {/* ⛔ PULL-TO-REFRESH WAS REMOVED HERE ON 2026-09-19 — owner: "pull down to refresh is too
          sensitive remove it for now". It fired on ordinary downward flicks near the top of the feed,
          which on a browse surface costs a scroll every time it misreads one.
          ⚠️ "FOR NOW". The whole thing is one commit in history (`src/lib/pull-to-refresh.ts`, its
          test and `pull-to-refresh.tsx`) and comes back by reverting this. What to change before it
          does: PULL_THRESHOLD was 64px of PULL — 128px of finger after the half-resistance — and the
          gesture became live on the first downward pixel at scrollY 0. A slop distance before the
          gesture engages at all, and a higher threshold, are the two dials; the arithmetic module
          existed precisely so they could be tuned and tested without a touchscreen. */}
      {/* NO hero-wordmark preload any more: the hero heading is sr-only on both editions as of
          2026-08-02 (owner), so there is no hero image left to preload and <LogoWordmark> is gone.
          The wordmark that remains is the HEADER's, which sits at the very top of the initial
          markup — the preload scanner finds it immediately, and a <link rel=preload> would only
          duplicate a request the parser is already about to make. Do not add one back.

          The history is worth keeping because it cost real debugging: the preload used to live in
          the page's Server Component, was hoisted to <head>, and was NOT cleaned up on soft
          navigation, so it leaked onto every non-home route and warned "preloaded but not used".
          Moving it into the client component fixed that; deleting the hero image removed the need
          entirely. */}
      <Header />
      <main id="main" tabIndex={-1} className="flex-1 max-w-7xl mx-auto w-full px-3 sm:px-6 lg:px-8 pt-4">
        <h1 className="sr-only">{SITE_NAME}</h1>
        {children}
      </main>
      <Footer />
    </div>
  )
}
