import type { Metadata } from 'next'
import { withShare } from '@/lib/site-identity'
import Link from 'next/link'
import { Header } from '@/components/marketplace/header'
import { Footer } from '@/components/marketplace/footer'
import { DOC_PATHS } from '@/lib/api/discovery-links'
import { API_BASE, API_NAME, SITE_ORIGIN, SUPPORT_EMAIL } from '../reference'
import { C, Code } from '../doc-parts'

/**
 * /developers/versioning — THE VERSIONING AND DEPRECATION POLICY (2026-11-11).
 *
 * An agent-readiness scan found the URL versioning but "no deprecation or sunset policy detected". The policy existed
 * only inside the OpenAPI document (`info.description` and `x-deprecation-policy`); this page is its human-readable
 * home, and every documented /api/v1 response but the token endpoint's names it in `Link: <…>; rel="deprecation"`
 * (RFC 9745 §3: before anything is deprecated, the link makes the policy discoverable).
 *
 * ⛔ SAYS ONLY WHAT THE SPEC SAYS, AND NO NOTICE PERIOD. The spec's x-deprecation-policy is "a mechanism statement, not a
 * promise": no notice period or support window has been agreed, and a number here is a commitment partners would rely
 * on. That is the owner's call; until then the page says none is published. Keep it in step with the "Versioning and
 * deprecation" part of info.description in src/app/api/v1/openapi.json/route.ts (versioning.test.ts pins the two).
 * English only, like every page under developers/ (eslint.config.mjs).
 */

export const metadata: Metadata = withShare({
  title: `${API_NAME} versioning and deprecation policy`,
  description: `How the ${API_NAME} is versioned, what may change inside v1 without notice, and how a deprecation is announced: deprecated: true in the OpenAPI spec, and Deprecation and Sunset headers.`,
  alternates: { canonical: DOC_PATHS.versioning },
})

export default function VersioningPage() {
  return (
    <div className="flex min-h-page flex-col blob-bg">
      <Header />
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-3xl flex-1 px-3 pt-10 pb-16 sm:px-6 lg:px-8">
        <h1 className="h-display text-foreground">{API_NAME} versioning and deprecation</h1>
        <p className="mt-3 text-base leading-relaxed text-body">
          How the <Link href={DOC_PATHS.developers} className="font-semibold text-accent-foreground hover:underline">{API_NAME}</Link> changes, and how
          you will know before something you use goes away.
        </p>

        <section className="mt-8">
          <h2 className="h-section text-foreground">Versions</h2>
          <p className="mt-2 text-sm leading-relaxed text-body">
            The major version is in the URL path: <C>{API_BASE}</C> is version 1. A breaking change ships as a new path; the shape of{' '}
            <C>/api/v1</C> does not change underneath a client.
          </p>
        </section>

        <section className="mt-8">
          <h2 className="h-section text-foreground">What can change inside v1</h2>
          <p className="mt-2 text-sm leading-relaxed text-body">These ship without notice:</p>
          <ul className="mt-2 space-y-1.5 text-sm leading-relaxed text-body">
            <li>• new response fields;</li>
            <li>• new optional request fields;</li>
            <li>• new operations;</li>
            <li>• new <C>error.code</C> values.</li>
          </ul>
          <p className="mt-3 text-sm leading-relaxed text-body">
            So a client must ignore fields it does not recognise, and must not treat any enumeration in the{' '}
            <a href={DOC_PATHS.openapi} className="font-semibold text-accent-foreground hover:underline">OpenAPI document</a> as closed unless it says
            so.
          </p>
        </section>

        <section className="mt-8">
          <h2 className="h-section text-foreground">How a deprecation is announced</h2>
          <p className="mt-2 text-sm leading-relaxed text-body">An operation scheduled for removal is marked in three places:</p>
          <ul className="mt-2 space-y-1.5 text-sm leading-relaxed text-body">
            <li>
              • <strong className="text-foreground">The spec:</strong> <C>deprecated: true</C> on the operation in{' '}
              <a href={DOC_PATHS.openapi} className="font-mono font-semibold text-accent-foreground hover:underline">/openapi.json</a>.
            </li>
            <li>
              • <strong className="text-foreground">Its responses:</strong> a <C>Deprecation</C> header (RFC 9745) with the date it was deprecated, and a{' '}
              <C>Sunset</C> header (RFC 8594) with the date it stops working, never earlier than the first.
            </li>
            <li>• <strong className="text-foreground">This page,</strong> under Deprecated now, with both dates.</li>
          </ul>
          <p className="mt-3 text-sm leading-relaxed text-body">A deprecated operation&apos;s response would carry, for example:</p>
          <div className="mt-3"><Code>{`Deprecation: @1798761600
Sunset: Sat, 01 Jan 2028 00:00:00 GMT
Link: <${SITE_ORIGIN}${DOC_PATHS.versioning}>; rel="deprecation"; type="text/html"`}</Code></div>
          <p className="mt-3 text-sm leading-relaxed text-body">
            Every response from a documented <C>/api/v1</C> operation already carries that <C>Link</C> to this page (all but{' '}
            <C>POST /oauth/token</C>, which builds its own headers). On its own it means nothing is deprecated: only a{' '}
            <C>Deprecation</C> header marks an operation. Watch the headers in code; read this page as a person.
          </p>
        </section>

        <section className="mt-8">
          <h2 className="h-section text-foreground">Deprecated now</h2>
          <p className="mt-2 text-sm leading-relaxed text-body">
            <strong className="text-foreground">Nothing is deprecated in v1, and no sunset date is set.</strong> No notice period has been published yet;
            when one is, it will be stated here.
          </p>
        </section>

        <p className="mt-10 border-t border-border pt-6 text-sm text-body">
          Questions? <a href={`mailto:${SUPPORT_EMAIL}`} className="font-semibold text-accent-foreground hover:underline">{SUPPORT_EMAIL}</a>.
        </p>
      </main>
      <Footer />
    </div>
  )
}
