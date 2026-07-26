import { describe, expect, it } from 'vitest'
import {
  TRIP_TRANSITIONS,
  adminCanTake,
  adminNextStatuses,
  canTransition,
  edgeOwner,
  isTerminalStatus,
  nextTripStatuses,
} from './status'

/**
 * WHO may take an edge, as opposed to whether the edge exists.
 *
 * ⚠️ THE DEFECT THESE PIN. The admin queue derived its buttons from TRIP_TRANSITIONS, which knows
 * legality and nothing about ownership. So it rendered "Quoted" on a `reviewing` case, and one
 * click drove the case to `quoted` with both money columns NULL — announcing "Quote ready" to the
 * traveller for a quote that did not exist, and permanently bricking the case, because `quoted` has
 * no self-edge and only `requested` leads back to `reviewing`, so quoteAssistance's own gate then
 * refuses forever. It also rendered the traveller's accept/decline decision as operator buttons.
 *
 * Every test here would have failed against that code.
 */

const allEdges = (): [string, string][] =>
  Object.entries(TRIP_TRANSITIONS).flatMap(([from, tos]) => tos.map((to) => [from, to] as [string, string]))

describe('the money edge is not the operator’s', () => {
  it('refuses reviewing -> quoted, the edge that bricked the case', () => {
    expect(canTransition('reviewing', 'quoted')).toBe(true) // still LEGAL...
    expect(adminCanTake('reviewing', 'quoted')).toBe(false) // ...but not theirs to take.
    expect(edgeOwner('reviewing', 'quoted')).toBe('system')
  })

  it('keeps Quoted off the queue for a reviewing case', () => {
    expect(nextTripStatuses('reviewing')).toContain('quoted')
    expect(adminNextStatuses('reviewing')).not.toContain('quoted')
    // The operator is not left without a move: they can still decline or cancel.
    expect(adminNextStatuses('reviewing')).toEqual(['declined', 'cancelled'])
  })
})

describe('the traveller’s decision stays the traveller’s', () => {
  it('refuses quoted -> accepted and quoted -> declined', () => {
    for (const to of ['accepted', 'declined']) {
      expect(canTransition('quoted', to)).toBe(true)
      expect(adminCanTake('quoted', to)).toBe(false)
      expect(edgeOwner('quoted', to)).toBe('traveller')
    }
  })

  it('leaves the operator exactly one way out of a quoted case, and it is cancel', () => {
    expect(adminNextStatuses('quoted')).toEqual(['cancelled'])
  })
})

describe('everything else is still the operator’s, so the queue still works', () => {
  it.each([
    ['requested', 'reviewing'],
    ['requested', 'cancelled'],
    ['accepted', 'arranging'],
    ['arranging', 'completed'],
    ['reviewing', 'declined'],
  ])('%s -> %s stays takeable', (from, to) => {
    expect(adminCanTake(from, to)).toBe(true)
    expect(edgeOwner(from, to)).toBe('admin')
  })

  it('can still cancel from every open status', () => {
    for (const status of Object.keys(TRIP_TRANSITIONS)) {
      if (isTerminalStatus(status)) continue
      expect(adminCanTake(status, 'cancelled')).toBe(true)
    }
  })

  it('offers nothing on a terminal case', () => {
    for (const status of Object.keys(TRIP_TRANSITIONS)) {
      if (isTerminalStatus(status)) expect(adminNextStatuses(status)).toEqual([])
    }
  })
})

describe('the exhaustiveness rule — a new edge cannot arrive unowned', () => {
  /**
   * ⚠️ THE EXPECTED PARTITION IS WRITTEN OUT IN FULL, and that is the whole point.
   *
   * My first version of this test asserted only that every edge "resolves to an owner" — which agy
   * correctly called a TAUTOLOGY at the plan stage, before it was written. `edgeOwner` returns
   * 'admin' for anything not in the exceptions set, so a brand-new edge resolves to an owner
   * automatically and the test passes while nobody has decided anything. It asserted the shape of
   * the function, not the content of the decision.
   *
   * Listing the partition explicitly is the version that bites: add an edge to TRIP_TRANSITIONS
   * and this fails until somebody writes it down here, which is exactly the moment to ask whose it
   * is. This IS a second table — deliberately, and in the TEST rather than in production code,
   * where drift is a red build instead of a silent authorisation change.
   */
  const EXPECTED_OWNERS: Record<string, 'admin' | 'traveller' | 'system'> = {
    'requested->reviewing': 'admin',
    'requested->cancelled': 'admin',
    'reviewing->quoted': 'system', // money path — quoteAssistance only
    'reviewing->declined': 'admin',
    'reviewing->cancelled': 'admin',
    'quoted->accepted': 'traveller',
    'quoted->declined': 'traveller',
    'quoted->cancelled': 'admin',
    'accepted->arranging': 'admin',
    'accepted->cancelled': 'admin',
    'arranging->completed': 'admin',
    'arranging->cancelled': 'admin',
  }

  it('classifies EVERY edge in the map, and exactly as recorded here', () => {
    const actual: Record<string, string> = {}
    for (const [from, to] of allEdges()) {
      const owner = edgeOwner(from, to)
      expect(owner, `${from}->${to} has no owner`).not.toBeNull()
      actual[`${from}->${to}`] = owner!
    }
    // Both directions: a new edge appears in `actual` and fails; a deleted one disappears and fails.
    expect(actual).toEqual(EXPECTED_OWNERS)
  })

  it('never claims an owner for an edge that is not legal', () => {
    // Ownership must not become a second, contradictory legality answer.
    expect(edgeOwner('requested', 'quoted')).toBeNull()
    expect(edgeOwner('completed', 'reviewing')).toBeNull()
    expect(edgeOwner('nonsense', 'cancelled')).toBeNull()
    expect(edgeOwner('toString', 'cancelled')).toBeNull()
  })

  it('admin-takeable is always a SUBSET of legal, never a superset', () => {
    const all = Object.keys(TRIP_TRANSITIONS)
    for (const from of all) {
      for (const to of all) {
        if (adminCanTake(from, to)) expect(canTransition(from, to)).toBe(true)
      }
    }
  })

  it('answers for inherited Object keys without inventing an edge', () => {
    for (const key of ['toString', 'constructor', '__proto__', 'hasOwnProperty']) {
      expect(adminNextStatuses(key)).toEqual([])
      expect(adminCanTake(key, 'cancelled')).toBe(false)
      expect(adminCanTake('requested', key)).toBe(false)
    }
  })
})
