// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { SEARCH_UI_URI, SHOP_UI_URI, UI_MIME, listingCardsHtml, toolUiMeta, uiResourceList, uiResourceRead } from './apps'
import { OAUTH_ISSUER } from '@/lib/api/oauth'

const SITE = new URL(OAUTH_ISSUER).origin

const page = listingCardsHtml()
const script = page.slice(page.indexOf('<script>') + '<script>'.length, page.lastIndexOf('</script>'))

/** Load the page into this jsdom document and run its script, as a host's iframe would. */
function mount() {
  const parser = new DOMParser()
  const doc = parser.parseFromString(page.replace(/<script>[\s\S]*<\/script>/, ''), 'text/html')
  document.documentElement.innerHTML = doc.documentElement.innerHTML
  const sent: Array<Record<string, unknown>> = []
  const parent = window.parent
  ;(window as unknown as { parent: unknown }).parent = { postMessage: (m: Record<string, unknown>) => sent.push(m) }
  new Function(script)()
  const host = (window as unknown as { parent: unknown }).parent
  const deliver = (data: unknown) => window.dispatchEvent(new MessageEvent('message', { data, source: host as Window }))
  return { sent, deliver, restore: () => { (window as unknown as { parent: unknown }).parent = parent } }
}

describe('MCP Apps resources', () => {
  it('lists and reads the card page as text/html;profile=mcp-app, with the CSP limited to this site and its storage', () => {
    expect(uiResourceList([SEARCH_UI_URI])).toEqual([expect.objectContaining({ uri: SEARCH_UI_URI, mimeType: UI_MIME })])
    const read = uiResourceRead(SHOP_UI_URI, [SHOP_UI_URI])!
    expect(read.contents[0]).toMatchObject({ uri: SHOP_UI_URI, mimeType: 'text/html;profile=mcp-app' })
    expect(read.contents[0].text.startsWith('<!DOCTYPE html>')).toBe(true)
    for (const d of read.contents[0]._meta.ui.csp.resourceDomains) expect(d).toMatch(/^https:\/\/[a-z0-9.-]+$/)
    expect(uiResourceRead('ui://eno/other.html', [SHOP_UI_URI])).toBeNull()
    expect(uiResourceRead(SEARCH_UI_URI, [SHOP_UI_URI])).toBeNull()
    expect(toolUiMeta(SEARCH_UI_URI)).toEqual({ ui: { resourceUri: SEARCH_UI_URI }, 'openai/outputTemplate': SEARCH_UI_URI })
  })

  it('the page never writes HTML from data, and its script parses', () => {
    expect(page).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write/)
    expect(() => new Function(script)).not.toThrow()
  })
})

describe('the card page in a host', () => {
  it('starts with ui/initialize, then announces initialized, and renders a tool result as cards with seller text as TEXT', async () => {
    const { sent, deliver, restore } = mount()
    try {
      const init = sent.find((m) => m.method === 'ui/initialize')!
      expect(init).toBeTruthy()
      deliver({ jsonrpc: '2.0', id: init.id, result: { hostContext: { theme: 'dark', locale: 'en-US' } } })
      await new Promise((r) => setTimeout(r, 0))
      expect(sent.some((m) => m.method === 'ui/notifications/initialized')).toBe(true)
      const evil = '<img src=x onerror="window.__pwned=1">'
      deliver({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: { structuredContent: { listings: [
        { title: evil, price: 12000000, price_unit: 'VND/month', district: 'Thủ Đức', city: 'Hồ Chí Minh', image: 'https://sb.eno.vn/a.jpg', url: `${SITE}/listings/x`, sponsored: true },
        { title: 'Phone', price: 0, url: 'https://evil.example/x', image: 'http://insecure.example/a.jpg' },
      ], total: 2 } } })
      const cards = document.querySelectorAll('.card')
      expect(cards).toHaveLength(2)
      expect(cards[0].querySelector('.title')!.textContent).toBe(evil)
      expect(document.querySelectorAll('img')).toHaveLength(1) // only the https storage photo; the title made no element
      expect(cards[0].querySelector('.price')!.textContent).toContain('12.000.000')
      expect(cards[0].querySelector('.price')!.textContent).toContain('/ month')
      expect(cards[0].textContent).toContain('Ad')
      expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
      ;(cards[0] as HTMLElement).click()
      expect(sent.some((m) => m.method === 'ui/open-link' && (m.params as { url: string }).url === `${SITE}/listings/x`)).toBe(true)
      const before = sent.length
      ;(cards[1] as HTMLElement).click() // an off-site url opens nothing
      expect(sent.slice(before).some((m) => m.method === 'ui/open-link')).toBe(false)
      expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined()
    } finally { restore() }
  })

  it('renders one listing (get_listing / get_listing_details) and an empty result', () => {
    const { deliver, restore } = mount()
    try {
      deliver({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: { structuredContent: { listing: { title: 'Sofa', price: 3500000, status: 'sold', cover: 'https://sb.eno.vn/s.jpg', url: `${SITE}/listings/s` } } } })
      expect(document.querySelectorAll('.card')).toHaveLength(1)
      expect(document.querySelector('.tags')!.textContent).toContain('Sold')
      deliver({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: { structuredContent: { listings: [] } } })
      expect(document.querySelector('.empty')!.textContent).toBe('No listings found.')
      // The host switches to Vietnamese after the result: the cards are redrawn in it.
      deliver({ jsonrpc: '2.0', method: 'ui/notifications/host-context-changed', params: { locale: 'vi-VN' } })
      expect(document.querySelector('.empty')!.textContent).toBe('Không tìm thấy tin nào.')
      deliver({ jsonrpc: '2.0', method: 'ui/notifications/host-context-changed', params: { locale: 'en-US' } })
      // A failed call shows its own message, never "No listings found."
      deliver({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: { code: 'unauthorized', message: 'This tool needs an API key.' } }) }] } })
      expect(document.querySelector('.empty')!.textContent).toBe('This tool needs an API key.')
      deliver({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: { structuredContent: { listing: { title: 'Room', price: 400000, priceUnit: 'VND/night', url: `${SITE}/listings/r` } } } })
      expect(document.querySelector('.price')!.textContent).toContain('/ night')
    } finally { restore() }
  })
})
