// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { lastSignInMethod, methodOfSession, rememberLastSignIn } from './last-signin-method'
import { clearAccountDeviceStorage } from './sign-out-storage'

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
const token = (amr: unknown) => `${b64({ alg: 'HS256' })}.${b64({ sub: 'u', amr })}.sig`
const oauth = [{ method: 'oauth', timestamp: 100 }]

beforeEach(() => localStorage.clear())

describe('how a session was made, from the token the auth server issued', () => {
  it.each(['otp', 'password', 'magiclink', 'email/signup', 'recovery', 'invite'])('%s is email', (method) => {
    expect(methodOfSession({ access_token: token([{ method, timestamp: 1 }]) })).toBe('email')
  })

  it.each(['google', 'apple', 'facebook'] as const)('oauth with one %s identity is that provider', (provider) => {
    expect(methodOfSession({ access_token: token(oauth), user: { identities: [{ provider, last_sign_in_at: '2026-11-01T00:00:00Z' }] } })).toBe(provider)
  })

  it('an account with several: the provider signed in with most recently, not the one the account began with', () => {
    expect(methodOfSession({
      access_token: token(oauth),
      user: {
        app_metadata: { provider: 'google' },
        identities: [
          { provider: 'google', last_sign_in_at: '2026-10-01T00:00:00Z' },
          { provider: 'email', last_sign_in_at: '2026-11-03T00:00:00Z' },
          { provider: 'facebook', last_sign_in_at: '2026-11-02T00:00:00Z' },
        ],
      },
    })).toBe('facebook')
  })

  it('an identity with no date does not beat one that has it', () => {
    expect(methodOfSession({
      access_token: token(oauth),
      user: { identities: [{ provider: 'google', last_sign_in_at: null }, { provider: 'facebook', last_sign_in_at: '2026-11-02T00:00:00Z' }] },
    })).toBe('facebook')
  })

  it('a newer provider this window does not offer is not mistaken for an older one it does', () => {
    expect(methodOfSession({
      access_token: token(oauth),
      user: { identities: [{ provider: 'google', last_sign_in_at: '2026-10-01T00:00:00Z' }, { provider: 'github', last_sign_in_at: '2026-11-01T00:00:00Z' }] },
    })).toBeNull()
  })

  it('a session with no identities on it falls back to the account\'s provider', () => {
    expect(methodOfSession({ access_token: token(oauth), user: { app_metadata: { provider: 'apple' } } })).toBe('apple')
  })

  it('the newest factor decides: a code after an older oauth is email', () => {
    expect(methodOfSession({ access_token: token([{ method: 'oauth', timestamp: 1 }, { method: 'otp', timestamp: 2 }]), user: { identities: [{ provider: 'google' }] } })).toBe('email')
  })

  it.each([
    ['no token', {}],
    ['a damaged token', { access_token: 'not-a-token' }],
    ['no amr', { access_token: token(undefined) }],
    ['an empty amr', { access_token: token([]) }],
    ['a method this window does not offer', { access_token: token([{ method: 'sso/saml', timestamp: 1 }]) }],
    ['oauth from a provider this window does not offer', { access_token: token(oauth), user: { app_metadata: { provider: 'github' } } }],
    ['oauth that claims to be email', { access_token: token(oauth), user: { app_metadata: { provider: 'email' } } }],
  ])('%s says nothing', (_, session) => {
    expect(methodOfSession(session)).toBeNull()
  })
})

describe('what the device remembers', () => {
  const google = { access_token: token(oauth), user: { identities: [{ provider: 'google' }] } }

  it('nothing until a session has been seen', () => {
    expect(lastSignInMethod()).toBeNull()
  })

  it('the method, on a session', () => {
    rememberLastSignIn(google)
    expect(lastSignInMethod()).toBe('google')
  })

  it('a session it cannot read leaves what is remembered', () => {
    rememberLastSignIn(google)
    rememberLastSignIn({ access_token: 'junk' })
    expect(lastSignInMethod()).toBe('google')
  })

  it('survives sign-out, which is when it is read, and holds no account detail', () => {
    rememberLastSignIn(google)
    clearAccountDeviceStorage()
    expect(localStorage.getItem('eno:signin-last')).toBe('google')
  })

  it('ignores a value it does not know', () => {
    localStorage.setItem('eno:signin-last', 'sms')
    expect(lastSignInMethod()).toBeNull()
  })
})
