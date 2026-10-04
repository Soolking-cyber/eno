import { Header } from '@/components/marketplace/header'
import { Footer } from '@/components/marketplace/footer'
import { SITE_NAME } from '@/lib/edition'
import { PREPAINT_SCRIPT } from '@/lib/explorer-url'
import { VI_PILOT } from '@/lib/lang-pinned'
import { LangPilotSwitch } from '@/components/marketplace/lang-pilot-switch'
import { LangSuggestionBanner } from '@/components/marketplace/lang-suggestion-banner'

/**
 * ⛔ THE `/vi` PILOT'S SWITCHER AND BANNER (SEO wave B, V3b) MOUNT ONLY WHILE `/` IS A LIVE PILOT PATH —
 * never today (VI_PREFIX_PATHS is empty until V5), so this layout's HTML is unchanged. The switcher reads
 * `params` itself (lang-pilot-switch.tsx), which keeps this file free of any await.
 */
const PILOTED = VI_PILOT.live.includes('/')

/**
 * ⚠️ UX3 FAST-8 (2026-10-05): `(home)/loading.tsx` is gone — the feed and its LCP photo render inline, not in
 * `<div hidden id="S:0">` (phone LCP 1,556 → 1,020 ms, measured A/B). The note below is why the heading lives here.
 * ⛔ THE HOME PAGE'S HEADER, `<main>` AND H1 RENDER HERE — above where `(home)/loading.tsx` was until UX3 FAST-8 — SO THAT CRAWLERS
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
 * ⚠️ THE ONE H1 IS THIS ONE. `<ListingsExplorer>` renders the same sr-only heading by default when it is
 * not seller-scoped; `(home)/page.tsx` turns it off with `siteHeading={false}`. Both at once is two H1s
 * once `S:0` is revealed. (On `/s/[handle]` the explorer's default is off: the shop's name is the H1.)
 * ⚠️ NO `<Suspense>` in this file (contract test): around `{children}` it would hide the page again.
 *
 * ⛔ THE ONE SCRIPT HERE IS STATIC, AND THIS IS THE ONLY PLACE IT WORKS (E-SSR phase 1, 2026-09-29).
 * `PREPAINT_SCRIPT` (src/lib/explorer-url.ts) marks `<html>` when the URL directs the feed, so the ISR
 * seed — the unfiltered home, served for every query string — is masked from the first paint instead of
 * posing as the answer to /?q=honda for the seconds hydration takes. It must run BEFORE the seed can
 * paint, i.e. in the first chunk: in the page it would sit inside `S:0`, parsed after the skeleton has
 * already been shown. It is a constant string — no data, no await — so the first-chunk rules above hold.
 */
export default function HomeLayout({ children, params }: { children: React.ReactNode; params: Promise<{ lang: string }> }) {
  return (
    <div className="flex min-h-page flex-col home-wash">
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
        {PILOTED && <div className="flex justify-end"><LangPilotSwitch path="/" params={params} /></div>}
        <script dangerouslySetInnerHTML={{ __html: PREPAINT_SCRIPT }} />
        {children}
      </main>
      {PILOTED && <LangSuggestionBanner />}
      <Footer />
    </div>
  )
}
