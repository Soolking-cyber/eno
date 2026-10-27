/**
 * Reading the concierge's answer WHILE IT IS WRITTEN — `{"action":{…},"say":"…","chips":[…]}` streamed as text deltas
 * (brain.ts). The action must be acted on the moment its object closes and each sentence of `say` spoken the moment it
 * ends, so neither waits for the whole answer. Pure, no allocation beyond the text.
 * (The classroom reads only string fields — llm-openai.ts partialString, which matches the first `"field":"` anywhere; this
 * reads TOP-LEVEL members only, so a nested key can never be mistaken for one.)
 */

/** One top-level member of a JSON object still being written: its key, its raw value text so far, and whether it ended. */
export type Member = { key: string; raw: string; complete: boolean }

/** The top-level members of a (possibly unfinished) JSON object. Strings, objects and arrays are skipped with their
 *  escapes and nested brackets respected. Pure. */
export function topLevelMembers(json: string): Member[] {
  const out: Member[] = []
  const n = json.length
  let i = json.indexOf('{')
  if (i < 0) return out
  i++
  const ws = () => { while (i < n && (json[i] === ' ' || json[i] === '\n' || json[i] === '\r' || json[i] === '\t')) i++ }
  /** End (exclusive) of the string opening at `from`, or -1 while it is still being written. */
  const strEnd = (from: number) => {
    for (let j = from + 1; j < n; j++) {
      if (json[j] === '\\') { j++; continue }
      if (json[j] === '"') return j + 1
    }
    return -1
  }
  for (;;) {
    ws()
    if (i < n && json[i] === ',') { i++; ws() }
    if (i >= n || json[i] !== '"') return out
    const kEnd = strEnd(i)
    if (kEnd < 0) return out
    const key = JSON.parse(json.slice(i, kEnd)) as string
    i = kEnd
    ws()
    if (i >= n || json[i] !== ':') return out
    i++
    ws()
    if (i >= n) return out
    const start = i
    const c = json[i]
    if (c === '"') {
      const e = strEnd(i)
      if (e < 0) { out.push({ key, raw: json.slice(start), complete: false }); return out }
      out.push({ key, raw: json.slice(start, e), complete: true })
      i = e
      continue
    }
    if (c === '{' || c === '[') {
      let depth = 0
      let end = -1
      for (let j = i; j < n; j++) {
        const ch = json[j]
        if (ch === '"') { const e = strEnd(j); if (e < 0) break; j = e - 1; continue }
        if (ch === '{' || ch === '[') depth++
        else if (ch === '}' || ch === ']') { depth--; if (depth === 0) { end = j + 1; break } }
      }
      if (end < 0) { out.push({ key, raw: json.slice(start), complete: false }); return out }
      out.push({ key, raw: json.slice(start, end), complete: true })
      i = end
      continue
    }
    // A number, true, false or null: complete once a delimiter follows it.
    let j = i
    while (j < n && json[j] !== ',' && json[j] !== '}' && !/\s/.test(json[j])) j++
    if (j >= n) { out.push({ key, raw: json.slice(start), complete: false }); return out }
    out.push({ key, raw: json.slice(start, j), complete: true })
    i = j
  }
}

/** The text of a (possibly unfinished) JSON string literal, escapes decoded; an escape cut in half waits for more. Pure. */
export function partialText(raw: string): string {
  let out = ''
  for (let i = 1; i < raw.length; i++) {
    const ch = raw[i]
    if (ch === '"') return out
    if (ch === '\\') {
      const nx = raw[i + 1]
      if (nx === undefined) return out
      if (nx === 'u') {
        const h = raw.slice(i + 2, i + 6)
        if (h.length < 4) return out
        out += String.fromCharCode(parseInt(h, 16))
        i += 5
        continue
      }
      out += nx === 'n' ? '\n' : nx === 't' ? '\t' : nx === 'r' ? '\r' : nx === 'b' ? '\b' : nx === 'f' ? '\f' : nx
      i++
      continue
    }
    out += ch
  }
  return out
}
