import { describe, expect, it } from 'vitest'
import { TRIP_TRANSITIONS, canTransition, isTerminalStatus, nextTripStatuses } from './status'

// The admin queue derives its buttons from the machine rather than restating them. These tests pin
// that relationship, because the failure they guard against is silent: a queue whose action list has
// drifted from the state machine still renders, still looks right, and offers moves the server
// refuses (or hides moves it would allow).

describe('nextTripStatuses is the ONE source of an operator’s options', () => {
  it('agrees with the transition map for every status', () => {
    for (const [from, expected] of Object.entries(TRIP_TRANSITIONS)) {
      expect(nextTripStatuses(from)).toEqual(expected)
    }
  })

  it('agrees with canTransition in both directions', () => {
    // If these ever disagree, a button either does nothing or is missing — and both look like a UI
    // bug rather than a drift between two lists.
    const all = Object.keys(TRIP_TRANSITIONS)
    for (const from of all) {
      for (const to of all) {
        expect(nextTripStatuses(from).includes(to)).toBe(canTransition(from, to))
      }
    }
  })

  it('offers NOTHING for a terminal status, so a closed case has no buttons', () => {
    for (const status of Object.keys(TRIP_TRANSITIONS)) {
      if (isTerminalStatus(status)) expect(nextTripStatuses(status)).toEqual([])
    }
    expect(nextTripStatuses('completed')).toEqual([])
    expect(nextTripStatuses('declined')).toEqual([])
    expect(nextTripStatuses('cancelled')).toEqual([])
  })

  it('offers nothing for an unknown status — the machine fails CLOSED', () => {
    expect(nextTripStatuses('refunded')).toEqual([])
    expect(nextTripStatuses('')).toEqual([])
  })

  it.each(['toString', 'constructor', 'hasOwnProperty', '__proto__', 'valueOf'])(
    'offers nothing for the inherited Object key %s',
    (key) => {
      // A bare TRIP_TRANSITIONS[status] would answer with a FUNCTION here, and the queue would try
      // to render Object.prototype members as buttons. Same inherited-key trap the trip_status card
      // schema had to close with Object.hasOwn.
      expect(nextTripStatuses(key)).toEqual([])
    },
  )

  it('hands back a COPY, so a caller cannot mutate the machine', () => {
    const moves = nextTripStatuses('requested')
    moves.push('completed')
    expect(nextTripStatuses('requested')).not.toContain('completed')
    // And the map itself is untouched.
    expect(TRIP_TRANSITIONS.requested).not.toContain('completed')
  })
})

describe('the moves an operator can be offered are exactly the legal ones', () => {
  it('never offers a jump that skips the lifecycle', () => {
    // requested -> quoted would mean quoting a case nobody reviewed; the map forbids it and so the
    // queue can never render the button.
    expect(nextTripStatuses('requested')).not.toContain('quoted')
    expect(nextTripStatuses('requested')).not.toContain('completed')
    expect(nextTripStatuses('reviewing')).not.toContain('accepted')
    expect(nextTripStatuses('quoted')).not.toContain('arranging')
  })

  it('lets every open status be cancelled, and no closed one', () => {
    for (const status of Object.keys(TRIP_TRANSITIONS)) {
      expect(nextTripStatuses(status).includes('cancelled')).toBe(!isTerminalStatus(status))
    }
  })

  it('offers the forward move the operator actually needs at each open status', () => {
    expect(nextTripStatuses('requested')).toContain('reviewing')
    expect(nextTripStatuses('reviewing')).toContain('quoted')
    expect(nextTripStatuses('accepted')).toContain('arranging')
    expect(nextTripStatuses('arranging')).toContain('completed')
  })
})
