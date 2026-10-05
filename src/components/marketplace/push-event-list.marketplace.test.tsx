// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'

// ⛔ THE eno.vn EDITION (Vitest builds eno.forum by default): the list a marketplace reader actually sees.
vi.mock('@/lib/edition', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/edition')>()), IS_SERVICES: false, IS_MARKETPLACE: true }))
vi.mock('@/context/language-context', () => ({ useLanguage: () => ({ lang: 'vi', tr: (_en: string, vi?: string) => vi ?? _en }) }))

import { PushEventList } from './push-opt-in-card'

afterEach(cleanup)

describe('PushEventList on eno.vn', () => {
  it('names only eno.vn pushes — no forum order/application line, and nothing about visas or payouts', () => {
    const { container } = render(<PushEventList />)
    const items = [...container.querySelectorAll('li')].map((li) => li.textContent ?? '')
    expect(items).toHaveLength(8)
    expect(items.join(' ')).not.toContain('Cập nhật về đơn hàng, hồ sơ và tài khoản của bạn')
    expect(container.textContent).not.toMatch(/visa|thị thực|payout|paypal/i)
  })
})
