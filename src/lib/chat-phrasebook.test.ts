import { describe, expect, it } from 'vitest'
import { markedKey, phrasebook, phraseKey } from './chat-phrasebook'

describe('phrasebook — the lines the model gets wrong are looked up', () => {
  it.each([
    ['Bạn khỏe không', 'How are you?'], // the model: "You are well."
    ['ban khoe khong', 'How are you?'],
    ['Xin chào', 'Hello'], // the model: "Hello to"
    ['Dạ', 'Yes'], // the model: "and"
    ['còn phòng không?', 'Is the room still available?'], // the model: "There is room."
    ['Cảm ơn bạn nhiều!', 'Thank you very much'],
  ])('vi %s → %s', (vi, en) => expect(phrasebook(vi, 'vi', 'en')).toBe(en))

  it.each([
    ['How are you?', 'Bạn khỏe không?'],
    ['Thank you so much!', 'Cảm ơn bạn rất nhiều'],
    ["You're welcome", 'Không có gì'],
    ['Is the room still available?', 'Phòng còn trống không?'],
  ])('en %s → %s', (en, vi) => expect(phrasebook(en, 'en', 'vi')).toBe(vi))

  it('looks up whole lines only, and only Vietnamese ⇄ English', () => {
    expect(phrasebook('Bạn khỏe không, phòng còn không', 'vi', 'en')).toBeUndefined()
    expect(phrasebook('Xin chào', 'vi', 'ko')).toBeUndefined()
  })

  it('one key for every way of writing a line', () => {
    expect(phraseKey('CẢM ƠN BẠN!!')).toBe('cam on ban')
    expect(phraseKey("you're  welcome :)")).toBe('youre welcome')
  })
})


describe('marks are meaning — a line written with them is matched with them', () => {
  it.each(['Vàng', 'Đã', 'Đá', 'Dâu'])('%s is not "Yes" or anything else', (vi) => expect(phrasebook(vi, 'vi', 'en')).toBeUndefined())
  it('both tone-placement styles are one entry', () => {
    expect(phrasebook('Bạn khoẻ không', 'vi', 'en')).toBe('How are you?')
    expect(markedKey('Khoẻ')).toBe(markedKey('Khỏe'))
  })
  it('a line typed with no marks at all still finds its phrase', () => {
    expect(phrasebook('da vang', 'vi', 'en')).toBe('Yes')
  })
  it('trailing emoji ride along', () => {
    expect(phrasebook('thank you 🙏', 'en', 'vi')).toBe('Cảm ơn bạn 🙏')
  })
})


