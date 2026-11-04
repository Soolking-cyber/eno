// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { copyCodePage } from './copy-code-page'

const write = vi.fn(async () => {})
const run = (hash: string, lang: 'en' | 'vi' = 'en') => {
  document.documentElement.innerHTML = copyCodePage(lang).replace(/^[\s\S]*?<html[^>]*>/, '').replace(/<\/html>$/, '')
  window.history.replaceState(null, '', `/api/auth/copy-code${hash}`)
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: write }, configurable: true })
  // innerHTML doesn't run scripts: run the page's own.
  new Function(document.querySelector('script')!.textContent!)()
}
const flush = () => new Promise((r) => setTimeout(r, 0))

beforeEach(() => write.mockClear())

describe('the Copy code page', () => {
  it('copies on load, says so, and takes the code out of the address', async () => {
    run('#004217')
    expect(write).toHaveBeenCalledWith('004217')
    await flush()
    expect(document.getElementById('head')!.textContent).toBe('Code copied')
    expect(document.getElementById('code')!.textContent).toBe('004217')
    expect(window.location.hash).toBe('')
  })
  it('a browser that refuses on load still shows the code and a button that copies', async () => {
    write.mockRejectedValueOnce(new Error('needs a tap') as never)
    run('#004217')
    await flush()
    expect(document.getElementById('head')!.textContent).toBe('Tap to copy your code')
    document.getElementById('copy')!.click()
    await flush()
    expect(write).toHaveBeenCalledTimes(2)
    expect(document.getElementById('head')!.textContent).toBe('Code copied')
  })
  it.each(['', '#', '#abc', '#<img src=x onerror=alert(1)>', '#12'])('a hand-made address %s shows no code and copies nothing', async (h) => {
    run(h)
    await flush()
    expect(write).not.toHaveBeenCalled()
    expect(document.getElementById('code')!.hidden).toBe(true)
    expect(document.querySelector('img')).toBeNull()
  })
  it('speaks Vietnamese', async () => {
    run('#004217', 'vi')
    await flush()
    expect(document.getElementById('head')!.textContent).toBe('Đã sao chép mã')
  })
  it('loads nothing from anywhere: no analytics could read the address', () => {
    expect(copyCodePage('en')).not.toMatch(/<script[^>]+src=|<link|<img|https?:\/\//)
  })
})
