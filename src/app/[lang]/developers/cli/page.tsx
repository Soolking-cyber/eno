import { SITE_NAME } from '@/lib/edition'
import type { Metadata } from 'next'
import { withShare } from '@/lib/site-identity'
import Link from 'next/link'
import { Header } from '@/components/marketplace/header'
import { Footer } from '@/components/marketplace/footer'
import { DOC_PATHS } from '@/lib/api/discovery-links'
import { API_NAME, SITE_ORIGIN, SUPPORT_EMAIL } from '../reference'
import { C, Code } from '../doc-parts'
import { CLI_EXAMPLES } from './examples'

/**
 * /developers/cli — THE eno-vn COMMAND-LINE CLIENT (2026-11-11; owner: "decisions also resolve with recommended").
 *
 * The agent-readiness scan failed "CLI tool available": it looks for an official CLI on npm, PyPI or Homebrew. The
 * package is packages/eno-vn (npm `eno-vn`, zero dependencies), one documented /api/v1 call per command; this page is
 * its home, named for it, so a search for "eno.vn CLI" lands here.
 * ⛔ EVERY COMMAND SHOWN HERE MUST EXIST: src/lib/eno-vn-cli.test.ts runs each one through the CLI's own parser.
 * ⛔ The base URL is the edition's own (the CLI's ENO_BASE_URL); the examples name eno.vn's default only where the
 * CLI itself defaults to it. English only, like every page under developers/ (eslint.config.mjs).
 */

export const metadata: Metadata = withShare({
  title: `${SITE_NAME} CLI (eno-vn) | Manage your shop from the command line`,
  description: `eno-vn, the command-line client for the ${API_NAME}: list, create and sync listings, upload photos, read analytics and manage webhooks from a terminal, a script or an AI agent. npx eno-vn, no dependencies.`,
  alternates: { canonical: DOC_PATHS.cli },
})

export default function CliPage() {
  return (
    <div className="flex min-h-page flex-col blob-bg">
      <Header />
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-3xl flex-1 px-3 pt-10 pb-16 sm:px-6 lg:px-8">
        <h1 className="h-display text-foreground">{SITE_NAME} CLI</h1>
        <p className="mt-3 text-base leading-relaxed text-body">
          <C>eno-vn</C> is the command-line client for the{' '}
          <Link href={DOC_PATHS.developers} className="font-semibold text-accent-foreground hover:underline">{API_NAME}</Link>: manage your shop from a
          terminal, a script or an AI agent. Every command is one API call (with --all, one per page) and prints its JSON answer.
        </p>

        <section className="mt-8">
          <h2 className="h-section text-foreground">Install and connect</h2>
          <p className="mt-2 text-sm leading-relaxed text-body">
            No install needed: <C>npx</C> fetches it from npm (Node 18 or later; no dependencies). Set your API key, from your{' '}
            <Link href="/dashboard/dev" className="font-semibold text-accent-foreground hover:underline">dashboard → Developers</Link> section, in the
            environment:
          </p>
          {/* ⛔ The CLI defaults to https://eno.vn; on any other edition the setup names this site's own origin, or a forum
              partner's key would be sent to eno.vn (codex, 2026-11-11). */}
          <div className="mt-3"><Code>{`${SITE_ORIGIN === 'https://eno.vn' ? '' : `export ENO_BASE_URL=${SITE_ORIGIN}\n`}export ENO_API_KEY=eno_live_…
npx eno-vn status`}</Code></div>
          <ul className="mt-3 space-y-1.5 text-sm leading-relaxed text-body">
            <li>
              • <strong className="text-foreground">There is no sandbox and no test key</strong> — a key is live from the moment it is issued, so every
              command changes your real shop.
            </li>
            <li>• <strong className="text-foreground">Output:</strong> the API&apos;s JSON on stdout, a refusal included. Exit codes: 0 success, 1 the API refused, 2 a usage error, 3 no confirmed answer (a write may have happened: check before repeating it).</li>
            <li>• <C>npx eno-vn help</C> lists every command.</li>
          </ul>
        </section>

        <section className="mt-8">
          <h2 className="h-section text-foreground">Commands</h2>
          {SITE_ORIGIN !== 'https://eno.vn' && (
            <p className="mt-2 text-sm leading-relaxed text-body">
              Each one uses the <C>ENO_BASE_URL</C> exported above; in a new terminal, export it again first, or the CLI talks to its default.
            </p>
          )}
          <ul className="mt-4 space-y-3">
            {CLI_EXAMPLES.map(([cmd, what]) => (
              <li key={cmd} className="border-t border-border pt-3">
                <div><Code whole>{cmd}</Code></div>
                <p className="mt-1.5 text-sm leading-relaxed text-body">{what}</p>
              </li>
            ))}
          </ul>
        </section>

        <p className="mt-10 border-t border-border pt-6 text-sm text-body">
          For AI agents, the <Link href={DOC_PATHS.mcp} className="font-semibold text-accent-foreground hover:underline">MCP server</Link> exposes the same
          operations as tools. Questions? <a href={`mailto:${SUPPORT_EMAIL}`} className="font-semibold text-accent-foreground hover:underline">{SUPPORT_EMAIL}</a>.
        </p>
      </main>
      <Footer />
    </div>
  )
}
