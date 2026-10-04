// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { LanguageProvider } from '@/context/language-context'
import { TeacherThreadStrip } from './teacher-thread-strip'

// ── The teacher thread's contact strip on a thread CLOSED by a block (App Store gate `ugc-safety`) ─────
// The page mounts it for the TEACHER only, so a share made before the block can be withdrawn. It must
// offer exactly that — never a Share button the server can only refuse.

const fetchMock = vi.fn()
function mount(props: Partial<React.ComponentProps<typeof TeacherThreadStrip>>) {
  return render(
    <LanguageProvider initialLang="en" initialViDict={{}}>
      <TeacherThreadStrip conversationId="c1" iAmTeacher shared={false} shareSignal={0} {...props} />
    </LanguageProvider>,
  )
}

beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock) })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('TeacherThreadStrip on a closed thread', () => {
  it('a standing share can be withdrawn — and says the school cannot see it meanwhile', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true, shared: false }) })
    const { container } = mount({ shared: true, closed: true })
    expect(container.textContent).toContain('can’t see them while the conversation is closed')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Stop sharing' })) })
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ conversationId: 'c1', share: false })
    // Withdrawn: nothing left to offer while the thread is closed — no Share button.
    expect(screen.queryByRole('button', { name: /Share my phone/ })).toBeNull()
    expect(container.textContent).toBe('')
  })

  it('with no share standing it renders nothing', () => {
    const { container } = mount({ shared: false, closed: true })
    expect(container.textContent).toBe('')
  })

  it('an open thread is unchanged: the Share action is there', () => {
    mount({ shared: false })
    expect(screen.getByRole('button', { name: /Share my phone/ })).toBeTruthy()
  })
})
