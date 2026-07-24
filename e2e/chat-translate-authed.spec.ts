import { test, expect, type APIRequestContext, type BrowserContext } from '@playwright/test'
import { existsSync, readFileSync } from 'node:fs'

// ── Live chat translation, end to end (the proof the two halves actually meet) ───────
//
// The client (use-chat-translation.ts) and the server (POST /api/messages/translate) were
// built in separate lanes against a written contract, and their unit tests MOCK the database
// and the provider — so nothing until now proved a real buyer, reading a real thread from a
// real seller in another language, sees translated text. That is what this spec does.
//
// It also pins the three properties that only an integration test can check, because each of
// them spans the browser, the route, and Postgres:
//   1. `counterpart.locale` really reaches the client (contract A) — the toggle is invisible
//      without it, which is exactly how the feature stayed dark before.
//   2. A NON-PARTICIPANT cannot translate a thread's messages. This is the endpoint's whole
//      security design (by-id + membership) and it is worth a live 403, not just a unit mock.
//   3. Private chat text never lands in the shared `Translation` table. The unit test can
//      only assert we PASSED `skipWrite: true`; only a real DB read proves nothing was
//      written — and that table is world-readable across every page, so the claim matters.
//
// Runs ONLY in authed mode against the seeded standalone server; absent that env it skips,
// so it can never touch prod. Actors are the seeded buyer + seller (`e2e-conv-1`), plus the
// admin session as the outsider.

const AUTH_DIR = 'e2e/.auth'
const FIXTURES = `${AUTH_DIR}/seed-fixtures.json`
const HAVE = existsSync(`${AUTH_DIR}/buyer.json`) && existsSync(`${AUTH_DIR}/seller.json`) && existsSync(FIXTURES)
const CONV_ID: string = HAVE ? JSON.parse(readFileSync(FIXTURES, 'utf8')).conversationId : ''

// Vietnamese the seller "types". Distinct per run so a previous run's ephemeral cache entry
// (24h TTL, keyed by sha1 of the text) can never make a broken translation look like a hit.
const stamp = Date.now().toString(36)
const VI_MESSAGE = `Xin chào, sản phẩm này vẫn còn hàng nhé bạn. Mã ${stamp}`

type Item = { id: string; text: string; translated: boolean }

async function setLocale(ctx: APIRequestContext, locale: string) {
  const res = await ctx.post('/api/profile/locale', { data: { locale } })
  expect(res.status(), `set locale ${locale}`).toBe(200)
}

async function translateReq(ctx: APIRequestContext, messageIds: string[], target = 'en') {
  return ctx.post('/api/messages/translate', { data: { conversationId: CONV_ID, messageIds, target } })
}

test.describe.serial('Chat live translation · buyer EN reads a seller writing VI', () => {
  test.skip(!process.env.E2E_AUTHED_BASE || !HAVE, 'requires the standalone server + seeded buyer/seller sessions + e2e-seed fixtures')
  // Stateful: the seller posts a real message and both profiles' locales are rewritten.
  // A retry would append a second message and assert against the wrong one.
  test.describe.configure({ retries: 0 })

  let buyerCtx: BrowserContext
  let sellerCtx: BrowserContext
  let adminCtx: BrowserContext | undefined

  let sellerMsgId = ''   // the VI message — INCOMING for the buyer, must translate
  let buyerMsgId = ''    // one of the buyer's own — must NEVER be translated
  let offerMsgId = ''    // the seeded offer card — must NEVER be translated

  test.beforeAll(async ({ browser }) => {
    buyerCtx = await browser.newContext({ storageState: `${AUTH_DIR}/buyer.json`, locale: 'en-US' })
    sellerCtx = await browser.newContext({ storageState: `${AUTH_DIR}/seller.json`, locale: 'en-US' })
    if (existsSync(`${AUTH_DIR}/admin.json`)) {
      adminCtx = await browser.newContext({ storageState: `${AUTH_DIR}/admin.json`, locale: 'en-US' })
    }
  })

  test.afterAll(async () => {
    await buyerCtx?.close()
    await sellerCtx?.close()
    await adminCtx?.close()
  })

  test('setup · the two participants end up in different app languages', async () => {
    // This is the ONLY signal the feature keys off. Both sides are set explicitly so the run
    // does not depend on whatever locale a previous spec happened to leave behind.
    await setLocale(buyerCtx.request, 'en')
    await setLocale(sellerCtx.request, 'vi')
  })

  test('setup · the seller says something in Vietnamese', async () => {
    const res = await sellerCtx.request.post(`/api/conversations/${CONV_ID}/messages`, { data: { body: VI_MESSAGE } })
    expect(res.status(), await res.text().catch(() => '')).toBeLessThan(300)
    // Read the thread back as the SELLER to learn the ids, and to confirm the row really
    // landed as plain text rather than any structured kind.
    const thread = await (await sellerCtx.request.get(`/api/conversations/${CONV_ID}`)).json()
    const mine = thread.messages.filter((m: { mine: boolean }) => m.mine)
    sellerMsgId = mine.find((m: { body: string }) => m.body === VI_MESSAGE)?.id ?? ''
    expect(sellerMsgId, 'the seller message should be readable back').toBeTruthy()
    const theirs = thread.messages.filter((m: { mine: boolean; kind: string }) => !m.mine && m.kind === 'text')
    buyerMsgId = theirs[0]?.id ?? ''
    offerMsgId = thread.messages.find((m: { kind: string }) => m.kind === 'offer')?.id ?? ''
  })

  test('contract A · the buyer is told the seller writes Vietnamese', async () => {
    // Without this the toggle never renders — the exact way the feature sat dark before.
    const thread = await (await buyerCtx.request.get(`/api/conversations/${CONV_ID}`)).json()
    expect(thread.counterpart.locale).toBe('vi')
  })

  test('security · an outsider cannot translate this thread', async () => {
    test.skip(!adminCtx, 'needs the admin session as a non-participant (E2E_ADMIN_EMAIL)')
    const res = await translateReq(adminCtx!.request, [sellerMsgId])
    // Not a participant ⇒ refused outright. 404 would also be acceptable (unknown thread),
    // but the seeded conversation exists, so the honest answer is 403.
    expect(res.status()).toBe(403)
    expect(await res.text()).not.toContain(VI_MESSAGE)
  })

  test('security · a guest cannot translate at all', async ({ playwright }) => {
    const anon = await playwright.request.newContext({ baseURL: process.env.E2E_AUTHED_BASE })
    const res = await anon.post('/api/messages/translate', {
      data: { conversationId: CONV_ID, messageIds: [sellerMsgId], target: 'en' },
    })
    expect(res.status()).toBe(401)
    await anon.dispose()
  })

  test('the server — not the client — decides what may be translated', async () => {
    // Asking for MY OWN message and for the offer CARD: both must come back excluded, even
    // though the caller is a legitimate participant. The client filters these too, but the
    // client is a courtesy; this is the gate.
    const ids = [buyerMsgId, offerMsgId].filter(Boolean)
    test.skip(!ids.length, 'seed fixtures did not provide a buyer message or offer card')
    const res = await translateReq(buyerCtx.request, ids)
    expect(res.status()).toBe(200)
    const { items } = (await res.json()) as { items: Item[] }
    expect(items.map((i) => i.id)).not.toContain(buyerMsgId)
    expect(items.map((i) => i.id)).not.toContain(offerMsgId)
  })

  test('the buyer gets the seller’s Vietnamese back in English', async () => {
    const res = await translateReq(buyerCtx.request, [sellerMsgId])
    expect(res.status()).toBe(200)
    const { items } = (await res.json()) as { items: Item[] }
    const item = items.find((i) => i.id === sellerMsgId)
    expect(item, 'the incoming message should be translatable').toBeTruthy()
    // If the deploy has no provider key this legitimately degrades to passthrough — say so
    // clearly rather than failing as though the feature were broken.
    test.skip(!item!.translated, 'no translation provider configured on this deploy')
    expect(item!.text).not.toBe(VI_MESSAGE)
    expect(item!.text.toLowerCase()).toMatch(/hello|hi |still|available|stock/)
  })

  test('a repeat ask is served from the ephemeral cache, not re-billed', async () => {
    const first = await translateReq(buyerCtx.request, [sellerMsgId])
    const a = ((await first.json()) as { items: Item[] }).items.find((i) => i.id === sellerMsgId)
    test.skip(!a?.translated, 'no translation provider configured on this deploy')
    const second = await translateReq(buyerCtx.request, [sellerMsgId])
    const b = ((await second.json()) as { items: Item[] }).items.find((i) => i.id === sellerMsgId)
    // Same text back. (Cache HIT vs a second paid call is not observable over HTTP — the
    // point asserted here is that a replay is stable and never degrades to the original.)
    expect(b?.text).toBe(a?.text)
    expect(b?.translated).toBe(true)
  })

  test('the private message never reaches the shared, world-readable translation cache', async () => {
    // THE privacy claim of this feature, and the only assertion here that a unit test cannot
    // make: `Translation` is keyed by sha1(source), has no owner column, is read by every
    // page for every user and outlives the message. The route passes `skipWrite: true` so a
    // chat body must not appear there — proven by looking, not by trusting the flag.
    const url = process.env.DIRECT_URL || process.env.DATABASE_URL
    test.skip(!url, 'needs DIRECT_URL/DATABASE_URL to inspect the Translation table')
    const { createHash } = await import('node:crypto')
    const pg = (await import('pg')).default
    const client = new pg.Client({ connectionString: url })
    await client.connect()
    try {
      const h = createHash('sha1').update(VI_MESSAGE).digest('hex')
      const { rows } = await client.query('select count(*)::int as n from "Translation" where hash = $1', [h])
      expect(rows[0].n, 'chat text must not be persisted in the shared Translation cache').toBe(0)
    } finally {
      await client.end()
    }
  })

  test('the UI: the toggle appears and the message reads in English', async () => {
    const page = await buyerCtx.newPage()
    await page.addInitScript(() => { try { localStorage.setItem('eno-cookie-consent', 'essential') } catch {} })
    await page.goto(`/messages/${CONV_ID}`)
    // The toggle exists ONLY on a known mismatch — its presence IS contract A working.
    const toggle = page.getByText(/Translate messages to/i)
    await expect(toggle).toBeVisible({ timeout: 20_000 })
    // ⚠️ Scope to the message BUBBLES. On desktop this page also renders the inbox list
    // beside the thread, whose row preview shows the raw last message — deliberately NOT
    // translated (a different surface, with no toggle of its own). An unscoped text locator
    // matches that preview and reads as "the thread never translated", which is wrong.
    const bubbles = page.locator('.allow-select.rounded-2xl')
    await expect(bubbles.filter({ hasText: VI_MESSAGE })).toHaveCount(0, { timeout: 20_000 })
    // The escape hatch is offered, so the buyer can always see what was really written…
    const showOriginal = page.getByRole('button', { name: /show original/i })
    await expect(showOriginal.first()).toBeVisible({ timeout: 20_000 })
    // …and it really restores the Vietnamese, which also proves the bubble we were reading
    // was a TRANSLATION of this message rather than some unrelated text. The thread holds
    // several translated messages and the buttons carry no message id, so reveal them all
    // rather than guessing which one is ours.
    const count = await showOriginal.count()
    for (let i = count - 1; i >= 0; i--) await showOriginal.nth(i).click()
    await expect(bubbles.filter({ hasText: VI_MESSAGE })).toHaveCount(1, { timeout: 10_000 })
    await page.close()
  })
})
