import { describe, expect, it } from 'vitest'
import { vietnameseSentence } from './language'

/** The fallback test for a sentence's language (language.ts): the tutor's Vietnamese help comes in its own field. */
describe('vietnameseSentence', () => {
  it('Vietnamese help, as the tutor writes it, is Vietnamese', () => {
    for (const s of [
      'Sở thích nghĩa là điều bạn thích làm khi rảnh.',
      'Câu hỏi này hỏi bạn thường làm gì vào cuối tuần.',
      'Bạn có thể nói: tôi thích đọc sách.',
      'Đúng rồi!',
      'Hãy nói với bố mẹ hoặc thầy cô nhé.',
      'Từ "good" nghĩa là tốt.', // the English word it explains is quoted
      '‘Please’ là làm ơn.',
      'Chị My rất tốt.', // a name, not the English "my"
      'My ơi, con giỏi lắm!',
    ]) expect(vietnameseSentence(s), s).toBe(true)
  })
  it('English — with a Vietnamese name in it, a dish, or an accented loanword among other words — is English', () => {
    for (const s of ['I live in Đà Nẵng.', 'Have you been to Hà Nội?', 'Do you like phở?', 'What is your hobby?', 'Hà Nội is big.', 'Let us order a café latte.', 'Bánh mì or phở?', 'Phở, please!', 'My phở is hot.', '']) {
      expect(vietnameseSentence(s), s).toBe(false)
    }
  })
  it('decomposed diacritics (NFD, as some keyboards send) read the same', () => {
    expect(vietnameseSentence('Sở thích nghĩa là điều bạn thích.'.normalize('NFD'))).toBe(true)
  })
})
