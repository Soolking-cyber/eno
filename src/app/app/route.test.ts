/**
 * /app (the app-download page, a raw HTML route outside the app shell): its language is the `lang`
 * cookie, else the best Accept-Language tag by q weight — q=0 is a refusal, not a preference.
 */
import { describe, expect, it } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from './route'

const langOf = async (headers: Record<string, string>) => {
  const res = GET(new NextRequest('https://eno.vn/app', { headers: { 'user-agent': 'Mozilla/5.0 (Macintosh)', ...headers } }))
  return /<html lang="([^"]+)"/.exec(await res.text())?.[1]
}

describe('/app language', () => {
  it('follows Accept-Language by weight, skipping q=0', async () => {
    expect(await langOf({ 'accept-language': 'ru-RU,ru;q=0.9,en;q=0.8' })).toBe('ru')
    expect(await langOf({ 'accept-language': 'fr;q=0, vi;q=0.9' })).toBe('vi')
    expect(await langOf({ 'accept-language': 'fr;q=0.1, ja;q=0.9' })).toBe('ja')
    expect(await langOf({ 'accept-language': 'zh-TW,zh;q=0.9' })).toBe('zh-Hans')
    expect(await langOf({ 'accept-language': 'de-DE' })).toBe('en')
    // A malformed or out-of-range weight disqualifies its tag rather than promoting it.
    expect(await langOf({ 'accept-language': 'fr;q=bogus, vi;q=0.9' })).toBe('vi')
    expect(await langOf({ 'accept-language': 'fr;q=9, vi;q=1' })).toBe('vi')
  })
  it('a cookie wins; an unknown or prototype key does not', async () => {
    expect(await langOf({ cookie: 'lang=km', 'accept-language': 'en' })).toBe('km')
    expect(await langOf({ cookie: 'lang=toString', 'accept-language': 'th' })).toBe('th')
  })
})
