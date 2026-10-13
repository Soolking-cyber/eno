import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * scripts/vehicle-rentals-gone.py — the positive "gone" list ('hidden' is ONE-WAY). Run under python3 with its network
 * calls stubbed: the module is loaded as written, its probes fed canned answers.
 */
const SCRIPT = join(__dirname, '..', '..', 'scripts', 'vehicle-rentals-gone.py')

function py(body: string): { status: number | null; out: string } {
  const harness = `
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location('gone', ${JSON.stringify(SCRIPT)})
g = importlib.util.module_from_spec(spec); spec.loader.exec_module(g)
${body}
`
  const r = spawnSync('python3', ['-I', '-B', '-c', harness], { encoding: 'utf8', timeout: 20_000 })
  return { status: r.status, out: `${r.stdout}${r.stderr}` }
}

describe('mioto_gone — only "it no longer exists" is gone; a paused car is INACTIVE', () => {
  const probe = (answer: string) => py(`
answers = {'CTRL01': (200, {'error': 0, 'data': {'car': {'id': 'CTRL01', 'status': 2}}}), 'KCAR01': ${answer}}
g.mioto_detail = lambda cid: answers[cid]
print(json.dumps(g.mioto_gone('KCAR01', 'CTRL01')))
`).out.trim()

  it('the not-found code or a 404 → GONE (confirmed on the live control)', () => {
    expect(probe("(200, {'error': g.MIOTO_NOT_FOUND})")).toBe('"gone"')
    expect(probe('(404, None)')).toBe('"gone"')
  })

  it('⛔ the car\'s own status no longer 2 (paused by its owner) → INACTIVE, never gone', () => {
    expect(probe("(200, {'error': 0, 'data': {'car': {'id': 'KCAR01', 'status': 4}}})")).toBe('"inactive"')
  })

  it('anything else (a 5xx, another API error, no status field) → unknown', () => {
    expect(probe('(503, None)')).toBe('null')
    expect(probe("(200, {'error': -1})")).toBe('null')
    expect(probe("(200, {'error': 0, 'data': {'car': {'id': 'KCAR01'}}})")).toBe('null')
  })
})

describe('source — what one source puts on the gone list and in the next baseline', () => {
  const run = (answers: string) => py(`
prev = {'A': {'id': 'A'}, 'B': {'id': 'B'}, 'C': {'id': 'C', '_carried': 1}, 'D': {'id': 'D', '_carried': g.MAX_CARRIED}, 'E': {'id': 'E'}, 'F': {'id': 'F'}}
cur = {k: {'id': k} for k in ['E', 'F', 'G', 'H', 'I']}
answers = ${answers}
out, nxt = [], {}
line = g.source('mioto', prev, cur, out, nxt, lambda k, r: answers.get(k), 'mioto:')
print(json.dumps({'out': out, 'next': sorted(nxt['mioto']), 'carried': {k: r.get('_carried') for k, r in nxt['mioto'].items() if r.get('_carried')}, 'unresolved': g.UNRESOLVED, 'line': line}))
`)

  it('GONE → the list; INACTIVE → dropped from the baseline, never "unresolved"; no answer → carried, then unresolved', () => {
    const r = JSON.parse(run("{'A': g.GONE, 'B': g.INACTIVE, 'C': None, 'D': None}").out)
    expect(r.out).toEqual(['mioto:A'])
    expect(r.next).toEqual(['C', 'E', 'F', 'G', 'H', 'I']) // A gone, B answered (inactive), D handed to a human
    expect(r.carried).toEqual({ C: 2 })
    expect(r.unresolved).toEqual(['mioto:D'])
    expect(r.line).toMatch(/gone 1, inactive \(not gone; the status step expires it\) 1, unknown \(carried forward\) 1/)
  })

  it('⛔ a car present in the fresh scrape is never on the list, whatever its status (no one-way hide for a paused car)', () => {
    const r = py(`
prev = {'A': {'id': 'A', 'status': 2}}
cur = {'A': {'id': 'A', 'status': 4}}
out, nxt = [], {}
g.source('mioto', prev, cur, out, nxt, lambda k, r: g.GONE, 'mioto:')
print(json.dumps(out))
`)
    expect(r.out.trim()).toBe('[]')
  })

  it('a short scrape retires nothing and keeps the baseline; a source left out of the run keeps it too', () => {
    const r = py(`
prev = {k: {'id': k} for k in 'ABCDEFGHIJ'}
out, nxt = [], {}
short = g.source('mioto', prev, {'A': {'id': 'A'}}, out, nxt, lambda k, r: g.GONE, 'mioto:')
kept = nxt['mioto'] is prev
nxt2 = {}
skipped = g.source('bonboncar', prev, None, out, nxt2, lambda k, r: g.GONE, 'bonboncar:')
print(json.dumps({'out': out, 'kept': kept, 'kept2': nxt2['bonboncar'] is prev, 'short': short, 'skipped': skipped}))
`)
    const o = JSON.parse(r.out)
    expect(o).toMatchObject({ out: [], kept: true, kept2: true })
    expect(o.short).toMatch(/retire SKIPPED/)
    expect(o.skipped).toMatch(/no fresh dataset/)
  })

  it('keys are trimmed exactly as the importer trims them', () => {
    const r = py(`print(json.dumps([sorted(g.hcmc_mioto([{'id': ' K2D7ZE ', 'city': 'TP. Hồ Chí Minh'}])), sorted(g.hcmc_bonbon([{'sku': 'ACCENT_039 ', 'city': 'Hồ Chí Minh'}])), sorted(g.hcmc_bikes([{'shop': 'janmotorbike', 'external_id': ' 17459 ', 'city': 'Ho Chi Minh City'}]))]))`)
    expect(JSON.parse(r.out)).toEqual([['K2D7ZE'], ['ACCENT_039'], ['janmotorbike:17459']])
  })
})
