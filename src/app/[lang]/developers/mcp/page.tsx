import { SITE_NAME } from '@/lib/edition'
import type { Metadata } from 'next'
import { withShare } from '@/lib/site-identity'
import Link from 'next/link'
import { Header } from '@/components/marketplace/header'
import { Footer } from '@/components/marketplace/footer'
import { Badge } from '@/components/ui/badge'
import { TOOLS } from '@/lib/mcp/tools'
import { SEARCH_TOOLS } from '@/app/api/mcp/search/tools'
import { DOC_PATHS } from '@/lib/api/discovery-links'
import { API_NAME, SITE_ORIGIN, SUPPORT_EMAIL } from '../reference'
import { C, Code } from '../doc-parts'

/**
 * /developers/mcp — THE HOSTED MCP SERVER'S OWN PAGE (2026-11-11).
 *
 * ⚠️ WHY A PAGE AND NOT ONLY THE #mcp SECTION OF /developers: an agent-readiness scan searched the web for the MCP
 * server and none of ten results was ours, "although the scan found one on your site". A name-based search matches a
 * page's title and heading; a section three screens down /developers has neither. So the server gets a URL whose title
 * and <h1> lead with "<site> MCP server", in the sitemap, llms.txt, the API catalogue and the server card.
 *
 * ⚠️ THE TOOL LIST IS RENDERED FROM `TOOLS`, THE ARRAY THE SERVER DISPATCHES (src/lib/mcp/tools.ts) — name, scope and
 * description — so this page cannot list a tool the server lacks or miss one it gained.
 * ⛔ LICENSING: these are the same strings tools/list already publishes to anonymous callers on both editions, and
 * src/app/api/mcp/discovery-auth.test.ts ("the licensing pin") keeps them free of visa / itinerary / PayPal vocabulary.
 * TOOLS has no edition filter; that pin is what keeps eno.vn's copy compliant — never weaken it for this page.
 * ⚠️ A SERVER COMPONENT, LIKE /developers, AND IT MUST STAY ONE (that page's header note): its readers run no JavaScript.
 * English only, like every page under developers/ (eslint.config.mjs).
 */

export const metadata: Metadata = withShare({
  title: `${SITE_NAME} MCP server | Manage your shop from an AI agent`,
  description: `The ${SITE_NAME} MCP server: connect Claude, Cursor or any MCP client to your ${SITE_NAME} storefront — listings, catalogue sync, analytics and webhooks, with your API key as the Bearer token.`,
  alternates: { canonical: DOC_PATHS.mcp },
})

const ENDPOINT = `${SITE_ORIGIN}/api/mcp`
/** The public listing-search server (src/app/api/mcp/search): no key, read-only. Its browser GET lands on #search. */
const SEARCH_ENDPOINT = `${SITE_ORIGIN}/api/mcp/search`

/** The client-side name in the examples: the site's first label, e.g. `eno`. */
const CLIENT_NAME = SITE_NAME.split('.')[0]

export default function McpServerPage() {
  return (
    <div className="flex min-h-page flex-col blob-bg">
      <Header />
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-3xl flex-1 px-3 pt-10 pb-16 sm:px-6 lg:px-8">
        <h1 className="h-display text-foreground">{SITE_NAME} MCP server</h1>
        <p className="mt-3 text-base leading-relaxed text-body">
          A hosted <a href="https://modelcontextprotocol.io" className="font-semibold text-accent-foreground hover:underline">Model Context Protocol</a> server
          for the <Link href={DOC_PATHS.developers} className="font-semibold text-accent-foreground hover:underline">{API_NAME}</Link>. An AI agent
          manages your {SITE_NAME} storefront directly: listings, bulk import, catalogue sync, analytics and webhooks.
        </p>

        <section className="mt-8">
          <h2 className="h-section text-foreground">Connect</h2>
          <p className="mt-2 text-sm leading-relaxed text-body">Add it as a remote MCP server, with your API key as the Bearer token:</p>
          <div className="mt-3"><Code>{`${ENDPOINT}
Authorization: Bearer eno_live_…`}</Code></div>
          <ul className="mt-3 space-y-1.5 text-sm leading-relaxed text-body">
            <li>
              • <strong className="text-foreground">The key:</strong> create one in your{' '}
              <Link href="/dashboard/dev" className="font-semibold text-accent-foreground hover:underline">dashboard → Developers</Link> section (business
              accounts). <strong className="text-foreground">There is no sandbox and no test key — a key is live from the moment it is issued.</strong>
            </li>
            <li>
              • <strong className="text-foreground">Transport:</strong> Streamable HTTP, stateless — JSON-RPC over POST, no SSE stream (a GET answers 405).
            </li>
            <li>
              • <strong className="text-foreground">Discovery is open:</strong> <C>initialize</C> and <C>tools/list</C> answer without a key; every{' '}
              <C>tools/call</C> needs one.
            </li>
            <li>
              • <strong className="text-foreground">Server card:</strong>{' '}
              <a href="/.well-known/mcp.json" className="font-mono font-semibold text-accent-foreground hover:underline">/.well-known/mcp.json</a> — the
              transport, the protocol versions and the header, for clients that read it.
            </li>
          </ul>

          <h3 className="mt-6 text-base font-semibold text-foreground">Claude Code</h3>
          <div className="mt-2"><Code whole>{`claude mcp add --transport http ${CLIENT_NAME} ${ENDPOINT} --header "Authorization: Bearer eno_live_…"`}</Code></div>

          <h3 className="mt-6 text-base font-semibold text-foreground">Clients configured with JSON</h3>
          <p className="mt-2 text-sm leading-relaxed text-body">
            Clients that take a JSON file (Cursor&apos;s <C>mcp.json</C>, for example) need the URL and the header:
          </p>
          <div className="mt-3"><Code>{JSON.stringify({ mcpServers: { [CLIENT_NAME]: { url: ENDPOINT, headers: { Authorization: 'Bearer eno_live_…' } } } }, null, 2)}</Code></div>
        </section>

        <section className="mt-8">
          <h2 className="h-section text-foreground">Tools</h2>
          <p className="mt-2 text-sm leading-relaxed text-body">
            {TOOLS.length} tools, each scoped like its REST endpoint: a call whose key lacks the scope shown is refused with{' '}
            <C>insufficient_scope</C>.
          </p>
          <ul className="mt-4 space-y-3">
            {TOOLS.map((t) => (
              <li key={t.name} className="border-t border-border pt-3">
                <div className="flex flex-wrap items-center gap-2">
                  <code className="font-mono text-sm font-semibold text-foreground">{t.name}</code>
                  <Badge variant="brand" size="sm" className="rounded-lg font-mono">{t.scope}</Badge>
                </div>
                <p className="mt-1 text-sm leading-relaxed text-body">{t.description}</p>
              </li>
            ))}
          </ul>
        </section>

        <section id="search" className="mt-8 scroll-mt-20">
          <h2 className="h-section text-foreground">Listing search, no key</h2>
          <p className="mt-2 text-sm leading-relaxed text-body">
            A second server, open to anyone: an AI assistant searches live listings for the person it is helping and links to each one. Read-only, no
            sign-in, nothing to set up.
          </p>
          <div className="mt-3"><Code>{SEARCH_ENDPOINT}</Code></div>
          <div className="mt-3"><Code whole>{`claude mcp add --transport http ${CLIENT_NAME}-search ${SEARCH_ENDPOINT}`}</Code></div>
          <ul className="mt-4 space-y-3">
            {SEARCH_TOOLS.map((t) => (
              <li key={t.name} className="border-t border-border pt-3">
                <code className="font-mono text-sm font-semibold text-foreground">{t.name}</code>
                <p className="mt-1 text-sm leading-relaxed text-body">{t.description}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-8">
          <h2 className="h-section text-foreground">Your key and the model</h2>
          <ul className="mt-2 space-y-1.5 text-sm leading-relaxed text-body">
            {/* ⚠️ Only what the server controls: a client can show its settings to a model, and a person can paste a key into a chat. */}
            <li>
              • <strong className="text-foreground">Never a tool argument:</strong> the key stays in the client&apos;s connection settings, and no tool asks
              the model for it. Keep it out of chats: it is a live credential for your shop.
            </li>
            <li>• <strong className="text-foreground">One shop per key:</strong> tools only ever see that shop&apos;s own data.</li>
            {/* ⚠️ NOT "immediately" for tokens: access tokens are stateless and live out their hour after the key is revoked
                (src/lib/api/oauth.ts header). A raw key is looked up on every request, so it stops at once. */}
            <li>
              • <strong className="text-foreground">Revoke anytime</strong> in the dashboard: the key stops working at once; an OAuth token already minted
              from it keeps working until its one-hour lifetime ends.
            </li>
          </ul>
        </section>

        <p className="mt-10 border-t border-border pt-6 text-sm text-body">
          The REST API behind the same key: <Link href={DOC_PATHS.developers} className="font-semibold text-accent-foreground hover:underline">{API_NAME}</Link>.
          Questions? <a href={`mailto:${SUPPORT_EMAIL}`} className="font-semibold text-accent-foreground hover:underline">{SUPPORT_EMAIL}</a>.
        </p>
      </main>
      <Footer />
    </div>
  )
}
