import { SITE_NAME } from '@/lib/edition'
import type { Metadata } from 'next'
import { withShare } from '@/lib/site-identity'
import Link from 'next/link'
import { Header } from '@/components/marketplace/header'
import { Footer } from '@/components/marketplace/footer'
import { DOC_PATHS } from '@/lib/api/discovery-links'
import { API_BASE, API_NAME, API_TITLE_NAME } from '../reference'
import { C, Code } from '../doc-parts'

/**
 * /developers/sandbox — THE API SANDBOX'S OWN PAGE (2026-11-19, owner pasted ora.ai's scan: "Sandbox / test environment —
 * mentioned at /developers.md but no sandbox surface verified"). ora credits only a reachable page at /sandbox or
 * /docs/sandbox ("the only path to credit"); both serve this page (next.config.ts rewrites, `sandbox` a reserved handle),
 * and its canonical is here. The sandbox itself is src/lib/api/sandbox.ts, documented in /developers#sandbox and the OpenAPI
 * document; this page states exactly that — nothing here may promise more than the route does.
 * English only, like every page under developers/ (eslint.config.mjs).
 */

export const metadata: Metadata = withShare({
  title: `${API_TITLE_NAME} sandbox: test keys, no sign-up | ${SITE_NAME}`,
  description: `Try the ${API_NAME} without an account or real data: a 24-hour test key from one call, sample listings in the live shapes, writes that run the live checks and store nothing.`,
  alternates: { canonical: DOC_PATHS.sandbox },
})

const BASE = API_BASE

export default function SandboxPage() {
  return (
    <div className="flex min-h-page flex-col blob-bg">
      <Header />
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-3xl flex-1 px-3 pt-10 pb-16 sm:px-6 lg:px-8">
        <h1 className="h-display text-foreground">{API_NAME} sandbox</h1>
        <p className="mt-3 text-base leading-relaxed text-body">
          Build and test an integration with the {API_NAME} without an account and without touching real data. The sandbox lives at <C>{`${BASE}/sandbox`}</C>{' '}
          and answers in the same shapes as the live API.
        </p>

        <section className="mt-8">
          <h2 className="h-section text-foreground">1. Get a test key — no sign-up</h2>
          <p className="mt-2 text-sm leading-relaxed text-body">
            One call returns a key that lasts 24 hours and works only under <C>{`${BASE}/sandbox`}</C> (at most 10 keys an hour from one
            address).
          </p>
          <div className="mt-3"><Code>{`curl -X POST ${BASE}/sandbox/keys
# → { "key": "eno_test_…", "type": "test", "expires_at": "…", "base_url": "${BASE}/sandbox", "sandbox": true }`}</Code></div>
        </section>

        <section className="mt-8">
          <h2 className="h-section text-foreground">2. Call the sandbox</h2>
          <ul className="mt-2 space-y-1.5 text-sm leading-relaxed text-body">
            <li>• Sample listings and categories in the live shapes.</li>
            <li>• Create and update calls run the live checks and store nothing.</li>
            <li>• An export runs as an async job: <C>202 Accepted</C> with a <C>Location</C> to poll.</li>
            <li>• Every response carries <C>X-Sandbox: true</C>.</li>
          </ul>
          <div className="mt-3"><Code>{`curl "${BASE}/sandbox/listings?q=honda" -H "Authorization: Bearer eno_test_…"

curl -i -X POST ${BASE}/sandbox/exports -H "Authorization: Bearer eno_test_…"
# → 202 Accepted, Location: ${BASE}/sandbox/exports/job_…`}</Code></div>
        </section>

        <section className="mt-8">
          <h2 className="h-section text-foreground">3. Go live</h2>
          <p className="mt-2 text-sm leading-relaxed text-body">
            A test key never works on the live API. A live key comes from your {SITE_NAME} shop&apos;s{' '}
            <Link href="/dashboard/settings?tab=developers" className="font-semibold text-accent-foreground hover:underline">dashboard → Developers</Link>, and it acts on
            your real shop from the first call. The full reference is on the{' '}
            <Link href={`${DOC_PATHS.developers}#sandbox`} className="font-semibold text-accent-foreground hover:underline">developer page</Link>{' '}
            and in the <a href={DOC_PATHS.openapi} className="font-semibold text-accent-foreground hover:underline">OpenAPI document</a>.
          </p>
        </section>
      </main>
      <Footer />
    </div>
  )
}
