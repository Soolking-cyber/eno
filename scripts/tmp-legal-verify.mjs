// tmp legal re-verification — headless checks against localhost:3124. DELETE AFTER.
import { chromium } from 'playwright'

const BASE = 'http://localhost:3124'
const out = (k, v) => console.log(`\n### ${k}\n${v}`)

const browser = await chromium.launch()

// ── 1a. /signin operator identity (rendered, post-hydration) ──
{
  const ctx = await browser.newContext()
  const p = await ctx.newPage()
  await p.goto(BASE + '/signin', { waitUntil: 'networkidle' })
  await p.waitForTimeout(1500)
  const txt = await p.evaluate(() => document.body.innerText)
  const hit = txt.split('\n').filter((l) => /TNHH|GCN|Business reg|support@eno\.vn/.test(l))
  out('signin-operator-line', hit.join(' | ') || 'NOT FOUND')
  await ctx.close()
}

// ── 1e + 2. eno_attr pre-consent + banner behavior ──
{
  const ctx = await browser.newContext()
  const p = await ctx.newPage()
  await p.goto(BASE + '/?utm_source=testsrc&utm_medium=testmed', { waitUntil: 'networkidle' })
  await p.waitForTimeout(2000)
  const cookies1 = await ctx.cookies()
  out('cookies-before-consent', cookies1.map((c) => c.name).join(', ') || '(none)')
  const ss = await p.evaluate(() => sessionStorage.getItem('eno_attr_pending'))
  out('sessionStorage-eno_attr_pending', ss || '(none)')
  // banner visible?
  const bannerTxt = await p.evaluate(() => {
    const els = [...document.querySelectorAll('div')].filter((d) => /z-\[200\]/.test(d.className))
    return els.length ? els[0].innerText.slice(0, 300) : '(no banner)'
  })
  out('banner-text', bannerTxt)
  // Is the page usable behind the banner? backdrop click closes without consent
  await p.mouse.click(10, 10) // backdrop
  await p.waitForTimeout(500)
  const bannerGone = await p.evaluate(() => ![...document.querySelectorAll('div')].some((d) => /z-\[200\]/.test(d.className)))
  const consentAfterDismiss = await p.evaluate(() => localStorage.getItem('eno-cookie-consent'))
  const cookies2 = (await ctx.cookies()).map((c) => c.name)
  out('backdrop-dismiss', `bannerGone=${bannerGone} consent=${consentAfterDismiss} cookies=${cookies2.join(',') || '(none)'}`)
  // Vercel telemetry scripts present pre-consent?
  const va = await p.evaluate(() => [...document.querySelectorAll('script')].map((s) => s.src).filter((s) => /va|vitals|insights|analytics/i.test(s)))
  out('telemetry-scripts-preconsent', va.join(', ') || '(none)')
  await ctx.close()
}

// decline path: settings → Decline all
{
  const ctx = await browser.newContext()
  const p = await ctx.newPage()
  await p.goto(BASE + '/?utm_source=testsrc', { waitUntil: 'networkidle' })
  await p.waitForTimeout(1500)
  await p.getByRole('button', { name: /Settings|Tùy chỉnh/ }).click()
  await p.getByRole('button', { name: /Decline all|Từ chối/ }).click()
  await p.waitForTimeout(800)
  const consent = await p.evaluate(() => localStorage.getItem('eno-cookie-consent'))
  const cookies = (await ctx.cookies()).map((c) => `${c.name}=${c.value.slice(0, 30)}`)
  const va = await p.evaluate(() => [...document.querySelectorAll('script')].map((s) => s.src).filter((s) => /va\/|vitals|insights|gtag|googletag|fbevents/i.test(s)))
  out('after-decline', `consent=${consent}\ncookies=${cookies.join(' ; ') || '(none)'}\ntelemetry-scripts=${va.join(', ') || '(none)'}`)
  await ctx.close()
}

// accept path: eno_attr promoted after 'all'
{
  const ctx = await browser.newContext()
  const p = await ctx.newPage()
  await p.goto(BASE + '/?utm_source=testsrc2', { waitUntil: 'networkidle' })
  await p.waitForTimeout(1500)
  await p.getByRole('button', { name: /^(Allow|Cho phép)$/ }).click()
  await p.waitForTimeout(1000)
  const cookies = (await ctx.cookies()).map((c) => `${c.name}=${decodeURIComponent(c.value).slice(0, 60)}`)
  const va = await p.evaluate(() => [...document.querySelectorAll('script')].map((s) => s.src).filter((s) => /_vercel|va\/|vitals|insights/i.test(s)))
  out('after-allow', `cookies=${cookies.join(' ; ')}\ntelemetry-scripts=${va.join(', ') || '(none — may be env-gated)'}`)
  await ctx.close()
}

await browser.close()
