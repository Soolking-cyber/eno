// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { LanguageProvider } from '@/context/language-context'
import { TeacherThreadStrip } from './teacher-thread-strip'

const nb = vi.hoisted(() => ({ native: false, opened: [] as string[] }))
vi.mock('@/lib/native-browser', () => ({
  isNativeShell: () => nb.native,
  openExternal: async (url: string) => { nb.opened.push(url) },
}))

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

// ── Download CV (App Store audit, 2026-10-06) ─────────────────────────────────────────────────────────
// Web: a plain new-tab link, as always. NATIVE SHELL: never a navigation — Safari has no eno session and a
// same-window load resets Capacitor's bridge — so the app fetches the signed link as JSON and opens it in the
// in-app browser; a refusal stays in the strip as its alert.
describe('TeacherThreadStrip — Download CV', () => {
  const contact = { phone: null, email: null, hasCv: true }
  function mountRecruiter() {
    return render(
      <LanguageProvider initialLang="en" initialViDict={{}}>
        <TeacherThreadStrip conversationId="c1" iAmTeacher={false} shared shareSignal={0} />
      </LanguageProvider>,
    )
  }
  beforeEach(() => { nb.native = false; nb.opened = [] })

  it('web: a new-tab link to the route, no fetch on click', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => contact })
    mountRecruiter()
    const link = await screen.findByRole('link', { name: /Download CV/ })
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('href')).toBe('/api/teachers/cv?conversationId=c1')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('native: no target, the tap fetches ?format=json and opens the signed URL in-app', async () => {
    nb.native = true
    fetchMock
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => contact })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ url: 'https://storage.example/cv.pdf?sig=1' }) })
    mountRecruiter()
    const link = await screen.findByRole('link', { name: /Download CV/ })
    expect(link.getAttribute('target')).toBeNull()
    await act(async () => { fireEvent.click(link) })
    expect(fetchMock.mock.calls[1][0]).toBe('/api/teachers/cv?conversationId=c1&format=json')
    expect(nb.opened).toEqual(['https://storage.example/cv.pdf?sig=1'])
  })

  it('native: a refusal stays in the strip as an alert, nothing opens', async () => {
    nb.native = true
    fetchMock
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => contact })
      .mockResolvedValueOnce({ ok: false, status: 403, json: async () => ({ error: 'blocked' }) })
    mountRecruiter()
    const link = await screen.findByRole('link', { name: /Download CV/ })
    await act(async () => { fireEvent.click(link) })
    expect(nb.opened).toEqual([])
    expect(screen.getByRole('alert').textContent).toContain('Could not open the CV')
  })
})
