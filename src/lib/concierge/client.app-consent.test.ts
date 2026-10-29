// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * ⛔ THE VOICE GUIDE IN THE APPS ASKS FIRST (owner, 2026-10-29: "also ios android apps add the live concierge to them too";
 * consent "Apps only"). askForHelp — every ✨, the inbox row, "Talk instead" — asks the voice guide's notice in the apps
 * before the window opens; the website never asks. voiceAgreedHere is the one rule the window's Start and the host's
 * close-on-withdrawal share.
 */
vi.stubEnv('NEXT_PUBLIC_ENO_EDITION', 'marketplace')
// The apps' AI notice machinery is on in production (NEXT_PUBLIC_APP_REVIEW_GATES carries app-ai-notice).
vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'app-ai-notice')
const { CONCIERGE_OPEN_EVENT, askForHelp, setConciergeAvailable, takePendingOpen, voiceAgreedHere } = await import('./client')
const { aiConsentKey, registerAiConsentAsker, setAiConsentAccount, forgetAiConsentMemory, writeAiConsent } = await import('@/lib/ai-consent')

const ME = 'p-me'
const BROWSER = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36'
const OLD_APP = `${BROWSER} EnoNativeApp/1`
const VOICE_APP = `${OLD_APP} EnoVoice/1`

const nav = () => ({ push: vi.fn() })
const at = (path: string) => window.history.pushState({}, '', path)
const ua = (s: string) => vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(s)
let opened: ReturnType<typeof vi.fn<() => void>>
let asked: string[]

beforeEach(() => {
  localStorage.clear()
  forgetAiConsentMemory()
  setAiConsentAccount(ME)
  asked = []
  opened = vi.fn<() => void>()
  window.addEventListener(CONCIERGE_OPEN_EVENT, opened)
  at('/?category=rentals')
  setConciergeAvailable(true)
})
afterEach(() => {
  window.removeEventListener(CONCIERGE_OPEN_EVENT, opened)
  registerAiConsentAsker(null)
  setConciergeAvailable(false)
  takePendingOpen('/')
  vi.restoreAllMocks()
})
const answers = (a: 'on' | 'off' | null) => registerAiConsentAsker(async (family) => { asked.push(family); return a })

describe('askForHelp in an app built for the guide', () => {
  it('"Allow": the voice guide\'s notice first, then the window opens', async () => {
    ua(VOICE_APP); answers('on')
    const n = nav()
    await askForHelp(n, 'en')
    expect(asked).toEqual(['voice_guide'])
    expect(opened).toHaveBeenCalledTimes(1)
    expect(n.push).not.toHaveBeenCalled()
  })

  it('"Not now": eno AI\'s text chat, no window — and from that chat itself (voiceOnly), nothing', async () => {
    ua(VOICE_APP); answers('off')
    const n = nav()
    await askForHelp(n, 'en')
    expect(opened).not.toHaveBeenCalled()
    expect(n.push).toHaveBeenCalledWith('/messages/ai')
    const m = nav()
    await askForHelp(m, 'en', { voiceOnly: true })
    expect(m.push).not.toHaveBeenCalled()
  })

  it('no answer (Escape, the page changed): nothing at all — no window, no move', async () => {
    ua(VOICE_APP); answers(null)
    const n = nav()
    await askForHelp(n, 'en')
    expect(opened).not.toHaveBeenCalled()
    expect(n.push).not.toHaveBeenCalled()
  })

  it('already agreed on this device: no question, the window opens', async () => {
    ua(VOICE_APP); answers('off')
    writeAiConsent('voice_guide', ME, 'on')
    await askForHelp(nav(), 'en')
    expect(asked).toEqual([])
    expect(opened).toHaveBeenCalledTimes(1)
  })

  it('from the messenger: the question BEFORE the move to the explorer — "Not now" never moves the app there', async () => {
    ua(VOICE_APP); answers('off')
    at('/messages')
    const n = nav()
    await askForHelp(n, 'en')
    expect(n.push).toHaveBeenCalledWith('/messages/ai')
    expect(n.push).not.toHaveBeenCalledWith('/')
    expect(takePendingOpen('/')).toBe(false)
  })

  it('no one to ask (no notice host mounted): no window, and the text chat as before — never a dead ✨', async () => {
    ua(VOICE_APP)
    const n = nav()
    await askForHelp(n, 'en')
    expect(opened).not.toHaveBeenCalled()
    expect(n.push).toHaveBeenCalledWith('/messages/ai')
    const m = nav()
    await askForHelp(m, 'en', { voiceOnly: true })
    expect(m.push).not.toHaveBeenCalled()
  })
})

describe('⛔ a build without the apps\' AI notice (app-ai-notice off): no voice guide in the app at all', () => {
  afterEach(() => { vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'app-ai-notice') })

  it('even with a stored "yes" (from a build that had it): the text chat, and the window\'s Start refuses — a yes Settings could not take back never counts', async () => {
    ua(VOICE_APP); answers('on')
    writeAiConsent('voice_guide', ME, 'on')
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', '')
    const n = nav()
    await askForHelp(n, 'en')
    expect(opened).not.toHaveBeenCalled()
    expect(asked).toEqual([])
    expect(n.push).toHaveBeenCalledWith('/messages/ai')
    expect(voiceAgreedHere(ME)).toBe(false)
  })
})

describe('the website never asks', () => {
  it('a browser: the window opens at once, no question', async () => {
    ua(BROWSER); answers('off')
    await askForHelp(nav(), 'en')
    expect(asked).toEqual([])
    expect(opened).toHaveBeenCalledTimes(1)
  })
})

describe('voiceAgreedHere — the window\'s Start and the host\'s close share it', () => {
  it('the website: always', () => {
    ua(BROWSER)
    expect(voiceAgreedHere(ME)).toBe(true)
  })

  it('an app binary without the guide: never, whatever was answered', () => {
    ua(OLD_APP)
    writeAiConsent('voice_guide', ME, 'on')
    expect(voiceAgreedHere(ME)).toBe(false)
  })

  it('an app built for it: only with THIS account\'s "yes" on this device, and no longer once it is withdrawn', () => {
    ua(VOICE_APP)
    expect(voiceAgreedHere(ME)).toBe(false)
    writeAiConsent('voice_guide', ME, 'on')
    expect(voiceAgreedHere(ME)).toBe(true)
    expect(voiceAgreedHere('p-someone-else')).toBe(false)
    expect(voiceAgreedHere(null)).toBe(false)
    writeAiConsent('voice_guide', ME, 'off')
    expect(voiceAgreedHere(ME)).toBe(false)
  })

  it('⛔ a notice version in the key: a "yes" to an earlier notice never counts', () => {
    ua(VOICE_APP)
    expect(aiConsentKey('voice_guide', ME)).toBe(`ai:consent:voice_guide@1:${ME}`)
    expect(aiConsentKey('assistant', ME)).toBe(`ai:consent:assistant:${ME}`)
    localStorage.setItem(`ai:consent:voice_guide:${ME}`, 'on') // an unversioned yes, as if from an earlier build
    expect(voiceAgreedHere(ME)).toBe(false)
  })
})
