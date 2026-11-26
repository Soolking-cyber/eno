import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * /developers/mcp is the page a search for "<site> MCP server" should land on (page.tsx's header note): its title and
 * <h1> lead with that name, and its tool list is the server's own TOOLS array, never a copy. Read as source text: the
 * page renders Header/Footer, which this suite does not mount.
 */
const PAGE = readFileSync(fileURLToPath(new URL('./page.tsx', import.meta.url)), 'utf8')
const DEV = readFileSync(fileURLToPath(new URL('../page.tsx', import.meta.url)), 'utf8')

describe('/developers/mcp', () => {
  it('names the one server (eno Agentic Commerce, 2026-11-23) in its <h1>, leads its title with "eno … MCP server" (no domain), canonical at its own path', () => {
    // The title leads with "eno … MCP server": what a name-based search for the server matches (the page's header). No domain in
    // it (Seobility crawl 10, 2026-11-26): the lede and the description still say "<site> MCP server".
    expect(PAGE).toContain('title: `${MCP_SERVER_TITLE}: MCP server for AI agents`')
    expect(PAGE).toContain('The {SITE_NAME} MCP server for agentic commerce')
    expect(PAGE).toMatch(/<h1 className="h-display text-foreground">\{MCP_SERVER_TITLE\}<\/h1>/)
    expect(PAGE).toContain('alternates: { canonical: DOC_PATHS.mcp }')
  })

  it('renders the tool list from the server\'s TOOLS array, with each scope', () => {
    expect(PAGE).toContain("import { TOOLS } from '@/lib/mcp/tools'")
    expect(PAGE).toContain('{TOOLS.map((t) => (')
    expect(PAGE).toContain('{t.scope}')
    expect(PAGE).not.toMatch(/'get_shop'/)
  })

  it('Grok: the steps name the server URL and the client ID eno publishes for Grok, never a literal copy of it', () => {
    expect(PAGE).toContain("import { GROK_CLIENT_ID } from '@/lib/api/oauth-hosted-clients'")
    expect(PAGE).toContain('<C>{GROK_CLIENT_ID}</C>')
    expect(PAGE).toContain('<C>{ENDPOINT}</C>')
    expect(PAGE).not.toContain('/api/mcp/clients/grok')
  })

  it('links the npm bridge by the name its package.json publishes (ora.ai ties the package to the site through it)', async () => {
    const pkg = JSON.parse(readFileSync(fileURLToPath(new URL('../../../../../packages/eno-vn-mcp/package.json', import.meta.url)), 'utf8'))
    const { MCP_NPM_PACKAGE } = await import('@/lib/mcp-registry')
    expect(MCP_NPM_PACKAGE).toBe(pkg.name)
    expect(PAGE).toContain('href={MCP_NPM_URL}')
    expect(pkg.homepage).toBe('https://eno.vn/developers/mcp')
  })

  it('/developers (the docs entry page) links the npm package, the one server\'s registry record and the skills repo — eno.vn only', () => {
    expect(DEV).toContain('{!IS_SERVICES && (')
    for (const t of ['href={MCP_NPM_URL}', 'href={MCP_REGISTRY_URL}', 'href={AGENT_SKILLS_REPO_URL}']) expect(DEV).toContain(t)
    expect(DEV).not.toContain('MCP_SEARCH_REGISTRY')
  })

  it('stays a server component, and /developers links to it', () => {
    expect(PAGE).not.toMatch(/^['"]use client['"]/m)
    expect(DEV).toContain('<Link href={DOC_PATHS.mcp}')
    expect(DEV).toContain('<Link href={DOC_PATHS.versioning}')
  })

  it('⛔ never says a revoked key\'s tokens stop "immediately" (they live out their hour)', () => {
    expect(PAGE).not.toMatch(/takes effect immediately/)
    expect(PAGE).toContain('keeps working until its one-hour lifetime ends')
  })
})
