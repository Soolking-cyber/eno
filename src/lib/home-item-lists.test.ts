import { describe, expect, it } from 'vitest'
import { homeItemListsJsonLd, jsonLdText } from './home-item-lists'

describe('home ItemList JSON-LD', () => {
  it('one ItemList per drawn list, URL-only items in order, the card\'s own link', () => {
    const ld = homeItemListsJsonLd([
      { name: 'Trending now', items: [{ id: 'a1' }, { id: 'b2' }] },
      { name: 'Rentals', items: [{ id: 'c3' }] },
    ], 'https://eno.vn')!
    expect(ld['@context']).toBe('https://schema.org')
    expect(ld['@graph']).toEqual([
      { '@type': 'ItemList', name: 'Trending now', numberOfItems: 2, itemListElement: [{ '@type': 'ListItem', position: 1, url: 'https://eno.vn/listings/a1' }, { '@type': 'ListItem', position: 2, url: 'https://eno.vn/listings/b2' }] },
      { '@type': 'ItemList', name: 'Rentals', numberOfItems: 1, itemListElement: [{ '@type': 'ListItem', position: 1, url: 'https://eno.vn/listings/c3' }] },
    ])
  })

  it('an empty or unnamed list is not marked up; no list at all → nothing', () => {
    expect(homeItemListsJsonLd([{ name: 'Kids', items: [] }, { name: ' ', items: [{ id: 'x' }] }], 'https://eno.vn')).toBeNull()
  })

  it('⛔ nothing but position and url per item — no name, price or image is repeated as data', () => {
    const ld = homeItemListsJsonLd([{ name: 'Find a teacher', items: [{ id: 't1', title: 'Ms A', price: 1 } as { id: string }] }], 'https://eno.vn')!
    const item = (ld['@graph'] as Array<{ itemListElement: Record<string, unknown>[] }>)[0].itemListElement[0]
    expect(Object.keys(item).sort()).toEqual(['@type', 'position', 'url'])
  })

  it('the script text cannot close its own tag', () => {
    expect(jsonLdText({ name: '</script><script>x' })).not.toContain('</script>')
  })
})
