import { describe, expect, it } from 'vitest'
import { areaFromFacebook, areaFromTyped } from './area'

describe('areaFromFacebook', () => {
  it.each([
    ['Quận 12, Hồ Chí Minh', 'Quận 12', 'Hồ Chí Minh'],
    ['District 7, Ho Chi Minh City', 'Quận 7', 'Hồ Chí Minh'],
    ['Q.3, TP HCM', 'Quận 3', 'Hồ Chí Minh'],
    ['Binh Thanh District, Ho Chi Minh City, Vietnam', 'Binh Thanh', 'Hồ Chí Minh'],
    ['Thành phố Thủ Đức, Hồ Chí Minh', 'TP. Thủ Đức', 'Hồ Chí Minh'],
    ['Cầu Giấy, Hanoi', 'Cầu Giấy', 'Hà Nội'],
    ['Hải Châu, Đà Nẵng, VN', 'Hải Châu', 'Đà Nẵng'],
  ])('%s → %s in %s', (text, district, city) => expect(areaFromFacebook(text)).toEqual({ district, city }))
  it.each([['Ho Chi Minh City, Vietnam', 'Hồ Chí Minh'], ['Thành phố Hồ Chí Minh, Hồ Chí Minh', 'Hồ Chí Minh'], ['Hanoi', 'Hà Nội']])('%s names no area: the seller types it', (text, city) => expect(areaFromFacebook(text)).toEqual({ district: null, city }))
  it('a place outside the list is never filed under Ho Chi Minh City', () => expect(areaFromFacebook('Nowhere Town')).toEqual({ district: 'Nowhere Town', city: 'Nowhere Town' }))
  it.each([[null], [undefined], [''], ['  ,  '], ['Vietnam']])('%s gives nothing', (text) => expect(areaFromFacebook(text)).toEqual({ district: null, city: null }))
})

describe('areaFromTyped', () => {
  it.each([
    ['Quận 3', null, 'Quận 3', 'Hồ Chí Minh'],
    ['Quận 1', 'Hà Nội', 'Quận 1', 'Hồ Chí Minh'],
    ['District 7', null, 'Quận 7', 'Hồ Chí Minh'],
    ['Cầu Giấy, Hà Nội', 'Hồ Chí Minh', 'Cầu Giấy', 'Hà Nội'],
    ['Hải Châu', 'Đà Nẵng', 'Hải Châu', 'Đà Nẵng'],
    ['Hải Châu', null, 'Hải Châu', null],
  ])('%s with %s known → %s in %s', (text, known, district, city) => expect(areaFromTyped(text, known)).toEqual({ district, city }))
  it('names only a province: no area yet, but the province is kept', () => expect(areaFromTyped('Hanoi', null)).toEqual({ district: null, city: 'Hà Nội' }))
  it('nothing typed', () => expect(areaFromTyped('  ', 'Hà Nội')).toEqual({ district: null, city: 'Hà Nội' }))
})

