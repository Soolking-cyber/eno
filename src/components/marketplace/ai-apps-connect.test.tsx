// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'

vi.mock('@/context/language-context', () => ({ useLanguage: () => ({ lang: 'en', tr: (en: string) => en }) }))
const { AiAppsConnect } = await import('./ai-apps-connect')
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('Settings › Developers: connect an AI app (owner 2026-11-17)', () => {
  it('Claude opens its eno.vn listing in a new tab — one click', () => {
    render(<AiAppsConnect />)
    const claude = screen.getByRole('link', { name: /Claude/ })
    expect(claude.getAttribute('href')).toBe('https://claude.ai/directory/eno-vn')
    expect(claude.getAttribute('target')).toBe('_blank')
    expect(claude.getAttribute('rel')).toBe('noopener noreferrer')
  })

  it('ChatGPT shows as soon, and cannot be pressed', () => {
    render(<AiAppsConnect />)
    const gpt = screen.getByRole('button', { name: /ChatGPT · soon/ })
    expect(gpt.hasAttribute('disabled') || gpt.getAttribute('aria-disabled') === 'true').toBe(true)
  })

  it('Grok shows where to go and the two values to paste, each with Copy', async () => {
    const writeText = vi.fn(async () => {})
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
    render(<AiAppsConnect />)
    expect(screen.queryByText('https://eno.vn/api/mcp/clients/grok')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Grok' }))
    expect(screen.getByRole('link', { name: /Open Grok connectors/ }).getAttribute('href')).toBe('https://grok.com/connectors')
    expect(screen.getByText('https://eno.vn/api/mcp')).toBeTruthy()
    expect(screen.getByText('https://eno.vn/api/mcp/clients/grok')).toBeTruthy()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Copy Client ID' })) })
    expect(writeText).toHaveBeenCalledWith('https://eno.vn/api/mcp/clients/grok')
  })
  it('⛔ where the clipboard is refused, Copy selects the value for the phone\'s own copy — never a silent nothing', async () => {
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: vi.fn(async () => { throw new Error('denied') }) } })
    render(<AiAppsConnect />)
    fireEvent.click(screen.getByRole('button', { name: 'Grok' }))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Copy URL' })) })
    expect(window.getSelection()?.toString()).toBe('https://eno.vn/api/mcp')
  })
})
