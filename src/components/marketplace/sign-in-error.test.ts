import { describe, expect, it } from 'vitest'
import {
  authErrorToCode,
  emailSendErrorToCode,
  errorAfterCaptchaSolved,
  signInErrorText,
  type SignInError,
} from './sign-in-form'

/**
 * The sign-in form's error model.
 *
 * ⚠️ WHY THIS IS A STATE-MACHINE TEST AND NOT A RENDER TEST. The task asks for a test that fails a
 * send, asserts the message, then makes the widget succeed and asserts the message is gone. That
 * sequence is modelled here as the transitions it consists of, because this repo has no
 * component-render harness at all — vitest runs `environment: 'node'`, there is no
 * @testing-library, and no `.test.tsx` exists anywhere in src. Adding jsdom plus a testing library
 * is a dependency and a vitest-config change, neither of which is in this task's owned paths.
 *
 * What is genuinely at stake is which errors survive a widget event, and that is pure logic — which
 * is exactly why the refactor to error CODES was the real work here. The DOM wiring that remains is
 * one prop (`onSolved: () => setError(errorAfterCaptchaSolved)`) and two render calls.
 */

/** Stands in for the form's `t`, returning English so assertions read as the visitor sees them. */
const t = (en: string) => en

describe('the captcha message retracts itself', () => {
  it('models the reported sequence: failed send, message shown, widget succeeds, message gone', () => {
    // 1 ── a send fails the captcha (server answered 403 captcha_failed)
    let error: SignInError = emailSendErrorToCode('captcha_failed')
    expect(signInErrorText(error, t)).toMatch(/security check didn't complete/)

    // 2 ── the visitor then finishes the visible challenge and the widget produces a token. This is
    //      the moment that used to change nothing on screen: the green "Success!" appeared under a
    //      red error, and the owner read it as still broken.
    error = errorAfterCaptchaSolved(error)

    // 3 ── the contradiction is gone, with no new submit and nothing polled.
    expect(error).toBeNull()
    expect(signInErrorText(error, t)).toBe('')
  })

  it('clears a captcha error that came from the provider, not just from our own endpoint', () => {
    // GoTrue phrases it its own way; authErrorToCode is what makes both paths the same state.
    const fromProvider = authErrorToCode('captcha protection: request disallowed (captcha_failed)')
    expect(fromProvider).toEqual({ code: 'captcha' })
    expect(errorAfterCaptchaSolved(fromProvider)).toBeNull()
  })

  it('is a no-op when there is no error at all', () => {
    expect(errorAfterCaptchaSolved(null)).toBeNull()
  })
})

describe('every OTHER error is sticky', () => {
  // ⚠️ THE HALF THAT IS EASY TO GET WRONG. The cheap fix for the reported bug is to wipe `error` on
  // any widget event, which would also erase the one instruction the visitor actually needs — a
  // cooldown, or "try again in an hour". A widget event is evidence about the captcha and nothing
  // else, so each of these must survive it unchanged.
  const survivors: Array<[string, SignInError]> = [
    ['cooldown', { code: 'cooldown', retryAfterSec: 30 }],
    ['rate_limited', { code: 'rate_limited' }],
    ['send_failed', { code: 'send_failed' }],
    ['invalid_email', { code: 'invalid_email' }],
    ['bad_code', { code: 'bad_code' }],
    ['network', { code: 'network' }],
    ['email_unreachable', { code: 'email_unreachable' }],
    ['unknown', { code: 'unknown' }],
    ['raw provider text', { code: 'raw', message: 'Signups not allowed for this instance' }],
  ]

  for (const [name, error] of survivors) {
    it(`keeps a ${name} message when the widget succeeds`, () => {
      expect(errorAfterCaptchaSolved(error)).toEqual(error)
    })
  }

  it('keeps the cooldown SECONDS, not just the code — the number is the instruction', () => {
    const cooling: SignInError = { code: 'cooldown', retryAfterSec: 900 }
    expect(signInErrorText(errorAfterCaptchaSolved(cooling), t)).toBe('Just sent one — try again in 900 seconds.')
  })
})

describe('codes map to copy a person can act on', () => {
  it('gives every code a non-empty sentence', () => {
    const codes = ['captcha', 'network', 'email_unreachable', 'invalid_email', 'cooldown',
      'rate_limited', 'send_failed', 'bad_code', 'unknown'] as const
    for (const code of codes) {
      expect(signInErrorText({ code }, t), code).not.toBe('')
    }
  })

  it('interpolates the cooldown through a placeholder, never a template literal', () => {
    // gen-ui-strings.mjs harvests string LITERALS, so an interpolated t() ships untranslated — the
    // assertion is that the number arrives, which is only true if the placeholder was replaced.
    expect(signInErrorText({ code: 'cooldown', retryAfterSec: 45 }, t)).toContain('45')
  })

  it('falls back to a floor rather than showing "try again in 0 seconds"', () => {
    expect(signInErrorText({ code: 'cooldown', retryAfterSec: 0 }, t)).toContain('30')
    expect(signInErrorText({ code: 'cooldown' }, t)).toContain('30')
  })

  it('shows provider text verbatim rather than flattening it to "something went wrong"', () => {
    expect(signInErrorText({ code: 'raw', message: 'Email rate limit exceeded' }, t))
      .toBe('Email rate limit exceeded')
  })

  it('maps an unrecognised server code to the generic message, not to silence', () => {
    expect(emailSendErrorToCode('some_new_code_we_do_not_know')).toEqual({ code: 'unknown' })
    expect(signInErrorText(emailSendErrorToCode(undefined), t)).not.toBe('')
  })

  it('does not mistake an ordinary provider error for a captcha failure', () => {
    expect(authErrorToCode('Invalid login credentials')).toEqual({
      code: 'raw', message: 'Invalid login credentials',
    })
  })
})
