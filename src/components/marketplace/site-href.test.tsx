// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import { SiteOriginProvider, subdomainApexOrigin, useSiteHref, withOrigin } from './site-href'

afterEach(cleanup)

describe('subdomainApexOrigin', () => {
  it('a shop host or the teacher host names the app; the app’s own host, www and other sites do not', () => {
    expect(subdomainApexOrigin('saigoncribs.eno.vn', 'https://eno.vn')).toBe('https://eno.vn')
    expect(subdomainApexOrigin('teacher.eno.vn', 'https://eno.vn')).toBe('https://eno.vn')
    expect(subdomainApexOrigin('eno.vn', 'https://eno.vn')).toBe('')
    expect(subdomainApexOrigin('www.eno.vn', 'https://eno.vn')).toBe('')
    // eno.forum's canonical host is www: its own pages must keep their paths (gate review, 2026-11-24).
    expect(subdomainApexOrigin('www.eno.forum', 'https://www.eno.forum')).toBe('')
    expect(subdomainApexOrigin('eno.forum', 'https://www.eno.forum')).toBe('')
    expect(subdomainApexOrigin('teacher.eno.forum', 'https://www.eno.forum')).toBe('https://www.eno.forum')
    expect(subdomainApexOrigin('localhost:3000', 'http://localhost:3000')).toBe('')
    expect(subdomainApexOrigin('evil-eno.vn', 'https://eno.vn')).toBe('')
    expect(subdomainApexOrigin('saigoncribs.eno.vn', undefined)).toBe('')
  })
})

describe('withOrigin', () => {
  it('prefixes a same-site path only', () => {
    expect(withOrigin('https://eno.vn', '/listings/abc')).toBe('https://eno.vn/listings/abc')
    expect(withOrigin('https://eno.vn', '/signin?next=%2F')).toBe('https://eno.vn/signin?next=%2F')
    expect(withOrigin('https://eno.vn', '//evil.example/x')).toBe('//evil.example/x')
    expect(withOrigin('https://eno.vn', 'https://zalo.me/x')).toBe('https://zalo.me/x')
    expect(withOrigin('https://eno.vn', 'mailto:support@eno.vn')).toBe('mailto:support@eno.vn')
    expect(withOrigin('', '/listings/abc')).toBe('/listings/abc')
  })
})

function Probe({ path }: { path: string }) {
  const siteHref = useSiteHref()
  return <a href={siteHref(path)} />
}

describe('useSiteHref', () => {
  it('inside the shop page\'s provider the server HTML already names the apex', () => {
    const html = renderToString(<SiteOriginProvider origin="https://eno.vn"><Probe path="/listings/abc" /></SiteOriginProvider>)
    expect(html).toContain('href="https://eno.vn/listings/abc"')
  })
  it('without a provider the server render keeps the path (the browser decides after hydration)', () => {
    expect(renderToString(<Probe path="/saved" />)).toContain('href="/saved"')
  })
  it('on the apex (jsdom: localhost) a client render keeps the path', () => {
    const { container } = render(<Probe path="/saved" />)
    expect(container.querySelector('a')!.getAttribute('href')).toBe('/saved')
  })
})
