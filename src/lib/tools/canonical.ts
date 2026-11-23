import { createHash } from 'node:crypto'

/**
 * WHAT A PERSON APPROVED, AS ONE STRING: a generated tool's spec in canonical JSON (object keys sorted, no spaces, arrays in
 * order), and its digest — SHA-256 of that, first 16 hex, the format the guides use (src/lib/teach-guides/digest.ts). The WHOLE
 * spec is covered: its words, formulas, ranges, tests and links. Canonical so the same spec has one digest wherever it is held:
 * eno Reach stores it as jsonb, which reorders keys; eno.vn reads it from a file. Reach binds an approval to this digest, the
 * carry checks it, and src/lib/tools/content.ts refuses to build a tool whose digest is not the reviewed one.
 * ⚠️ SERVER ONLY (node:crypto): never import it from a client component. COPIED VERBATIM into eno Reach (app/api/_tool-spec/).
 */
export function canonicalJson(v: unknown): string {
  if (v === null || typeof v === 'boolean' || typeof v === 'string') return JSON.stringify(v)
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new Error('canonicalJson: a number that is not finite')
    return JSON.stringify(v)
  }
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`
  if (typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) {
    const o = v as Record<string, unknown>
    return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(',')}}`
  }
  // undefined, a function, a Date, a Map…: not JSON, so not something a person read.
  throw new Error(`canonicalJson: ${typeof v} is not JSON`)
}

export const toolDigest = (spec: unknown): string => createHash('sha256').update(canonicalJson(spec)).digest('hex').slice(0, 16)
