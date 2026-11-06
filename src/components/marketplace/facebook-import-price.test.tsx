// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

vi.mock('@/context/language-context', () => ({ useLanguage: () => ({ lang: 'en', tr: (en: string) => en }) }))
vi.mock('@/context/auth-context', () => ({ useAuth: () => ({ user: null }) }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn() }), useSearchParams: () => new URLSearchParams() }))
const { DraftPrice } = await import('./facebook-import-panel')
afterEach(cleanup)

// ⛔ Money (commit gate, opus): what is saved is what the box shows, however the seller got there.
describe('Import review: a draft\'s price', () => {
  it('grouped as it is typed', () => {
    render(<DraftPrice price={null} label="Price in đồng" onSave={vi.fn()} />)
    const input = screen.getByRole('textbox', { name: 'Price in đồng' }) as HTMLInputElement
    fireEvent.change(input, { target: { value: '65000000' } })
    expect(input.value).toBe('65,000,000')
  })
  it('⛔ keyboard: typing 65, tabbing to ×1,000,000 and pressing it saves 65,000,000, never 65', () => {
    const onSave = vi.fn()
    render(<DraftPrice price={null} label="Price in đồng" onSave={onSave} />)
    const input = screen.getByRole('textbox', { name: 'Price in đồng' })
    fireEvent.change(input, { target: { value: '65' } })
    const chip = screen.getByRole('button', { name: '×1,000,000' })
    fireEvent.blur(input, { relatedTarget: chip })
    expect(onSave).not.toHaveBeenCalled()
    fireEvent.click(chip)
    fireEvent.blur(chip, { relatedTarget: document.body })
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSave).toHaveBeenCalledWith(65_000_000)
  })
  it('leaving it unchanged saves nothing; clearing it saves no price', () => {
    const onSave = vi.fn()
    render(<DraftPrice price={9_000_000} label="Price in đồng" onSave={onSave} />)
    const input = screen.getByRole('textbox', { name: 'Price in đồng' })
    fireEvent.blur(input, { relatedTarget: document.body })
    expect(onSave).not.toHaveBeenCalled()
    fireEvent.change(input, { target: { value: '' } })
    fireEvent.blur(input, { relatedTarget: document.body })
    expect(onSave).toHaveBeenCalledWith(null)
  })
})
