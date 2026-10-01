import { describe, expect, it } from 'vitest'
import { bdsImportExitCode, defaultCrawlLog, parseArgs } from '../../scripts/import-batdongsan-rentals'

/** scripts/import-batdongsan-rentals.ts's command line — checked inside main(), never at import. */
const WEEKLY = ['--src', '/d/all_rentals.json', '--previous', '/d/all_rentals.2026-09-28.json', '--max-age-days', '7', '--subcat', 'apartment-rental', '--fresh-out', '/run/bds-fresh.json']

describe('parseArgs', () => {
  it('accepts the weekly dry run and its apply', () => {
    expect(parseArgs(WEEKLY)).toMatchObject({ apply: false, maxAgeDays: 7, freshOut: '/run/bds-fresh.json', crawlLog: null, journalDir: null, limit: 0 })
    expect(parseArgs([...WEEKLY, '--journal-dir', '/j', '--apply']).apply).toBe(true)
    expect(parseArgs(['--src', 'x.json']).maxAgeDays).toBeNull()
  })
  it('refuses an unknown, repeated or valueless flag — a typo must not silently drop the 7-day gate', () => {
    expect(() => parseArgs([...WEEKLY, '--fresh-ou', 'x'])).toThrow(/unknown argument "--fresh-ou"/)
    expect(() => parseArgs([...WEEKLY, '--src', 'y.json'])).toThrow(/--src given twice/)
    expect(() => parseArgs(['--src', '--apply'])).toThrow(/--src needs a value/)
    expect(() => parseArgs(['--src'])).toThrow(/needs a value/)
    expect(() => parseArgs([])).toThrow(/--src/)
  })
  it('a value may repeat another flag\'s value', () => {
    expect(parseArgs(['--src', 'same.json', '--previous', 'same.json', '--max-age-days', '7']).previous).toBe('same.json')
  })
  it('keeps the existing rules: --max-age-days is a positive integer and needs --previous', () => {
    expect(() => parseArgs(['--src', 'x', '--max-age-days', '7'])).toThrow(/needs --previous/)
    expect(() => parseArgs(['--src', 'x', '--previous', 'p', '--max-age-days', '1.5'])).toThrow(/positive integer/)
    expect(() => parseArgs(['--src', 'x', '--limit', '-1'])).toThrow(/--limit/)
  })
  it('--fresh-out is the 7-day apartment judgement and nothing else', () => {
    const without = (flag: string) => { const a = [...WEEKLY]; a.splice(a.indexOf(flag), 2); return a }
    expect(() => parseArgs(without('--subcat'))).toThrow(/--subcat apartment-rental/)
    expect(() => parseArgs([...without('--max-age-days'), '--max-age-days', '5'])).toThrow(/--max-age-days 7/)
    expect(() => parseArgs(['--src', 'x', '--crawl-log', 'c.json'])).toThrow(/only with --fresh-out/)
  })
  it('⛔ refuses --limit with --fresh-out — a set must follow an import of every row it keeps live', () => {
    expect(() => parseArgs([...WEEKLY, '--limit', '50'])).toThrow(/--limit cannot be used with --fresh-out/)
    expect(() => parseArgs([...WEEKLY, '--limit', '0'])).toThrow(/--limit cannot be used with --fresh-out/)
    expect(parseArgs(['--src', 'x', '--previous', 'p', '--max-age-days', '7', '--limit', '50']).limit).toBe(50)
  })
  it('an apply that can revive or re-date rows needs a journal dir', () => {
    expect(() => parseArgs([...WEEKLY, '--apply'])).toThrow(/--journal-dir/)
    expect(() => parseArgs(['--src', 'x', '--apply'])).not.toThrow()
  })
})

describe('bdsImportExitCode — what scripts/apartments-weekly.sh reads', () => {
  it('0 ok · 3 set refused · 4 owed with the set written (or none asked) · 5 owed AND no set', () => {
    expect(bdsImportExitCode({ owed: 0, setAsked: true, setWritten: true })).toBe(0)
    expect(bdsImportExitCode({ owed: 0, setAsked: false, setWritten: false })).toBe(0)
    expect(bdsImportExitCode({ owed: 0, setAsked: true, setWritten: false })).toBe(3)
    expect(bdsImportExitCode({ owed: 2, setAsked: true, setWritten: true })).toBe(4)
    expect(bdsImportExitCode({ owed: 2, setAsked: false, setWritten: false })).toBe(4)
    // Refused — or the dated pass threw part-way, which never writes the set.
    expect(bdsImportExitCode({ owed: 2, setAsked: true, setWritten: false })).toBe(5)
  })
})

describe('defaultCrawlLog — where scraper.py writes its log', () => {
  it('sits next to the scrape, named after it', () => {
    expect(defaultCrawlLog('/Users/x/batdongsan_rentals_hcmc/all_rentals.json')).toBe('/Users/x/batdongsan_rentals_hcmc/all_rentals.crawl.json')
    expect(defaultCrawlLog('all_rentals.2026-10-05.json')).toBe('all_rentals.2026-10-05.crawl.json')
  })
})
