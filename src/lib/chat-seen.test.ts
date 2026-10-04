import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { seenReceipt } from './chat-seen'

/**
 * 'ĐÃ XEM / ĐÃ GỬI' (inbox-07). The receipt is the other side's unread counter at zero, as of the server's
 * `seenAsOf`: shown under my newest message only, and 'Đã xem' only for a message created by that instant —
 * so nothing appended after the read, by ANY path, can claim to have been seen.
 */
const AS_OF = '2026-10-04T10:00:00.000Z'
const before = '2026-10-04T09:59:00.000Z'
const after = '2026-10-04T10:00:05.000Z'
const mine = (id: string, createdAt = before, extra: Record<string, unknown> = {}) => ({ id, mine: true, createdAt, ...extra })
const theirs = (id: string, createdAt = before) => ({ id, mine: false, createdAt })

describe('where the receipt sits — my newest message, once the server has it', () => {
  it('my newest message, even with their reply after it', () => {
    expect(seenReceipt([mine('a'), mine('b'), theirs('c')], true, AS_OF)).toEqual({ anchorId: 'b', seen: true })
    expect(seenReceipt([mine('a'), mine('b')], false, AS_OF)).toEqual({ anchorId: 'b', seen: false })
  })

  it('nothing while my newest is still in flight, failed, recalled or a temp', () => {
    expect(seenReceipt([mine('a'), mine('b', before, { pending: true })], true, AS_OF)).toBeNull()
    expect(seenReceipt([mine('a'), mine('b', before, { failed: true })], true, AS_OF)).toBeNull()
    expect(seenReceipt([mine('a'), mine('b', before, { deleted: true })], true, AS_OF)).toBeNull()
    expect(seenReceipt([mine('a'), mine('temp-123')], true, AS_OF)).toBeNull()
  })

  it('nothing when I have not written, or the payload predates the field', () => {
    expect(seenReceipt([theirs('a')], true, AS_OF)).toBeNull()
    expect(seenReceipt([], false, AS_OF)).toBeNull()
    expect(seenReceipt([mine('a')], undefined, AS_OF)).toBeNull()
  })
})

describe('⛔ "Đã xem" only for what the read could vouch for — every path, by construction', () => {
  it('a message created AFTER seenAsOf says "Đã gửi" even though the counter said seen', () => {
    expect(seenReceipt([mine('a', before), mine('b', after)], true, AS_OF)).toEqual({ anchorId: 'b', seen: false })
  })

  it('the bound is the message, not its kind: an offer card or a photo appended after the read is "Đã gửi" too', () => {
    const offer = { id: 'o1', mine: true, createdAt: after, kind: 'offer', offerAmount: 4_000_000 }
    const photo = { id: 'p1', mine: true, createdAt: after, kind: 'image' }
    expect(seenReceipt([mine('a'), offer], true, AS_OF)).toEqual({ anchorId: 'o1', seen: false })
    expect(seenReceipt([mine('a'), photo], true, AS_OF)).toEqual({ anchorId: 'p1', seen: false })
    // …and the same card created before the read is covered.
    expect(seenReceipt([mine('a'), { ...offer, createdAt: before }], true, AS_OF)).toEqual({ anchorId: 'o1', seen: true })
  })

  it('created exactly at seenAsOf is covered (the read began after it)', () => {
    expect(seenReceipt([mine('a', AS_OF)], true, AS_OF)?.seen).toBe(true)
  })

  it('no seenAsOf, or an unreadable date, never claims "Đã xem"', () => {
    expect(seenReceipt([mine('a')], true, undefined)).toEqual({ anchorId: 'a', seen: false })
    expect(seenReceipt([mine('a', 'not a date')], true, AS_OF)).toEqual({ anchorId: 'a', seen: false })
  })
})

describe('the wiring (source contracts — neither file is render-tested for this)', () => {
  const page = readFileSync(join(process.cwd(), 'src/app/[lang]/messages/[id]/page.tsx'), 'utf8')
  const route = readFileSync(join(process.cwd(), 'src/app/api/conversations/[id]/route.ts'), 'utf8')

  it('the thread page reads the receipt from seenReceipt, bounded by the payload\'s seenAsOf', () => {
    expect(page).toContain('seenReceipt(thread.messages, thread.counterpartSeen, thread.seenAsOf)')
  })

  it('the route stamps seenAsOf BEFORE it reads the unread counters — a message landing mid-request falls outside the claim', () => {
    const stamp = route.indexOf('const seenAsOf = new Date().toISOString()')
    const read = route.indexOf('db.conversation.findUnique(')
    expect(stamp, 'seenAsOf moved or was renamed — update this test, do not delete it').toBeGreaterThan(-1)
    expect(read).toBeGreaterThan(stamp)
  })
})
