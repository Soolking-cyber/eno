/**
 * The file shapes the Gemini product pass passes between its three steps, and the one reader for them.
 * Shared by scripts/export-enrich-scope.ts, scripts/enrich-listings-gemini.ts and scripts/apply-listing-enrichment.ts,
 * and free of side effects so each can import it without running another.
 */
import { createReadStream, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import type { EnrichAnswer } from '../src/lib/listing-enrich'

export type Snapshot = { title: string; titleVi: string | null; description: string; descriptionVi: string | null; categoryId: string; subcategorySlug: string | null; attributes: string | null }

export type ScopeRow = {
  id: string
  titleVi: string | null
  title: string
  descriptionVi: string | null
  description: string
  category: string
  subcategory: string | null
  attributes: Record<string, string>
  snap: Snapshot
}

export type DoneRow = { id: string; key: string; version: string; from: { category: string; subcategory: string | null }; snap: Snapshot; answer: EnrichAnswer }

const isStr = (v: unknown): v is string => typeof v === 'string'
const isStrOrNull = (v: unknown) => v === null || typeof v === 'string'

/**
 * ⚠️ A ROW IS CHECKED FOR SHAPE BEFORE ANYTHING USES IT. The files are ours, but the apply writes production data
 * from them: a row with a missing snapshot or `attributes: null` must be skipped and counted, not crash the run
 * after earlier chunks were already written (codex).
 */
export function isDoneRow(v: unknown): v is DoneRow {
  const d = v as DoneRow
  const s = d?.snap
  const a = d?.answer
  return !!d && isStr(d.id) && isStr(d.key) && isStr(d.version) && !!d.from && isStr(d.from.category) && isStrOrNull(d.from.subcategory)
    && !!s && isStr(s.title) && isStrOrNull(s.titleVi) && isStr(s.description) && isStrOrNull(s.descriptionVi)
    && isStr(s.categoryId) && isStrOrNull(s.subcategorySlug) && isStrOrNull(s.attributes)
    && !!a && isStr(a.category) && isStrOrNull(a.subcategory) && isStr(a.vi) && isStr(a.en)
    && (a.confidence === 'high' || a.confidence === 'medium' || a.confidence === 'low')
    && Array.isArray(a.attributes) && a.attributes.every((kv) => !!kv && isStr(kv.key) && isStr(kv.value))
}

/** Every complete, well-formed row of every `part-NNNN.jsonl`, in part order. A torn or malformed line is skipped. */
export async function* readParts(dir: string, onBad?: () => void): AsyncGenerator<DoneRow> {
  const parts = readdirSync(dir).filter((f) => /^part-\d{4}\.jsonl$/.test(f)).sort()
  for (const part of parts) {
    for await (const line of createInterface({ input: createReadStream(join(dir, part), 'utf8'), crlfDelay: Infinity })) {
      if (!line.trim()) continue
      let row: unknown
      try { row = JSON.parse(line) } catch { onBad?.(); continue }
      if (isDoneRow(row)) yield row
      else onBad?.()
    }
  }
}

/** The scope export, one row per line. A malformed line is reported and skipped, not a crash hours into a run. */
export async function readScope(file: string): Promise<{ rows: ScopeRow[]; bad: number }> {
  const rows: ScopeRow[] = []
  let bad = 0
  for await (const line of createInterface({ input: createReadStream(file, 'utf8'), crlfDelay: Infinity })) {
    if (!line.trim()) continue
    try {
      const r = JSON.parse(line) as ScopeRow
      const s = r?.snap
      // The full snapshot shape, as isDoneRow will demand of the answer — otherwise a row is paid for, then rejected forever (codex).
      if (isStr(r?.id) && isStrOrNull(r.titleVi) && isStr(r.title) && isStrOrNull(r.descriptionVi) && isStr(r.description) && isStr(r.category) && isStrOrNull(r.subcategory)
        && !!s && isStr(s.title) && isStrOrNull(s.titleVi) && isStr(s.description) && isStrOrNull(s.descriptionVi) && isStr(s.categoryId) && isStrOrNull(s.subcategorySlug) && isStrOrNull(s.attributes)) rows.push({ ...r, attributes: r.attributes ?? {} })
      else bad++
    } catch { bad++ }
  }
  return { rows, bad }
}
