import { describe, it, expect } from 'vitest'
import { serializeMessage } from '@/lib/messages'

/**
 * REDACTION TESTS FOR THE ONE FUNCTION THAT TURNS A Message ROW INTO A WIRE MESSAGE.
 *
 * ⛔ WHY THIS FILE EXISTS AT ALL. A recalled message keeps its `body` in the database on purpose —
 * eno.vn runs a dispute center, and a participant must not be able to destroy the evidence of the
 * conversation they are about to be reported for. That choice is only safe while the body never
 * reaches either participant, and "never reaches" is exactly the property no rendering test can
 * see: the thread looks perfectly correct while being handed text it is merely choosing not to
 * paint. So the assertion has to be made here, against the payload.
 *
 * ⚠️ These tests take PLAIN OBJECTS, not Prisma rows. serializeMessage is deliberately typed
 * structurally so it can be exercised without a database — which is what makes the redaction
 * cheap enough to assert on every path.
 */

const ME = 'profile-me'
const THEM = 'profile-them'

function row(over: Partial<Parameters<typeof serializeMessage>[0]> = {}): Parameters<typeof serializeMessage>[0] {
  return {
    id: 'm1',
    senderProfileId: THEM,
    body: 'meet me at 12 Nguyen Hue, 0901234567',
    createdAt: new Date('2026-08-16T04:00:00.000Z'),
    kind: 'text',
    offerAmount: null,
    offerStatus: null,
    metaJson: null,
    deletedAt: null,
    reactions: [],
    replyTo: null,
    ...over,
  }
}

describe('serializeMessage — an ordinary message', () => {
  it('carries the body through untouched', () => {
    expect(serializeMessage(row(), ME).body).toBe('meet me at 12 Nguyen Hue, 0901234567')
  })

  it('derives `mine` per viewer and never leaks the sender id', () => {
    expect(serializeMessage(row(), ME).mine).toBe(false)
    expect(serializeMessage(row(), THEM).mine).toBe(true)
    expect(Object.keys(serializeMessage(row(), ME))).not.toContain('senderProfileId')
  })

  it('folds reactions per viewer and never returns raw profile ids', () => {
    const out = serializeMessage(row({
      reactions: [
        { emoji: '❤️', profileId: ME },
        { emoji: '❤️', profileId: THEM },
        { emoji: '👍', profileId: THEM },
      ],
    }), ME)
    expect(out.reactions).toEqual([
      { emoji: '❤️', count: 2, mine: true },
      { emoji: '👍', count: 1, mine: false },
    ])
    expect(JSON.stringify(out)).not.toContain(THEM)
  })
})

describe('serializeMessage — a recalled message', () => {
  const recalled = row({ deletedAt: new Date('2026-08-16T05:00:00.000Z') })

  it('⛔ never puts the body on the wire, for EITHER participant', () => {
    for (const viewer of [ME, THEM]) {
      const out = serializeMessage(recalled, viewer)
      expect(out.body).toBe('')
      // The strongest form of the assertion: no substring of the original survives anywhere in the
      // payload — not in the body, not in a preview, not in a field added later.
      expect(JSON.stringify(out)).not.toContain('Nguyen Hue')
      expect(JSON.stringify(out)).not.toContain('0901234567')
    }
  })

  it('says it was recalled, so the client can explain the empty bubble', () => {
    expect(serializeMessage(recalled, ME).deleted).toBe(true)
  })

  it('drops the tallies — a tombstone reading "❤️ 3" is a fossil of the text it removed', () => {
    const out = serializeMessage(row({
      deletedAt: new Date(),
      reactions: [{ emoji: '❤️', profileId: ME }],
    }), ME)
    expect(out.reactions).toEqual([])
  })

  it('withholds the offer payload too, not just the text', () => {
    const out = serializeMessage(row({
      deletedAt: new Date(),
      kind: 'offer',
      offerAmount: 5_000_000,
      offerStatus: 'pending',
    }), ME)
    expect(out.offerAmount).toBeNull()
    expect(out.offerStatus).toBeNull()
    // The kind SURVIVES: the client still needs to tell a text row from a card.
    expect(out.kind).toBe('offer')
  })
})

describe('serializeMessage — the quoted message in a reply', () => {
  it('quotes a live message, truncated', () => {
    const out = serializeMessage(row({
      replyTo: { id: 'm0', body: 'x'.repeat(500), senderProfileId: ME, kind: 'text', deletedAt: null },
    }), ME)
    expect(out.replyTo).toEqual({ id: 'm0', body: 'x'.repeat(160), mine: true, deleted: false })
  })

  it('⛔ redacts the quote when the QUOTED message was recalled — the leak both reviewers named', () => {
    const out = serializeMessage(row({
      replyTo: { id: 'm0', body: 'call me on 0901234567', senderProfileId: THEM, kind: 'text', deletedAt: new Date() },
    }), ME)
    expect(out.replyTo).toEqual({ id: 'm0', body: '', mine: false, deleted: true })
    expect(JSON.stringify(out.replyTo)).not.toContain('0901234567')
  })

  it('is null when the message is not a reply', () => {
    expect(serializeMessage(row(), ME).replyTo).toBeNull()
  })

  it('redacts BOTH ways at once — a recalled reply quoting a recalled message', () => {
    const out = serializeMessage(row({
      deletedAt: new Date(),
      body: 'my answer',
      replyTo: { id: 'm0', body: 'their question', senderProfileId: THEM, kind: 'text', deletedAt: new Date() },
    }), ME)
    expect(out.body).toBe('')
    expect(out.replyTo?.body).toBe('')
    expect(JSON.stringify(out)).not.toContain('question')
    expect(JSON.stringify(out)).not.toContain('answer')
  })
})
