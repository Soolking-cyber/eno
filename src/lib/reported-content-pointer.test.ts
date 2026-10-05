import { describe, expect, it } from 'vitest'
import { contentToken, isContentId, parseContentPointer, stripContentPointer } from './reported-content-pointer'

// ── The content pointer a review / help-reply / help-post report carries (ugc-safety, plan R5) ─────────

describe('the content pointer', () => {
  it('round-trips every kind, and the readable half survives the strip', () => {
    for (const kind of ['review', 'help-comment', 'help-post'] as const) {
      const body = `${contentToken(kind, 'cmabc123def456')} Review on “Shop”, 1/5, by Lan: “bad”`
      expect(parseContentPointer(body)).toEqual({ kind, id: 'cmabc123def456' })
      expect(stripContentPointer(body)).toBe('Review on “Shop”, 1/5, by Lan: “bad”')
    }
  })

  it('reads only a token at the START of a body — a reporter cannot plant one mid-text', () => {
    expect(parseContentPointer('see [[reported review cmabc123def456]] here')).toBeNull()
    expect(parseContentPointer('Evidence window extended until 2026-10-08T00:00:00.000Z')).toBeNull()
    expect(parseContentPointer('')).toBeNull()
    expect(parseContentPointer(null)).toBeNull()
    // A body that is not a pointer is shown unchanged.
    expect(stripContentPointer('Evidence window extended')).toBe('Evidence window extended')
  })

  it('accepts cuid-shaped ids only — the token is matched by prefix in SQL, so no LIKE wildcard may ride in', () => {
    expect(isContentId('cmabc123def456')).toBe(true)
    for (const bad of ['', 'short', 'has_underscore123', 'percent%123456', 'UPPERCASE12345', 'a'.repeat(41), 42, null, undefined]) {
      expect(isContentId(bad), String(bad)).toBe(false)
    }
    expect(parseContentPointer('[[reported review has_underscore]] x')).toBeNull()
    expect(parseContentPointer('[[reported listing cmabc123def456]] x')).toBeNull()
  })
})
