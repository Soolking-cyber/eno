// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const h = vi.hoisted(() => ({
  available: true,
  user: { id: 'u1', email: 'a@x.example' } as { id: string; email?: string } | null,
  fb: null as string | null,
  verifyOk: true,
  refresh: vi.fn(async () => ({})),
  replace: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}))

vi.mock('@/context/language-context', () => ({ useLanguage: () => ({ lang: 'en', tr: (en: string) => en }) }))
vi.mock('@/context/auth-context', () => ({ useAuth: () => ({ user: h.user }) }))
vi.mock('@/lib/facebook-signin', () => ({ facebookAvailableHere: () => h.available }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: h.replace }),
  useSearchParams: () => new URLSearchParams(h.fb ? `tab=privacy&fb=${h.fb}` : 'tab=privacy'),
}))
vi.mock('sonner', () => ({ toast: { success: h.success, error: h.error } }))
vi.mock('@/lib/supabase/browser', () => ({ createSupabaseBrowser: () => ({ auth: { refreshSession: h.refresh } }) }))
vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) => (open ? <div>{children}</div> : null),
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
}))
vi.mock('@/components/ui/input-otp', () => ({
  InputOTP: ({ onComplete }: { onComplete: (v: string) => void }) => <input aria-label="code" onChange={(e) => onComplete(e.target.value)} />,
  InputOTPGroup: () => null,
  InputOTPSlot: () => null,
}))

const { FacebookConnectRow } = await import('./facebook-connect-row')

const answer = (status: { on: boolean; connected: boolean; canDisconnect: boolean }, post = 200) => {
  const f = vi.fn(async (u: string, init?: RequestInit) => {
    if (u.endsWith('/verify')) return new Response('{}', { status: h.verifyOk ? 200 : 400 })
    return new Response(JSON.stringify(init?.method === 'POST' ? { ok: post === 200, codeLength: 6 } : status), { status: init?.method === 'POST' ? post : 200 })
  })
  vi.stubGlobal('fetch', f)
  return f
}

beforeEach(() => { h.available = true; h.user = { id: 'u1', email: 'a@x.example' }; h.fb = null; vi.clearAllMocks(); h.verifyOk = true })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('Settings › Privacy › Facebook', () => {
  it('offers no Connect where it can’t run (the apps, a webview)', async () => {
    h.available = false
    answer({ on: true, connected: false, canDisconnect: false })
    const { container } = render(<FacebookConnectRow />)
    await new Promise((r) => setTimeout(r, 10))
    expect(container.textContent).toBe('')
  })
  it('still offers Disconnect there: the notice mail sends a phished owner to it', async () => {
    h.available = false
    answer({ on: true, connected: true, canDisconnect: true })
    render(<FacebookConnectRow />)
    expect(await screen.findByRole('button', { name: 'Disconnect' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Connect' })).toBeNull()
  })
  it('Facebook being off never hides Disconnect from someone connected', async () => {
    answer({ on: false, connected: true, canDisconnect: true })
    render(<FacebookConnectRow />)
    expect(await screen.findByRole('button', { name: 'Disconnect' })).toBeTruthy()
  })
  it('shows nothing while the server has it off', async () => {
    answer({ on: false, connected: false, canDisconnect: false })
    const { container } = render(<FacebookConnectRow />)
    await new Promise((r) => setTimeout(r, 10))
    expect(container.textContent).toBe('')
  })
  it('Connect mails a code first, then a right code leaves for the start route', async () => {
    const f = answer({ on: true, connected: false, canDisconnect: false })
    const assign = vi.fn()
    vi.stubGlobal('location', { ...window.location, assign })
    render(<FacebookConnectRow />)
    fireEvent.click(await screen.findByRole('button', { name: 'Connect' }))
    const code = await screen.findByLabelText('code')
    expect(screen.getByText(/a@x\.example/)).toBeTruthy()
    fireEvent.change(code, { target: { value: '007302' } })
    // Leading zeros intact: a string end to end.
    await waitFor(() => expect(f).toHaveBeenCalledWith('/api/auth/facebook/connect/verify', expect.objectContaining({ body: JSON.stringify({ code: '007302' }) })))
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/auth/facebook/connect/start'))
  })
  it('a wrong code stays on the code and can be retried', async () => {
    answer({ on: true, connected: false, canDisconnect: false })
    h.verifyOk = false
    render(<FacebookConnectRow />)
    fireEvent.click(await screen.findByRole('button', { name: 'Connect' }))
    fireEvent.change(await screen.findByLabelText('code'), { target: { value: '111111' } })
    expect((await screen.findByRole('alert')).textContent).toContain('didn’t work')
  })
  it('a mail that fails says so and opens no dialog', async () => {
    answer({ on: true, connected: false, canDisconnect: false }, 502)
    render(<FacebookConnectRow />)
    fireEvent.click(await screen.findByRole('button', { name: 'Connect' }))
    await waitFor(() => expect(h.error).toHaveBeenCalled())
    expect(screen.queryByLabelText('code')).toBeNull()
  })
  it('Disconnect takes the code too, then removes and refreshes this session', async () => {
    const f = answer({ on: true, connected: true, canDisconnect: true })
    render(<FacebookConnectRow />)
    fireEvent.click(await screen.findByRole('button', { name: 'Disconnect' }))
    expect(f).not.toHaveBeenCalledWith('/api/auth/facebook/disconnect', expect.anything())
    fireEvent.change(await screen.findByLabelText('code'), { target: { value: '111111' } })
    await waitFor(() => expect(h.success).toHaveBeenCalled())
    expect(f).toHaveBeenCalledWith('/api/auth/facebook/disconnect', expect.objectContaining({ method: 'POST' }))
    expect(h.refresh).toHaveBeenCalled()
    expect(await screen.findByRole('button', { name: 'Connect' })).toBeTruthy()
  })
  it('a wrong code disconnects nothing', async () => {
    const f = answer({ on: true, connected: true, canDisconnect: true })
    h.verifyOk = false
    render(<FacebookConnectRow />)
    fireEvent.click(await screen.findByRole('button', { name: 'Disconnect' }))
    fireEvent.change(await screen.findByLabelText('code'), { target: { value: '111111' } })
    await screen.findByRole('alert')
    expect(f).not.toHaveBeenCalledWith('/api/auth/facebook/disconnect', expect.anything())
  })
  it('another account’s row is gone at once, and stays gone if its answer fails', async () => {
    answer({ on: true, connected: true, canDisconnect: true })
    const { rerender, container } = render(<FacebookConnectRow />)
    await screen.findByRole('button', { name: 'Disconnect' })
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 500 })))
    h.user = { id: 'u2', email: 'b@x.example' }
    rerender(<FacebookConnectRow />)
    await waitFor(() => expect(container.textContent).toBe(''))
  })
  it('an account made with Facebook has no Disconnect: nobody proved its mailbox', async () => {
    answer({ on: true, connected: true, canDisconnect: false })
    render(<FacebookConnectRow />)
    await screen.findByText(/^Connected\./)
    expect(screen.queryByRole('button', { name: 'Disconnect' })).toBeNull()
  })
  it('the return from Facebook says one thing once, then cleans the address', async () => {
    h.fb = 'held'
    answer({ on: true, connected: false, canDisconnect: false })
    render(<FacebookConnectRow />)
    await waitFor(() => expect(h.error).toHaveBeenCalledWith('That Facebook account already belongs to another eno account.'))
    expect(h.replace).toHaveBeenCalledWith('?tab=privacy', { scroll: false })
  })
})
