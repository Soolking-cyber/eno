import { mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { planTripsHistory, snapshotOf, writeTripsHistory } from '../../scripts/vehicle-trips-history'
import { parseTripsSnapshot } from './vehicle-reliability'

/** scripts/vehicle-trips-history.ts — reading a scrape's details.jsonl, and what a run files. */
let dir = ''
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'veh-trips-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

const rec = (id: string, trips: number, at: string, desc = '') => JSON.stringify({ id, totalTrips: trips, _fetched_at: at, desc })
const quiet = () => {}

describe('snapshotOf — one details.jsonl, read line by line on "\\n" only', () => {
  it('⛔ keeps a record whose text carries a raw U+2028 / U+2029 (readline would split it and lose the car)', async () => {
    const f = join(dir, 'details.jsonl')
    // Python's json.dumps(ensure_ascii=False) leaves U+2028 unescaped inside strings; JSON.stringify does too.
    writeFileSync(f, [rec('K2D7ZE', 24, '2026-10-12T05:33:23+07:00', 'xe đẹp\u2028gọi ngay\u2029'), rec('KAAAA1', 3, '2026-10-12T05:40:00+07:00')].join('\n') + '\n')
    const s = await snapshotOf(f)
    expect(Object.fromEntries(s!.trips)).toEqual({ K2D7ZE: 24, KAAAA1: 3 })
    expect(s!.skipped).toBe(0)
  })

  it('joins a line split across read chunks, and counts a torn last line as skipped', async () => {
    const f = join(dir, 'details.jsonl')
    const pad = 'x'.repeat(150)
    const lines = Array.from({ length: 1200 }, (_, i) => rec(`KC${String(i).padStart(4, '0')}`, i, '2026-10-12T05:33:23+07:00', pad))
    writeFileSync(f, lines.join('\n') + '\n{"id":"KTORN1","totalTr') // > 200 KB: several 64 KB chunks
    const s = await snapshotOf(f)
    expect(s!.trips.size).toBe(1200)
    expect(s!.trips.get('KC0777')).toBe(777)
    expect(s!.skipped).toBe(1)
  })
})

describe('planTripsHistory — what one run files', () => {
  const details = (name: string, recs: string[]) => { const f = join(dir, name); writeFileSync(f, recs.join('\n') + '\n'); return f }
  const out = () => join(dir, 'trips')

  it('files one snapshot per ICT date, and a re-run with nothing new writes nothing (the size:mtime cache)', async () => {
    const a = details('a.jsonl', [rec('K2D7ZE', 20, '2026-09-28T01:21:42+07:00'), rec('KAAAA1', 3, '2026-09-28T14:26:45+07:00')])
    const b = details('b.jsonl', [rec('K2D7ZE', 24, '2026-10-05T05:33:00+07:00')])
    const first = await planTripsHistory([a, b], out(), quiet)
    expect([...first.keys()].sort()).toEqual(['2026-09-28.json', '2026-10-05.json'])
    writeTripsHistory(out(), first)
    const back = parseTripsSnapshot(JSON.parse(first.get('2026-09-28.json')!.body))
    expect(typeof back === 'object' && Object.fromEntries(back.trips)).toEqual({ K2D7ZE: 20, KAAAA1: 3 })
    const log: string[] = []
    expect((await planTripsHistory([a, b], out(), (l) => log.push(l))).size).toBe(0)
    expect(log.filter((l) => l.includes('not re-read'))).toHaveLength(2)
  })

  it('a moved file (same size and mtime) is not re-read; a CHANGED one is', async () => {
    const a = details('a.jsonl', [rec('K2D7ZE', 20, '2026-09-28T01:21:42+07:00')])
    writeTripsHistory(out(), await planTripsHistory([a], out(), quiet))
    // the scraper appended to it (a resumed run): size moves → read again; same scrape (same takenAt) → not re-filed
    writeFileSync(a, [rec('K2D7ZE', 20, '2026-09-28T01:21:42+07:00'), rec('KAAAA1', 3, '2026-09-28T02:00:00+07:00')].join('\n') + '\n')
    const st = statSync(a)
    utimesSync(a, st.atime, new Date(st.mtimeMs + 5_000))
    const log: string[] = []
    const again = await planTripsHistory([a], out(), (l) => log.push(l))
    expect(again.size).toBe(0)
    expect(log.some((l) => l.includes('already filed'))).toBe(true)
  })

  it('of two scrapes on one date, keeps the FULLER one — on disk or within the run', async () => {
    const small = details('small.jsonl', [rec('K2D7ZE', 20, '2026-10-12T01:00:00+07:00')])
    const full = details('full.jsonl', [rec('K2D7ZE', 21, '2026-10-12T05:33:00+07:00'), rec('KAAAA1', 3, '2026-10-12T06:00:00+07:00')])
    const p = await planTripsHistory([small, full], out(), quiet)
    expect(JSON.parse(p.get('2026-10-12.json')!.body)).toMatchObject({ count: 2, source: full })
    writeTripsHistory(out(), p)
    // a smaller scrape of the same date later does not replace it
    const later = details('later.jsonl', [rec('K2D7ZE', 22, '2026-10-12T09:00:00+07:00')])
    expect((await planTripsHistory([later], out(), quiet)).size).toBe(0)
  })
})
