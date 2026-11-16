import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'

/**
 * /.well-known/agent-skills/index.json — the Agent Skills Discovery index (cloudflare/agent-skills-discovery-rfc v0.2.0),
 * added 2026-11-16 for isitagentready.com's `agentSkills` check. It is STATIC: public/.well-known/agent-skills/ holds the
 * index and one SKILL.md per skill (a dotted path, so src/proxy.ts and the page rewrites never touch it).
 *
 * ⛔ THE SKILL.md FILES ARE BYTE-FOR-BYTE COPIES OF github.com/eno-vn/eno-agent-skills (skills/<name>/SKILL.md, commit
 * 2d58bb8b3c70) — the canonical skills /developers/mcp and /llms.txt link. Change a skill THERE first, copy it here, and
 * re-hash it: `shasum -a 256 public/.well-known/agent-skills/<name>/SKILL.md`. A digest that does not match the served
 * bytes tells an agent the file was tampered with — this test is what stops that shipping.
 */
const ROOT = join(process.cwd(), 'public')
const index = JSON.parse(readFileSync(join(ROOT, '.well-known/agent-skills/index.json'), 'utf8')) as {
  $schema: string
  skills: { name: string; type: string; description: string; url: string; digest: string }[]
}

describe('agent-skills discovery index', () => {
  it('declares the v0.2.0 schema and at least one skill', () => {
    expect(index.$schema).toBe('https://schemas.agentskills.io/discovery/0.2.0/schema.json')
    expect(index.skills.length).toBeGreaterThan(0)
  })

  it.each(index.skills.map((s) => [s.name, s] as const))('%s: a served SKILL.md whose sha256 and frontmatter match', (_, s) => {
    expect(s.name).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    expect(s.type).toBe('skill-md')
    expect(s.url).toBe(`/.well-known/agent-skills/${s.name}/SKILL.md`)
    const file = join(ROOT, s.url)
    expect(existsSync(file)).toBe(true)
    const bytes = readFileSync(file)
    expect(s.digest).toBe(`sha256:${createHash('sha256').update(bytes).digest('hex')}`)
    const fm = /^---\n([\s\S]*?)\n---\n/.exec(bytes.toString('utf8'))?.[1] ?? ''
    expect(fm).toMatch(new RegExp(`^name: ${s.name}$`, 'm'))
    expect(JSON.parse(/^description: (".*")$/m.exec(fm)?.[1] ?? '""')).toBe(s.description)
  })
})
