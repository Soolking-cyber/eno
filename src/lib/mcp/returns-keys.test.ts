import { describe, expect, it } from 'vitest'

// Each tool's "Returns …" sentence names its output fields by their exact keys (2026-11-16: on Manufact's board the outputs
// scoring 95+ have descriptions naming 41–50% of their keys, against 23–33% for those at 85–94). This pins the prose to the
// schema: a key the sentence names must exist in that tool's published outputSchema, so a renamed field cannot leave the
// description promising one that is gone.
const { toolDescriptors } = await import('./tools')

const keysOf = (n: unknown, out = new Set<string>()): Set<string> => {
  if (!n || typeof n !== 'object') return out
  const node = n as Record<string, unknown>
  const props = node.properties as Record<string, unknown> | undefined
  if (props) for (const [k, v] of Object.entries(props)) { out.add(k); keysOf(v, out) }
  if (node.items) keysOf(node.items, out)
  for (const a of (node.anyOf as unknown[] | undefined) ?? []) keysOf(a, out)
  return out
}

// Error codes a Returns sentence may mention beside the keys (delete_listing: "a second call … answers `not_found`").
const ERROR_CODES = new Set(['not_found'])

describe('the Returns sentence names only real output keys', () => {
  for (const d of toolDescriptors()) {
    it(d.name, () => {
      const i = d.description.indexOf('Returns ')
      expect(i, `${d.name} has no "Returns …" sentence`).toBeGreaterThanOrEqual(0)
      const sentence = d.description.slice(i).split(/\.\s|\n\n/)[0]
      const named = [...sentence.matchAll(/`([A-Za-z_]+)`/g)].map((m) => m[1]).filter((k) => !ERROR_CODES.has(k))
      const keys = keysOf(d.outputSchema)
      expect(named.length, `${d.name}: the Returns sentence names no key`).toBeGreaterThan(0)
      expect(named.filter((k) => !keys.has(k)), `${d.name}: named but not in its outputSchema`).toEqual([])
    })
  }
  it('no published output schema carries a root description', () => {
    for (const d of toolDescriptors()) expect((d.outputSchema as Record<string, unknown>).description, d.name).toBeUndefined()
  })
})
