import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { routeSend } from '@/lib/chat-send-route'

/**
 * THE THREAD COMPOSER HAS TWO WAYS TO SEND AND ONE PLACE THE TEXT MAY GO.
 *
 * Return and the tap-Send button used to carry their own copies of the routing, and the tap's copy
 * dropped the TRIP concierge: with it armed, Return asked the concierge while a tap posted the
 * question to the human desk as a plain message (and a second tap during the answer did it again).
 * On a phone the tap IS the primary path, so the bug was on the main road.
 */
describe('routeSend — where the composer text goes', () => {
  it('nothing armed → an ordinary message', () => {
    expect(routeSend({ conciergeArmed: false, tripConciergeArmed: false })).toBe('send')
  })

  it('the visa concierge armed → the visa concierge', () => {
    expect(routeSend({ conciergeArmed: true, tripConciergeArmed: false })).toBe('concierge')
  })

  it('the trip concierge armed → the trip concierge (the state the tap used to drop)', () => {
    expect(routeSend({ conciergeArmed: false, tripConciergeArmed: true })).toBe('trip')
  })

  it('the order is fixed: visa first, should a thread ever report both', () => {
    expect(routeSend({ conciergeArmed: true, tripConciergeArmed: true })).toBe('concierge')
  })
})

/**
 * ⚠️ READ AS TEXT — the page is a 2,700-line client module that cannot be booted in a unit test, and
 * what matters here is WIRING: both entry points must call the one dispatcher. A pure-function test
 * alone would stay green if someone inlined a fresh copy of the routing into either call site, which
 * is exactly how the two drifted the first time.
 */
describe('both send entry points share the dispatcher', () => {
  const page = readFileSync(join(process.cwd(), 'src/app/[lang]/messages/[id]/page.tsx'), 'utf8')

  it('the dispatcher routes through routeSend', () => {
    const start = page.indexOf('const dispatchSend = () => {')
    expect(start, 'dispatchSend moved or was renamed — update this test, do not delete it').toBeGreaterThan(-1)
    const body = page.slice(start, page.indexOf('\n  }\n', start))
    expect(body).toContain('routeSend({ conciergeArmed, tripConciergeArmed })')
    // Return shares the button's busy rule — the button is disabled, so the dispatcher must refuse too.
    expect(body).toMatch(/if \(conciergeBusy \|\| tripBusy\) return/)
    expect(body.indexOf('conciergeBusy || tripBusy')).toBeLessThan(body.indexOf('routeSend('))
    expect(body).toContain('askTripConcierge(text)')
    expect(body).toContain('askConcierge(text)')
  })

  it('Return (ChatComposer onSend) calls it', () => {
    expect(page).toMatch(/<ChatComposer[\s\S]*?onSend=\{dispatchSend\}/)
  })

  it('the text-mode tap-Send button calls it, and stays disabled while either desk is answering', () => {
    // The LAST ChatSendButton in the file is the text-mode one (the offer-mode button precedes it).
    const at = page.lastIndexOf('<ChatSendButton')
    const tag = page.slice(at, page.indexOf('/>', at))
    expect(tag).toContain('onClick={dispatchSend}')
    expect(tag).toMatch(/disabled=\{!text\.trim\(\) \|\| conciergeBusy \|\| tripBusy\}/)
    // Named for what it does: both desks' assistants announce themselves the same way.
    expect(tag).toContain('aria-label={conciergeArmed || tripConciergeArmed ?')
  })
})
