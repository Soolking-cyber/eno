import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { GET } from './route'

/**
 * public/.well-known/ai.txt states robots.txt's policy for tools that read ai.txt (websiteaeogeochecker, 2026-11-24). Its
 * Allow/Disallow lines are typed, so this holds them equal to robots.txt's FIRST group ("User-agent: *" and the AI crawlers
 * that share it): a path robots.txt closes later must close in ai.txt too.
 */
const rules = (text: string) =>
  text.split('\n').map((l) => l.trim()).filter((l) => /^(Allow|Disallow):/i.test(l)).map((l) => l.replace(/\s+/g, ' ')).sort()

describe('/.well-known/ai.txt', () => {
  it("carries exactly the Allow/Disallow lines of robots.txt's User-agent: * group", async () => {
    const robots = await (GET() as Response).text()
    const start = robots.indexOf('User-agent: *')
    expect(start).toBeGreaterThan(-1)
    // The group runs until the next group starts (a User-agent line after a rule line).
    const lines = robots.slice(start).split('\n')
    let end = lines.length
    let seenRule = false
    for (let i = 0; i < lines.length; i++) {
      if (/^(Allow|Disallow):/i.test(lines[i])) seenRule = true
      else if (seenRule && /^User-agent:/i.test(lines[i])) { end = i; break }
    }
    const group = rules(lines.slice(0, end).join('\n'))
    const ai = readFileSync('public/.well-known/ai.txt', 'utf8')
    expect(rules(ai)).toEqual(group)
    expect(ai).toMatch(/^User-Agent: \*$/m)
    // First-match readers: "Allow: /" is the LAST rule, and every other Allow comes before any Disallow.
    const order = ai.split('\n').filter((l) => /^(Allow|Disallow):/.test(l))
    expect(order[order.length - 1]).toBe('Allow: /')
    const firstDisallow = order.findIndex((l) => l.startsWith('Disallow:'))
    expect(order.slice(firstDisallow, -1).every((l) => l.startsWith('Disallow:'))).toBe(true)
  })
})
