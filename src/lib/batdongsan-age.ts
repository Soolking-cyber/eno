/**
 * How old a Batdongsan.com.vn listing was WHEN IT WAS SCRAPED, from the card's own relative label.
 * Owner, 2026-10-01: "batdongsan 1 photo apartments still fetch only 7 days fresh ones".
 *
 * The scraper stores the card's text verbatim ("Đăng hôm nay", "Đăng 3 ngày trước", "Đăng 1 tuần
 * trước") and no timestamp, so the age is relative to the scrape — the caller adds the scrape's own age.
 *
 * ⚠️ COARSE LABELS ARE RANGES: "1 tuần trước" is 7–13 days, "1 tháng trước" 30–59. `maxDays` is the
 * UPPER end, and a freshness cut is checked against it (Opus, commit gate: with the lower end, a 10-day
 * cut admitted a "1 week ago" listing that could be 13 days old).
 * ⚠️ DAY LABELS ARE FLOORED: "6 ngày trước" is 6 to <7 days, "hôm nay" 0 to <1 — so `maxDays` is N+1
 * (Opus, commit gate: the worst case, which is what a freshness promise has to hold for).
 * ⛔ Absolute dates and anything unrecognised → null → NOT imported. Batdongsan prints a date only on old
 * listings, and parsing one invited double-counting and silently "fresh" malformed or future dates (codex).
 */
export interface BdsAge { minDays: number; maxDays: number }

export function bdsAgeDays(published: string | null | undefined): BdsAge | null {
  const t = (published ?? '').normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim()
  if (!t) return null
  if (/hôm nay|vừa xong|phút trước|giờ trước/.test(t)) return { minDays: 0, maxDays: 1 }
  if (/hôm qua/.test(t)) return { minDays: 1, maxDays: 2 }
  let m = t.match(/(\d+)\s*ngày trước/)
  if (m) { const n = Number(m[1]); return { minDays: n, maxDays: n + 1 } }
  m = t.match(/(\d+)\s*tuần trước/)
  if (m) { const n = Number(m[1]); return { minDays: 7 * n, maxDays: 7 * n + 7 } }
  m = t.match(/(\d+)\s*tháng trước/)
  if (m) { const n = Number(m[1]); return { minDays: 30 * n, maxDays: 30 * n + 30 } }
  return null
}

/** Was the listing posted within `limitDays` of NOW, at worst? `scrapeAgeDays` is the scrape's own (fractional) age. */
export function ageWithin(age: BdsAge | null, scrapeAgeDays: number, limitDays: number): boolean {
  return !!age && age.maxDays + scrapeAgeDays <= limitDays
}

const DAY_MS = 86_400_000

/**
 * The OLDEST instant a card's label allows — the date the 7-day rule judges (src/lib/apartment-freshness.ts).
 * `readAtMs` is the EARLIEST moment the label can have been read (bdsScrapeStartMs); the far end of the
 * label's range is counted back from it. "Đăng 3 ngày trước" read at 10:00 on the 5th → 10:00 on the 1st.
 * Floored to the millisecond, so the ISO string written to a fresh set is never newer than this.
 */
export function bdsWorstCaseDate(age: BdsAge, readAtMs: number): Date {
  return new Date(Math.floor(readAtMs) - age.maxDays * DAY_MS)
}

/**
 * The earliest moment the labels in a scrape can have been read. The file's BIRTH (the importer's scrape-
 * age rule) — or the crawl log's own start when that is earlier: scraper.py creates all_rentals.json only
 * at its first checkpoint, after it has already read that many pages, so the birth alone is a few
 * minutes too late for the first pages' labels. A missing or unparsable start leaves the birth.
 */
export function bdsScrapeStartMs(fileBirthMs: number, crawlStartedAtMs: number | null | undefined): number {
  const c = typeof crawlStartedAtMs === 'number' && Number.isFinite(crawlStartedAtMs) ? crawlStartedAtMs : Infinity
  return Math.min(fileBirthMs, c)
}
