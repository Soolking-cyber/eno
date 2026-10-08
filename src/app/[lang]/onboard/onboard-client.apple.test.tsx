// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { LanguageProvider } from '@/context/language-context'

/**
 * ⛔ /onboard AFTER SIGN IN WITH APPLE ASKS FOR NOTHING APPLE ALREADY GAVE (plan B1 — App Review rejects an app
 * that asks an Apple user for their name again, Guideline 4.0; developer.apple.com/forums/thread/730223).
 *  · an Apple account whose session carries Apple's name: no name field, and Continue works at once;
 *  · an Apple account with no name (Apple shares it only on the first authorization, and only if chosen): the
 *    field is there, marked optional, and an empty one still submits — the server keeps the profile's name;
 *  · email and Google accounts are unchanged: a name of two letters or more is required.
 */

const h = vi.hoisted(() => ({
  user: null as Record<string, unknown> | null,
  replace: (_to: string) => {},
  markOnboarded: (_t: string) => {},
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: (to: string) => h.replace(to), push: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(''),
}))
vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }))
vi.mock('@/context/auth-context', () => ({
  useAuth: () => ({ user: h.user, loading: false, accountType: null, identityLoaded: true, markOnboarded: (t: string) => h.markOnboarded(t) }),
}))
vi.mock('@/components/marketplace/mascot', () => ({ Mascot: () => null }))

import { OnboardClient } from './onboard-client'

const posted: Array<Record<string, unknown>> = []
beforeEach(() => {
  posted.length = 0
  h.replace = vi.fn()
  h.markOnboarded = vi.fn()
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
    posted.push(JSON.parse(String(init?.body ?? '{}')))
    return { ok: true, json: async () => ({}) }
  }))
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  h.user = null
})

const account = (providers: string[], meta: Record<string, string> = {}) => ({
  id: 'u1',
  email: 'x@privaterelay.appleid.com',
  app_metadata: { provider: providers[0], providers },
  user_metadata: meta,
})

async function open(user: Record<string, unknown>) {
  h.user = user
  render(<LanguageProvider initialLang="en" initialViDict={{}}><OnboardClient /></LanguageProvider>)
  await act(async () => {})
}
const choose = (kind: 'individual' | 'business') =>
  fireEvent.click(screen.getByRole('radio', { name: kind === 'individual' ? /I’m an individual/ : /I’m a business/ }))
const continueButton = () => screen.getByRole('button', { name: 'Continue' })
const nameField = () => screen.queryByRole('textbox', { name: /^Your name/ })

describe('/onboard — an Apple account', () => {
  it('that brought its name sees NO name field and can submit — the name Apple gave is what is saved', async () => {
    await open(account(['apple'], { full_name: 'Minh Nguyen' }))
    choose('individual')
    expect(nameField()).toBeNull()
    expect(continueButton().hasAttribute('disabled')).toBe(false)
    fireEvent.click(continueButton())
    await vi.waitFor(() => expect(posted).toHaveLength(1))
    expect(posted[0]).toEqual(expect.objectContaining({ accountType: 'individual', displayName: 'Minh Nguyen' }))
    await vi.waitFor(() => expect(h.markOnboarded).toHaveBeenCalledWith('individual'))
  })

  it('without a name sees an OPTIONAL field and can submit it empty — the server keeps the profile name', async () => {
    await open(account(['apple']))
    choose('individual')
    expect(nameField()).toBeTruthy()
    expect(screen.getByRole('textbox', { name: 'Your name (optional)' })).toBeTruthy()
    expect(continueButton().hasAttribute('disabled')).toBe(false)
    fireEvent.click(continueButton())
    await vi.waitFor(() => expect(posted).toHaveLength(1))
    expect(posted[0].displayName).toBe('')
  })

  it('⛔ a name that is not a string (user_metadata is user-writable) never throws — it reads as no name (B1)', async () => {
    await open({ ...account(['apple']), user_metadata: { full_name: 42, name: { first: 'x' } } })
    choose('individual')
    expect(screen.getByRole('textbox', { name: 'Your name (optional)' })).toBeTruthy()
    fireEvent.click(continueButton())
    await vi.waitFor(() => expect(posted).toHaveLength(1))
    expect(posted[0].displayName).toBe('')
  })

  it('an Apple account linked to an email one is still an Apple account (providers lists both)', async () => {
    await open(account(['email', 'apple'], { name: 'Lan' }))
    choose('individual')
    expect(nameField()).toBeNull()
  })

  it('as a business: the contact name is prefilled and optional — business name and phone stay required', async () => {
    await open(account(['apple'], { full_name: 'Minh Nguyen' }))
    choose('business')
    const contact = screen.getByRole('textbox', { name: 'Your name (contact person, optional)' }) as HTMLInputElement
    expect(contact.value).toBe('Minh Nguyen')
    fireEvent.change(contact, { target: { value: '' } })
    expect(continueButton().hasAttribute('disabled')).toBe(true) // no business name or phone yet
    fireEvent.change(screen.getByRole('textbox', { name: 'Business name' }), { target: { value: 'Saigon Moto' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Phone / Zalo' }), { target: { value: '0901234567' } })
    expect(continueButton().hasAttribute('disabled')).toBe(false)
  })
})

describe('/onboard — email and Google accounts are unchanged', () => {
  it('an email account needs a name of two letters or more', async () => {
    await open({ id: 'u2', email: 'an@example.com', app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: {} })
    choose('individual')
    const field = screen.getByRole('textbox', { name: 'Your name' })
    expect(continueButton().hasAttribute('disabled')).toBe(true)
    fireEvent.change(field, { target: { value: 'A' } })
    expect(continueButton().hasAttribute('disabled')).toBe(true)
    fireEvent.change(field, { target: { value: 'An' } })
    expect(continueButton().hasAttribute('disabled')).toBe(false)
  })

  it('a Google account keeps the required field, prefilled from Google', async () => {
    await open({ id: 'u3', email: 'lan@gmail.com', app_metadata: { provider: 'google', providers: ['google'] }, user_metadata: { full_name: 'Lan Tran' } })
    choose('individual')
    const field = screen.getByRole('textbox', { name: 'Your name' }) as HTMLInputElement
    expect(field.value).toBe('Lan Tran')
    fireEvent.change(field, { target: { value: '' } })
    expect(continueButton().hasAttribute('disabled')).toBe(true)
  })
})
