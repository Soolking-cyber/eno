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
  it('leads its title and <h1> with "<site> MCP server", canonical at its own path', () => {
    expect(PAGE).toContain('title: `${SITE_NAME} MCP server | Manage your shop from an AI agent`')
    expect(PAGE).toMatch(/<h1 className="h-display text-foreground">\{SITE_NAME\} MCP server<\/h1>/)
    expect(PAGE).toContain('alternates: { canonical: DOC_PATHS.mcp }')
  })

  it('renders the tool list from the server\'s TOOLS array, with each scope', () => {
    expect(PAGE).toContain("import { TOOLS } from '@/lib/mcp/tools'")
    expect(PAGE).toContain('{TOOLS.map((t) => (')
    expect(PAGE).toContain('{t.scope}')
    expect(PAGE).not.toMatch(/'get_shop'/)
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
