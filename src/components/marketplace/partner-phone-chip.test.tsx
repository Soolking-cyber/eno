// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

/**
 * The partner welcome's answer (owner 2026-11-18: "1 click send for them if they already registered their number if not ask
 * them to add with 1 click in chat"). A verified number on the account → one tap sends it; none → one tap opens a field, and
 * only a real phone number is sent. Either way the chip hands an ordinary chat line to the thread's own send.
 */

vi.mock('@/context/language-context', () => ({ useLanguage: () => ({ lang: 'en', tr: (en: string) => en }) }))

import { PartnerPhoneChip } from './partner-phone-chip'

afterEach(cleanup)

describe('PartnerPhoneChip', () => {
  it('a number on the account: one tap sends it as a chat line', () => {
    const onSend = vi.fn()
    render(<PartnerPhoneChip myPhone="+84901234567" onSend={onSend} />)
    fireEvent.click(screen.getByRole('button', { name: /Send my number/ }))
    expect(onSend).toHaveBeenCalledWith('📞 +84901234567')
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('⛔ one send per chip: it hides on the tap, so a double tap never sends the number twice', () => {
    const onSend = vi.fn()
    render(<PartnerPhoneChip myPhone="+84901234567" onSend={onSend} />)
    const b = screen.getByRole('button', { name: /Send my number/ })
    fireEvent.click(b); fireEvent.click(b)
    expect(onSend).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('no number: "Add my number" opens a field; a typed local number is sent in the +84 form', () => {
    const onSend = vi.fn()
    render(<PartnerPhoneChip myPhone={null} onSend={onSend} />)
    expect(screen.queryByRole('textbox')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Add my number/ }))
    fireEvent.change(screen.getByLabelText('Your phone number'), { target: { value: '090 123 4567' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(onSend).toHaveBeenCalledWith('📞 +84901234567')
  })

  it('⛔ something that is not a phone number is never sent — the field says so', () => {
    const onSend = vi.fn()
    render(<PartnerPhoneChip myPhone={null} onSend={onSend} />)
    fireEvent.click(screen.getByRole('button', { name: /Add my number/ }))
    fireEvent.change(screen.getByLabelText('Your phone number'), { target: { value: '12345' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(onSend).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toBe('Check the number')
  })
})
