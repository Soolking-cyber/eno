import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * ⛔ GUARDS FOR THE HIDDEN `[lang]` SEGMENT (src/proxy.ts). Each failure below is SILENT in production:
 * nothing errors, a page just stays stale, a route 404s, or eno.vn serves words it may not.
 */

function codeFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'generated' || name.startsWith('.')) continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) codeFiles(full, out)
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(full)
  }
  return out
}

describe('the [lang] segment', () => {
  it('⛔ no bare revalidatePath() outside the helper — it would purge a path no cached page has', () => {
    const offenders = codeFiles('src')
      .filter((f) => !f.endsWith('src/lib/revalidate-lang.ts'))
      .flatMap((f) => readFileSync(f, 'utf8').split('\n').map((line, i) => ({ f, i: i + 1, line })))
      .filter(({ line }) => /\brevalidatePath\s*\(/.test(line.replace(/\/\/.*$/, '')) && !/^\s*\*/.test(line))
      .map(({ f, i }) => `${f}:${i}`)
    expect(offenders, 'use revalidatePublicPath() from @/lib/revalidate-lang').toEqual([])
  })

  it('every page tree lives under [lang]; only route handlers and metadata stay at the root', () => {
    // `sitemaps` holds only `.xml` route handlers (/sitemaps/pages.xml, /sitemaps/listings-<k>.xml):
    // every URL under it has a dot, which proxy.ts's matcher already excludes, so no page is lost.
    const ALLOWED = new Set(['[lang]', 'api', 'app', 'md', 'llms.txt', 'openapi.json', 'robots.txt', 'sitemap.xml', 'sitemaps',
      'manifest.ts', 'icon.svg', 'apple-icon.png', 'favicon.ico', 'global-error.tsx', 'globals.css', 'listing-images'])
    const extra = readdirSync('src/app').filter((n) => !ALLOWED.has(n))
    // A new root entry either belongs under [lang] (a page) or must be excluded in proxy.ts's matcher.
    expect(extra).toEqual([])
  })

  it('⛔ the Vietnamese dictionary that rides every vi page carries no visa, itinerary or PayPal wording', () => {
    // It is serialised into the HTML of the vi variant on BOTH editions, so eno.vn would publish it in page source.
    const src = readFileSync('src/generated/vi-overrides.ts', 'utf8')
    const hits = src.split('\n').filter((l) => /visa|itinerar|paypal|thị thực|lịch trình|hộ chiếu|xuất nhập cảnh/i.test(l))
    expect(hits).toEqual([])
  })
})
