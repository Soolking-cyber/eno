/**
 * "WORKING ON" — the recurring mistakes of one learner (ClassroomEnrollment.focusItems), the thread that ties the sessions
 * together (owner: "ai can adjust next practice to help student improve their mistakes"). Each report adds what it found
 * and marks what the learner got right; an item counts how often it came back, and is FIXED once the learner gets it right
 * twice since it last came up wrong (mergeFocus). The tutor brings the open ones back (tutor-ai.ts "Recycle"); the teacher
 * sees the list.
 * Pure — the feedback builder reads and writes the column.
 */
export type FocusKind = 'grammar' | 'vocabulary' | 'pronunciation'

export type FocusItem = {
  /** Stable key: kind + the normalised label ("grammar:past tense -ed"). */
  key: string
  kind: FocusKind
  /** What the teacher reads and the tutor recycles ("past tense -ed", "the 'th' sound in think"). */
  label: string
  /** How many sessions it came up in. */
  count: number
  /** Sessions in a row the learner got it right since it last came up. 2 → fixed. */
  rightStreak: number
  lastSeen: string
  fixed: boolean
}

export const MAX_ITEMS = 20
const FIXED_AFTER = 2

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 80)

export function parseFocusItems(v: unknown): FocusItem[] {
  if (!Array.isArray(v)) return []
  return v.flatMap((x): FocusItem[] => {
    const o = x && typeof x === 'object' ? (x as Record<string, unknown>) : {}
    const kind: FocusKind | null = o.kind === 'grammar' || o.kind === 'vocabulary' || o.kind === 'pronunciation' ? o.kind : null
    const label = typeof o.label === 'string' ? o.label.slice(0, 80).trim() : ''
    if (!kind || !label) return []
    return [{
      key: `${kind}:${norm(label)}`, kind, label,
      count: Number.isInteger(o.count) ? (o.count as number) : 1,
      rightStreak: Number.isInteger(o.rightStreak) ? (o.rightStreak as number) : 0,
      lastSeen: typeof o.lastSeen === 'string' ? o.lastSeen : new Date(0).toISOString(),
      fixed: o.fixed === true,
    }]
  }).slice(0, MAX_ITEMS)
}

/**
 * One report's findings merged in. `found` came up again: count+1, `rightStreak` back to 0, reopened if it was fixed.
 * `rightAgain` (WORKING ON lines the report says the learner now got right — "kind: label", as workingOnLines hands them
 * over) adds one to `rightStreak`. ⛔ THE RULE IS "RIGHT TWICE SINCE IT LAST CAME UP WRONG" — not "two sessions running":
 * a session that gave no evidence either way (the item was not worked on — only the top lines are) neither credits nor
 * resets it (core review, codex round 2 asked for the doc to match; opus round 3 showed why resetting on silence would
 * strand every item below the top lines). Matching is by KIND + label (opus: "th" the sound and "th" a spelling are two).
 * ⛔ A NEW MISTAKE ALWAYS FITS (opus): when the list is full the item dropped is a fixed one, else the open one seen
 * longest ago — never this session's newest finding. Shown open first, most frequent first.
 */
export function mergeFocus(items: FocusItem[], found: { kind: FocusKind; label: string }[], rightAgain: string[], now: Date): FocusItem[] {
  const byKey = new Map(items.map((i) => [i.key, { ...i }]))
  const seen = new Set<string>()
  for (const f of found) {
    const label = f.label.slice(0, 80).trim()
    if (!norm(label)) continue // a blank label is no item (round 6, opus) — parseFocusItems would drop it on the next read
    const key = `${f.kind}:${norm(label)}`
    if (seen.has(key)) continue
    seen.add(key)
    const cur = byKey.get(key)
    if (cur) Object.assign(cur, { count: cur.count + 1, rightStreak: 0, fixed: false, lastSeen: now.toISOString() })
    else byKey.set(key, { key, kind: f.kind, label, count: 1, rightStreak: 0, fixed: false, lastSeen: now.toISOString() })
  }
  const right = new Set(rightAgain.map(keyOfLine).filter(Boolean))
  for (const item of byKey.values()) {
    if (seen.has(item.key) || item.fixed) continue
    if (right.has(item.key)) {
      item.rightStreak += 1
      if (item.rightStreak >= FIXED_AFTER) item.fixed = true
    }
  }
  const all = [...byKey.values()]
  // Over the cap: drop fixed items first, then the open ones seen longest ago — this session's findings stay.
  const keep = new Set(all
    .sort((a, b) => Number(seen.has(b.key)) - Number(seen.has(a.key)) || Number(a.fixed) - Number(b.fixed) || b.lastSeen.localeCompare(a.lastSeen))
    .slice(0, MAX_ITEMS).map((i) => i.key))
  return all.filter((i) => keep.has(i.key))
    .sort((a, b) => Number(a.fixed) - Number(b.fixed) || b.count - a.count || b.lastSeen.localeCompare(a.lastSeen))
}

/** "grammar: past tense -ed" → its key; a line without a known kind matches nothing (a guess is never credited). */
function keyOfLine(line: string): string {
  const m = /^\s*(grammar|vocabulary|pronunciation)\s*:\s*(.+)$/i.exec(line)
  return m ? `${m[1].toLowerCase()}:${norm(m[2])}` : ''
}

/** The open items as "kind: label", most frequent first — what the tutor recycles and the report credits back. */
export function workingOnLines(v: unknown, n = 5): string[] {
  return parseFocusItems(v).filter((i) => !i.fixed)
    .sort((a, b) => b.count - a.count || b.lastSeen.localeCompare(a.lastSeen))
    .slice(0, n).map((i) => `${i.kind}: ${i.label}`)
}
