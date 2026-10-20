import { describe, expect, it } from 'vitest'
import { JOB_DM_KEEP_TEXTS, JOB_DM_STOP_TEXTS, isStopReply } from './replies'

/**
 * THE SERVER'S READING OF A STOP (teacher job DMs, 2026-10-20). The jobs desk's "Stop job messages" chip and a typed STOP
 * switch job messages OFF; a sentence that merely contains the word does not. Case- and diacritic-insensitive, because a
 * phone keyboard capitalises and Vietnamese is often typed without its marks.
 */

describe('the chip texts', () => {
  it('are the words the chips send, per language', () => {
    expect(JOB_DM_STOP_TEXTS).toEqual({ en: 'Stop job messages', vi: 'Dừng tin nhắn việc làm' })
    expect(JOB_DM_KEEP_TEXTS).toEqual({ en: 'Keep sending jobs', vi: 'Gửi tiếp việc làm' })
  })

  it('the stop chip is a stop in both languages; the keep chip is not', () => {
    expect(isStopReply(JOB_DM_STOP_TEXTS.en)).toBe(true)
    expect(isStopReply(JOB_DM_STOP_TEXTS.vi)).toBe(true)
    expect(isStopReply(JOB_DM_KEEP_TEXTS.en)).toBe(false)
    expect(isStopReply(JOB_DM_KEEP_TEXTS.vi)).toBe(false)
  })
})

describe('isStopReply — a whole short message that asks to stop', () => {
  it.each([
    'STOP', 'stop', 'Stop', 'Stop.', 'stop!', '  stop  ', 'STOP please', 'Please stop', 'stop it', 'stop thanks',
    'unsubscribe', 'Unsubscribe', 'UNSUBSCRIBE.',
    'no more', 'No more!', 'NO MORE please', 'no more jobs', 'no more messages',
    'dừng', 'Dừng', 'DỪNG', 'dung lai', 'Dừng nhé', 'dừng tin nhắn', 'hủy', 'Hủy đăng ký', 'huy dang ky',
    'ngừng', 'Ngừng', 'NGỪNG', 'ngung', 'ngừng giúp mình',
    'stop job messages', 'STOP JOB MESSAGES', 'Stop job messages.',
    'dừng tin nhắn việc làm', 'DUNG TIN NHAN VIEC LAM', 'Dung tin nhan viec lam',
  ])('%j is a stop', (text) => {
    expect(isStopReply(text)).toBe(true)
  })

  it.each([
    // folded, "dung" is also "đúng" (right) and the name Dũng, "huy" the name Huy (opus, gate 2a)
    'dung', 'Đúng ạ', 'đúng nha', 'Dũng', 'Huy', 'huy a',
    'the bus stop near the school?',
    'Can you stop by the school tomorrow?',
    "I don't want to stop teaching kids, any more jobs?",
    'Keep sending jobs',
    'Gửi tiếp việc làm',
    'Thanks, I applied!',
    'stopwatch',
    'nonstop',
    'more jobs please',
    'Dừng xe ở đâu ạ?',
  ])('%j is not a stop', (text) => {
    expect(isStopReply(text)).toBe(false)
  })

  it('nothing is not a stop', () => {
    expect(isStopReply('')).toBe(false)
    expect(isStopReply('   ')).toBe(false)
    expect(isStopReply(null)).toBe(false)
    expect(isStopReply(undefined)).toBe(false)
  })

  it('a long message is never read as a stop, whatever it starts with', () => {
    expect(isStopReply(`stop ${'please '.repeat(20)}`)).toBe(false)
  })
})
