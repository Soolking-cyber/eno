import { describe, expect, it } from 'vitest'
import { numberPlaceholders, restorePlaceholders, safeTemplate, templateIntact } from './placeholders'

describe('placeholders through machine translation', () => {
  it('numbers named placeholders on the way out and names them back', () => {
    const { text, names } = numberPlaceholders('{seller} says you bought {title} for {price}.')
    expect(text).toBe('{0} says you bought {1} for {2}.')
    expect(restorePlaceholders('卖家说你以 {2} 的价格购买了 {1}。{0}', names)).toBe('卖家说你以 {price} 的价格购买了 {title}。{seller}')
    expect(restorePlaceholders('Цена: { 0 }', ['price'])).toBe('Цена: {price}') // engine spacing tolerated
    expect(restorePlaceholders('价格｛0｝', ['price'])).toBe('价格{price}') // full-width braces from a CJK engine
    expect(numberPlaceholders('No placeholders')).toEqual({ text: 'No placeholders', names: [] })
  })
  it('freezes only identifier placeholders — braces in a seller\'s own text are translated with it', () => {
    expect(numberPlaceholders('Áo thun {size M, màu đỏ} giá {price}')).toEqual({ text: 'Áo thun {size M, màu đỏ} giá {0}', names: ['price'] })
    // A text with its own {0} is sent as is: numbering it would make the way back ambiguous.
    expect(numberPlaceholders('Mẫu {0} và {price}')).toEqual({ text: 'Mẫu {0} và {price}', names: [] })
    expect(safeTemplate('Футболка {размер M}', 'T-shirt {size M}')).toBe('Футболка {размер M}') // not a template
    // Literal braces beside a placeholder: never judged (a translated "{size M}" looks like a renamed placeholder).
    expect(templateIntact('{n} шт. {размер M}', '{n} items {size M}')).toBe(true)
    expect(safeTemplate(null as unknown as string, 'Offer {price}')).toBe('Offer {price}') // a null cache value
  })
  it('safeTemplate keeps a good template, repairs ONE renamed placeholder, else falls back to English', () => {
    expect(safeTemplate('Предложите {price}, наличные', 'Offer {price}, cash')).toBe('Предложите {price}, наличные')
    expect(safeTemplate('Предложение {цена}, наличные', 'Offer {price}, cash')).toBe('Предложение {price}, наличные')
    expect(safeTemplate('可用', '{n} available')).toBe('{n} available') // dropped → English
    // Two different names renamed: order may have changed in translation — never guessed.
    expect(safeTemplate('Показано {показано} из {всего}', 'Showing {shown} of {total} listings.')).toBe('Showing {shown} of {total} listings.')
    expect(safeTemplate('Привет', 'Hello')).toBe('Привет') // no placeholders: untouched
  })
})
