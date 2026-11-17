import { IS_SERVICES, SITE_NAME } from '@/lib/edition'
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
import { MCP_NPM_PACKAGE, MCP_NPM_URL, MCP_REGISTRY_NAME, MCP_REGISTRY_URL } from '@/lib/mcp-registry'
import { AGENT_SKILLS_REPO_URL, AGENT_SKILLS_SH_URL } from '@/lib/agent-skills'
import { C, Code } from '../doc-parts'
import { ChatAppConnect } from '../chat-connect'
import { GROK_CLIENT_ID } from '@/lib/api/oauth-hosted-clients'

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
  description: `The ${SITE_NAME} MCP server: connect Claude, Cursor or any MCP client to your ${SITE_NAME} storefront — listings, catalogue sync, analytics and webhooks. Sign in with your ${SITE_NAME} shop, or use an API key.`,
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
          <ChatAppConnect className="mt-4" />
          <h3 className="mt-4 text-base font-semibold text-foreground">Sign in with {SITE_NAME}</h3>
          <p className="mt-2 text-sm leading-relaxed text-body">
            In Claude, or any app that supports MCP sign-in, add <C>{ENDPOINT}</C> as a connector. The app opens {SITE_NAME}: sign in, check the
            app&apos;s address on the consent screen and press <strong className="text-foreground">Allow</strong>. No key to copy. Reconnecting the same
            app later is one tap (<strong className="text-foreground">Continue</strong>).
          </p>
          <ul className="mt-3 space-y-1.5 text-sm leading-relaxed text-body">
            <li>
              • <strong className="text-foreground">Any account, for chat:</strong> the app can read your conversations and message, make and counter
              offers and decline offers for you; each message it sends is marked as written by an AI assistant, and accepting an offer stays with you.
            </li>
            <li>
              • <strong className="text-foreground">Your shop, with a business account:</strong> the shop tools too, for the one shop of the account that
              pressed Allow. An account without one connects for chat only, and the consent screen says so.
            </li>
            <li>
              • <strong className="text-foreground">Disconnect anytime</strong> in{' '}
              <Link href="/dashboard/settings?tab=privacy" className="font-semibold text-accent-foreground hover:underline">Settings → Privacy → Connected apps</Link>: it
              stops at once. It also ends by itself after 180 days or when the account is suspended — and a connection made with a shop ends,
              chat included, when the account loses that shop or stops being a business account: connect again, for chat only.
            </li>
            <li>
              • <strong className="text-foreground">If it does not connect:</strong> the consent screen says why. A sign-in link that fails or was left
              open too long: start the connection again from the app.
            </li>
          </ul>

          <h3 className="mt-6 text-base font-semibold text-foreground">Or with an API key</h3>
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
            {/* The official MCP Registry record (published 11-11 under the DNS-verified vn.eno namespace) — linked so an
                agent or a scanner can tie the registry entry to this site (ora.ai, 2026-11-15). eno.vn's server only. */}
            {!IS_SERVICES && (
              <li>
                • <strong className="text-foreground">MCP Registry:</strong>{' '}
                <a href={MCP_REGISTRY_URL} className="font-mono font-semibold text-accent-foreground hover:underline">{MCP_REGISTRY_NAME}</a> — the
                official registry entry, published under the eno.vn domain namespace.
              </li>
            )}
            {/* eno.vn's agent-skills repo (src/lib/agent-skills.ts): linked so a scanner can tie it to this site. */}
            {!IS_SERVICES && (
              <li>
                • <strong className="text-foreground">Agent skills:</strong>{' '}
                <a href={AGENT_SKILLS_REPO_URL} className="font-mono font-semibold text-accent-foreground hover:underline">eno-agent-skills</a> — skills
                for searching the listings and running a shop, an AGENTS.md for coding agents and an Agent Plugin manifest; also
                on <a href={AGENT_SKILLS_SH_URL} className="font-semibold text-accent-foreground hover:underline">skills.sh</a>.
              </li>
            )}
          </ul>

          <h3 className="mt-6 text-base font-semibold text-foreground">Claude Code</h3>
          <div className="mt-2"><Code whole>{`claude mcp add --transport http ${CLIENT_NAME} ${ENDPOINT} --header "Authorization: Bearer eno_live_…"`}</Code></div>

          <h3 className="mt-6 text-base font-semibold text-foreground">Clients configured with JSON</h3>
          <p className="mt-2 text-sm leading-relaxed text-body">
            Clients that take a JSON file (Cursor&apos;s <C>mcp.json</C>, for example) need the URL and the header:
          </p>
          <div className="mt-3"><Code>{JSON.stringify({ mcpServers: { [CLIENT_NAME]: { url: ENDPOINT, headers: { Authorization: 'Bearer eno_live_…' } } } }, null, 2)}</Code></div>

          {/* The npm bridge (packages/eno-vn-mcp, owner 2026-11-16): for clients that only start a local command. Linked here so
              a scanner can tie the package to this site (ora.ai mcp-registry-listed); its own homepage is this page. */}
          <h3 className="mt-6 text-base font-semibold text-foreground">Clients that start a local server</h3>
          <p className="mt-2 text-sm leading-relaxed text-body">
            The <a href={MCP_NPM_URL} className="font-semibold text-accent-foreground underline">{MCP_NPM_PACKAGE}</a> package runs these servers as a
            local command. As below it opens the listing search; add <C>{'"env": { "ENO_API_KEY": "eno_live_…" }'}</C> for your shop.
          </p>
          <div className="mt-3"><Code>{JSON.stringify({ mcpServers: { [CLIENT_NAME]: { command: 'npx', args: ['-y', MCP_NPM_PACKAGE] } } }, null, 2)}</Code></div>

          {/* Grok (2026-11-16): no directory to list in, so the person adds the server. MEASURED in Grok's web app that day:
              Connect Apps › "Add a custom connector" offers Name, Server URL and Headers only, lists the tools without a
              credential, and on a tool call's 401 does NOT start a sign-in (no OAuth discovery request reached us). So the web
              app uses the API key as a header. The Client ID route (oauth-hosted-clients.ts) is for the Grok surfaces whose
              form asks for one (docs.x.com/x-ads-api/mcp). */}
          <h3 className="mt-6 text-base font-semibold text-foreground">Grok</h3>
          <p className="mt-2 text-sm leading-relaxed text-body">
            On grok.com, open <a href="https://grok.com/connectors" className="font-semibold text-accent-foreground underline">Connectors</a>, choose{' '}
            <strong className="text-foreground">Add a custom connector</strong> and fill in:
          </p>
          <ul className="mt-2 space-y-1.5 text-sm leading-relaxed text-body">
            <li>• <strong className="text-foreground">Name:</strong> {SITE_NAME}</li>
            <li>• <strong className="text-foreground">Server URL:</strong> <C>{ENDPOINT}</C></li>
            <li>
              • <strong className="text-foreground">Headers:</strong> key <C>Authorization</C>, value <C>Bearer eno_live_…</C> with your API key.
            </li>
          </ul>
          <p className="mt-2 text-sm leading-relaxed text-body">
            Press <strong className="text-foreground">Add MCP</strong>, then ask Grok to use {SITE_NAME}. Where Grok asks for an OAuth{' '}
            <strong className="text-foreground">Client ID</strong> instead, enter <C>{GROK_CLIENT_ID}</C> with no client secret and the token auth
            method <C>none</C>, then sign in with your {SITE_NAME} shop and press <strong className="text-foreground">Allow</strong>. On Grok Business or
            Enterprise, a team admin adds the connector first. The listing search below needs only its URL, with no header.
          </p>
        </section>

        <section className="mt-8">
          <h2 className="h-section text-foreground">Tools</h2>
          <p className="mt-2 text-sm leading-relaxed text-body">
            {TOOLS.length} tools. The shop tools are scoped like their REST endpoints; the chat tools need <C>messages:read</C> or{' '}
            <C>messages:write</C>, which only a sign-in grants (never an API key) and any account can give, with or without a shop, and
            every message they send shows as written by an AI assistant. A call that lacks the scope shown is refused with <C>insufficient_scope</C>.
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
