import { describe, expect, it } from 'vitest'
import { CHAT_CATEGORY, CHAT_REPLY_ACTION, replyPlan } from './native-push-reply'

/**
 * iOS 1.3 — "Reply" under a chat notification. The web sends the words with its own session; replyPlan decides whether an
 * action is a reply it may send, and for which thread (native-push.tsx). Anything it refuses is an ordinary tap.
 */
const NOTIF_ID = '5B1C1C1E-2D8E-4C55-9F1B-0C1C9E6A7A11'
const reply = (over: { actionId?: string; inputValue?: string; to?: unknown; id?: string } = {}) => ({
  actionId: over.actionId ?? 'reply',
  inputValue: over.inputValue ?? '  Is it still available?  ',
  notification: { id: over.id ?? NOTIF_ID, data: { url: '/messages/c1', to: 'to' in over ? over.to : 'p1' } },
})

describe('replyPlan', () => {
  it('the contract names the Swift category uses (ios-native-shell.test.ts reads them there)', () => {
    expect(CHAT_CATEGORY).toBe('eno.chat')
    expect(CHAT_REPLY_ACTION).toBe('reply')
  })

  it('a reply from the account the push was for: the thread, the trimmed words, an idempotent client id', () => {
    expect(replyPlan(reply(), '/messages/c1', 'p1')).toEqual({
      conversationId: 'c1', text: 'Is it still available?', clientId: `push-reply-${NOTIF_ID}`, path: '/messages/c1',
    })
  })

  it('the client id stays within the messages route\'s 64 characters', () => {
    expect(replyPlan(reply({ id: 'x'.repeat(200) }), '/messages/c1', 'p1')?.clientId).toHaveLength(64)
  })

  it('a plain tap, a dismissal or an empty reply is not a reply', () => {
    expect(replyPlan(reply({ actionId: 'tap' }), '/messages/c1', 'p1')).toBeNull()
    expect(replyPlan(reply({ actionId: 'dismiss' }), '/messages/c1', 'p1')).toBeNull()
    expect(replyPlan(reply({ inputValue: '   ' }), '/messages/c1', 'p1')).toBeNull()
  })

  it('⛔ never as another account: a push for someone else, or with no reader named, sends nothing', () => {
    expect(replyPlan(reply({ to: 'p2' }), '/messages/c1', 'p1')).toBeNull()
    expect(replyPlan(reply({ to: undefined }), '/messages/c1', 'p1')).toBeNull()
    expect(replyPlan(reply(), '/messages/c1', null)).toBeNull()
  })

  it('only a thread path: anything else (a listing, a call, junk) is not a reply', () => {
    expect(replyPlan(reply(), '/listings/l1', 'p1')).toBeNull()
    expect(replyPlan(reply(), '/messages/c1?call=k1', 'p1')).toBeNull()
    expect(replyPlan(reply(), '/messages/../admin', 'p1')).toBeNull()
    expect(replyPlan(reply(), null, 'p1')).toBeNull()
  })
})
