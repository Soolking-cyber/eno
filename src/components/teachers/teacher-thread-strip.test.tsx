// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { LanguageProvider } from '@/context/language-context'
import { TeacherThreadStrip, type TeacherVideoFlags } from './teacher-thread-strip'

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

// ── The intro video kept private, sent on request (owner, 2026-10-07: "hide and send upon request") ──────────────────
// Teacher: Send / Stop, with the school's ask shown. School: Ask → asked → Watch, inline, on a 10-minute link that a
// playback error re-mints a bounded number of times. A 🎬 line (videoSignal) re-reads the state from the server.
describe('TeacherThreadStrip — intro video', () => {
  const flags = (o: Partial<TeacherVideoFlags> = {}): TeacherVideoFlags => ({ available: true, shareOn: false, shared: false, requested: false, ...o })
  const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body })
  const no = (status: number, error: string) => ({ ok: false, status, json: async () => ({ error }) })
  let routes: Record<string, (init?: RequestInit) => unknown>
  // The strip's clock (performance.now — the page stamps `videoReadAt` on the same one). It stands still unless a test
  // moves it, so a test that orders a read against an action sets each moment by hand: no race with a real clock.
  let perfNow = 0
  beforeEach(() => {
    routes = { '/api/teachers/contact': () => no(403, 'share_required') }
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      const path = url.split('?')[0]
      const r = routes[path]
      return r ? r(init) : no(404, 'not_found')
    })
    perfNow = 0
    vi.spyOn(performance, 'now').mockImplementation(() => perfNow)
  })
  afterEach(() => { vi.restoreAllMocks() })
  const strip = (props: Partial<React.ComponentProps<typeof TeacherThreadStrip>>) => (
    <LanguageProvider initialLang="en" initialViDict={{}}>
      <TeacherThreadStrip conversationId="c1" iAmTeacher shared={false} shareSignal={0} {...props} />
    </LanguageProvider>
  )
  const calls = (path: string) => fetchMock.mock.calls.filter(([u]) => String(u).split('?')[0] === path)

  it('teacher: the school\'s ask is shown, and Send turns the grant on', async () => {
    routes['/api/teachers/video-share'] = () => ok({ ok: true, shared: true })
    const { container } = render(strip({ video: flags({ requested: true }) }))
    expect(container.textContent).toContain('This school asked to see your intro video.')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Send my intro video/ })) })
    expect(JSON.parse(calls('/api/teachers/video-share')[0][1].body)).toEqual({ conversationId: 'c1', share: true })
    expect(container.textContent).toContain('This school can watch your intro video.')
    // Where the teacher decides to stop: a link already opened is a 10-minute bearer URL, and the line says so.
    expect(container.textContent).toContain('up to 10 minutes')
    expect(screen.getByRole('button', { name: 'Stop sharing video' })).toBeTruthy()
  })

  it('teacher: no private video kept on request → no video row at all', () => {
    const { container } = render(strip({ video: flags({ available: false }) }))
    expect(container.textContent).not.toContain('intro video')
  })

  it('teacher on a CLOSED thread: a standing video share can be withdrawn, and then nothing is left', async () => {
    routes['/api/teachers/video-share'] = () => ok({ ok: true, shared: false })
    const { container } = render(strip({ closed: true, video: flags({ shareOn: true, shared: true }) }))
    expect(container.textContent).toContain('can’t watch it while the conversation is closed')
    expect(screen.queryByRole('button', { name: /Share my phone/ })).toBeNull()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Stop sharing video' })) })
    expect(container.textContent).toBe('')
  })

  it('school: Ask posts once and the row says it was asked', async () => {
    routes['/api/teachers/video-request'] = () => ok({ ok: true })
    const { container } = render(strip({ iAmTeacher: false, video: flags() }))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Ask for their intro video/ })) })
    expect(calls('/api/teachers/video-request')).toHaveLength(1)
    expect(container.textContent).toContain('You asked for the intro video')
    expect(screen.queryByRole('button', { name: /Ask for their intro video/ })).toBeNull()
  })

  it('school: Watch plays inline; an EXPIRING link re-mints on an error, at most twice, then stops', async () => {
    let n = 0
    let now = 1_700_000_000_000
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now)
    routes['/api/teachers/video'] = () => ok({ url: `https://sb.eno.vn/storage/v1/object/sign/teacher-videos/v.mp4?token=${++n}`, expiresIn: 600 })
    const { container } = render(strip({ iAmTeacher: false, video: flags({ shareOn: true, shared: true }) }))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Watch intro video/ })) })
    const player = () => container.querySelector('video')
    expect(player()?.getAttribute('src')).toContain('token=1')
    for (const token of ['token=2', 'token=3']) {
      now += 9.5 * 60_000 // a long pause: the link is in its last minute
      await act(async () => { fireEvent.error(player()!) })
      expect(player()?.getAttribute('src')).toContain(token)
    }
    now += 9.5 * 60_000
    await act(async () => { fireEvent.error(player()!) }) // the third: no more re-mints
    expect(player()).toBeNull()
    expect(calls('/api/teachers/video')).toHaveLength(3)
    expect(screen.getByRole('alert').textContent).toContain('could not be played')
    clock.mockRestore()
  })

  it('school: a FRESH link that fails is not re-minted (a format or the network, not expiry) — the row says so', async () => {
    routes['/api/teachers/video'] = () => ok({ url: 'https://sb.eno.vn/storage/v1/object/sign/teacher-videos/v.mp4?token=1', expiresIn: 600 })
    const { container } = render(strip({ iAmTeacher: false, video: flags({ shareOn: true, shared: true }) }))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Watch intro video/ })) })
    await act(async () => { fireEvent.error(container.querySelector('video')!) })
    expect(container.querySelector('video')).toBeNull()
    expect(calls('/api/teachers/video')).toHaveLength(1)
    expect(screen.getByRole('alert').textContent).toContain('could not be played')
    expect(screen.getByRole('button', { name: /Watch intro video/ })).toBeTruthy() // a fresh try is one tap away
  })

  it('school: a link answered AFTER Close never reopens the player (a re-mint in flight when the school closed it)', async () => {
    let now = 1_700_000_000_000
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now)
    let answer: ((v: unknown) => void) | null = null
    let n = 0
    routes['/api/teachers/video'] = () => (++n === 1
      ? ok({ url: 'https://sb.eno.vn/storage/v1/object/sign/teacher-videos/v.mp4?token=1', expiresIn: 600 })
      : new Promise((res) => { answer = res }))
    const { container } = render(strip({ iAmTeacher: false, video: flags({ shareOn: true, shared: true }) }))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Watch intro video/ })) })
    now += 9.5 * 60_000
    await act(async () => { fireEvent.error(container.querySelector('video')!) }) // expiring → a re-mint goes out
    expect(answer).not.toBeNull()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Close video' })) })
    expect(container.querySelector('video')).toBeNull()
    await act(async () => { answer!(ok({ url: 'https://sb.eno.vn/storage/v1/object/sign/teacher-videos/v.mp4?token=late', expiresIn: 600 })) })
    expect(container.querySelector('video')).toBeNull() // the late link is dropped, not played
    clock.mockRestore()
  })

  it('school: sharing ending by a payload refresh (no 🎬 line, e.g. a hidden profile) closes the player', async () => {
    routes['/api/teachers/video'] = () => ok({ url: 'https://sb.eno.vn/storage/v1/object/sign/teacher-videos/v.mp4?token=1', expiresIn: 600 })
    const { container, rerender } = render(strip({ iAmTeacher: false, video: flags({ shareOn: true, shared: true }) }))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Watch intro video/ })) })
    expect(container.querySelector('video')).not.toBeNull()
    await act(async () => { rerender(strip({ iAmTeacher: false, video: flags({ shareOn: true, shared: false, available: false }) })) })
    expect(container.querySelector('video')).toBeNull()
    // …and sharing again starts from a fresh Watch, never the stale link.
    await act(async () => { rerender(strip({ iAmTeacher: false, video: flags({ shareOn: true, shared: true }) })) })
    expect(container.querySelector('video')).toBeNull()
    expect(screen.getByRole('button', { name: /Watch intro video/ })).toBeTruthy()
  })

  it('school: a re-mint that fails on the NETWORK closes the expiring player — Watch is back, never a dead player', async () => {
    let now = 1_700_000_000_000
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now)
    let n = 0
    routes['/api/teachers/video'] = () => {
      if (++n === 1) return ok({ url: 'https://sb.eno.vn/storage/v1/object/sign/teacher-videos/v.mp4?token=1', expiresIn: 600 })
      throw new TypeError('Failed to fetch')
    }
    const { container } = render(strip({ iAmTeacher: false, video: flags({ shareOn: true, shared: true }) }))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Watch intro video/ })) })
    now += 9.5 * 60_000
    await act(async () => { fireEvent.error(container.querySelector('video')!) })
    expect(container.querySelector('video')).toBeNull()
    expect(screen.getByRole('button', { name: /Watch intro video/ })).toBeTruthy()
    expect(screen.getByRole('alert')).toBeTruthy()
    clock.mockRestore()
  })

  it('a 🎬 re-read clears an alert about the state it replaced', async () => {
    routes['/api/teachers/video'] = () => no(403, 'share_required')
    // The server: stopped — until the teacher sends it again.
    let resent = false
    routes['/api/teachers/video-share'] = () => ok(resent ? flags({ shareOn: true, shared: true }) : flags({ shareOn: false, shared: false, requested: false }))
    const payload = flags({ shareOn: true, shared: true }) // one payload throughout, as on the page: only the re-read speaks
    const { rerender } = render(strip({ iAmTeacher: false, video: payload, videoSignal: 1 }))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Watch intro video/ })) })
    await act(async () => {}) // the read that confirms the refusal: the same stopped state — the alert stays
    expect(screen.getByRole('alert').textContent).toContain('stopped sharing')
    // The teacher sends it again: a 🎬 line → the row re-reads (starting after the refusal), and the old alert goes.
    resent = true
    perfNow = 10
    await act(async () => { rerender(strip({ iAmTeacher: false, video: payload, videoSignal: 2 })) })
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByRole('button', { name: /Watch intro video/ })).toBeTruthy()
  })

  it('a refusal’s alert goes when the read confirming it already shows a newer state — compared with the patch, not the state before it', async () => {
    routes['/api/teachers/video'] = () => no(403, 'share_required')
    // Re-sent between the refusal and its confirming read: the newest word is "shared" — both land before React renders.
    routes['/api/teachers/video-share'] = () => ok(flags({ shareOn: true, shared: true }))
    render(strip({ iAmTeacher: false, video: flags({ shareOn: true, shared: true }) }))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Watch intro video/ })) })
    await act(async () => {})
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByRole('button', { name: /Watch intro video/ })).toBeTruthy()
  })

  it('an alert stays while the state it describes does: a poll repeating "stopped" keeps "stopped sharing"', async () => {
    routes['/api/teachers/video'] = () => no(403, 'share_required')
    const { rerender } = render(strip({ iAmTeacher: false, video: flags({ shareOn: true, shared: true }), videoReadAt: 10 }))
    perfNow = 20
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Watch intro video/ })) })
    expect(screen.getByRole('alert').textContent).toContain('stopped sharing')
    // The next poll (it left at 30, after the refusal) brings the server's view — the same stopped state.
    await act(async () => { rerender(strip({ iAmTeacher: false, video: flags({ shareOn: false, shared: false, requested: false }), videoReadAt: 30 })) })
    expect(screen.getByRole('alert').textContent).toContain('stopped sharing')
  })

  it('a 🎬 re-read that STARTED before an action and lands after it is dropped — the action\'s result stands', async () => {
    let answer!: (v: unknown) => void
    routes['/api/teachers/video-share'] = () => new Promise((res) => { answer = res })
    const payload = flags({ requested: true })
    const { rerender } = render(strip({ video: payload, videoReadAt: 0, videoSignal: 1 }))
    // At 10 a 🎬 line (the school's ask) starts a re-read…
    perfNow = 10
    await act(async () => { rerender(strip({ video: payload, videoReadAt: 0, videoSignal: 2 })) })
    // …and the teacher's Send ends at 20, before it answers.
    const pending = answer
    routes['/api/teachers/video-share'] = () => ok({ ok: true, shared: true })
    perfNow = 20
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Send my intro video/ })) })
    expect(screen.getByRole('button', { name: 'Stop sharing video' })).toBeTruthy()
    // The re-read lands at 30 with the state from before the Send: it counts from 10, so it is older.
    perfNow = 30
    await act(async () => { pending(ok(flags({ requested: true }))) })
    expect(screen.getByRole('button', { name: 'Stop sharing video' })).toBeTruthy()
  })

  it('teacher: a poll that left BEFORE a Send ended is older than the Send — ignored, Stop stays', async () => {
    routes['/api/teachers/video-share'] = () => ok({ ok: true, shared: true })
    const { rerender } = render(strip({ video: flags(), videoReadAt: 10 }))
    perfNow = 50 // the Send ends at 50
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Send my intro video/ })) })
    expect(screen.getByRole('button', { name: 'Stop sharing video' })).toBeTruthy()
    // The 15s poll left at 40, while the Send was in flight, and lands now with the state from before it.
    await act(async () => { rerender(strip({ video: flags(), videoReadAt: 40 })) })
    expect(screen.getByRole('button', { name: 'Stop sharing video' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Send my intro video/ })).toBeNull()
  })

  it('teacher: a poll that left AFTER the Send ended applies — here the profile was hidden since', async () => {
    routes['/api/teachers/video-share'] = () => ok({ ok: true, shared: true })
    const { container, rerender } = render(strip({ video: flags(), videoReadAt: 10 }))
    perfNow = 50
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Send my intro video/ })) })
    expect(container.textContent).toContain('This school can watch your intro video.')
    await act(async () => { rerender(strip({ video: flags({ shareOn: true, available: false }), videoReadAt: 60 })) })
    expect(container.textContent).toContain('Paused while your profile is hidden')
    expect(screen.getByRole('button', { name: 'Stop sharing video' })).toBeTruthy()
  })

  it('school: a poll that left before the 🎬 re-read that brought Watch never closes the open player', async () => {
    routes['/api/teachers/video-share'] = () => ok(flags({ shareOn: true, shared: true, requested: true }))
    routes['/api/teachers/video'] = () => ok({ url: 'https://sb.eno.vn/storage/v1/object/sign/teacher-videos/v.mp4?token=1', expiresIn: 600 })
    const payload = flags({ requested: true })
    const { container, rerender } = render(strip({ iAmTeacher: false, video: payload, videoReadAt: 10, videoSignal: 1 }))
    // The teacher's send: its 🎬 line starts a re-read at 30, which brings Watch, and the school opens the player.
    perfNow = 30
    await act(async () => { rerender(strip({ iAmTeacher: false, video: payload, videoReadAt: 10, videoSignal: 2 })) })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Watch intro video/ })) })
    expect(container.querySelector('video')).not.toBeNull()
    // The 15s poll that left at 20, before the send, lands with "not shared": older than the re-read, dropped.
    await act(async () => { rerender(strip({ iAmTeacher: false, video: flags({ requested: true }), videoReadAt: 20, videoSignal: 2 })) })
    expect(container.querySelector('video')).not.toBeNull()
  })

  it('a coarse clock: a poll whose start reads the same as a Send’s end is not taken over it — the re-read the Send started is', async () => {
    routes['/api/teachers/video-share'] = (init) => (init?.method === 'POST' ? ok({ ok: true, shared: true }) : ok(flags({ shareOn: true, shared: true })))
    perfNow = 100
    const { rerender } = render(strip({ video: flags(), videoReadAt: 50 }))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Send my intro video/ })) })
    await act(async () => {})
    expect(screen.getByRole('button', { name: 'Stop sharing video' })).toBeTruthy()
    // A poll that left in the same clock tick as the Send ended — it may have read the state before it — still says "not sent".
    await act(async () => { rerender(strip({ video: flags(), videoReadAt: 100 })) })
    expect(screen.getByRole('button', { name: 'Stop sharing video' })).toBeTruthy()
  })

  it('an action’s answer is confirmed by a fresh read: a stop made in the teacher’s other tab meanwhile shows at once', async () => {
    // The POST saw the send; by the time it answered, the other tab had stopped sharing — the read that starts after says so.
    routes['/api/teachers/video-share'] = (init) => (init?.method === 'POST' ? ok({ ok: true, shared: true }) : ok(flags({ shareOn: false, shared: false })))
    perfNow = 10
    render(strip({ video: flags(), videoReadAt: 5 }))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Send my intro video/ })) })
    await act(async () => {})
    expect(calls('/api/teachers/video-share').map(([, init]) => (init as RequestInit | undefined)?.method ?? 'GET')).toEqual(['POST', 'GET'])
    expect(screen.getByRole('button', { name: /Send my intro video/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Stop sharing video' })).toBeNull()
  })

  it('school: a hidden profile answers Watch with ITS reason — not "stopped sharing", and no Ask over it', async () => {
    routes['/api/teachers/video'] = () => no(409, 'profile_hidden')
    render(strip({ iAmTeacher: false, video: flags({ shareOn: true, shared: true }) }))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Watch intro video/ })) })
    expect(screen.getByRole('alert').textContent).toContain('isn’t visible right now')
    expect(screen.queryByRole('button', { name: /Ask for their intro video/ })).toBeNull()
  })

  it('school: after a refusal, a NEWER poll repeating the earlier payload brings Watch back (never stuck until a reload)', async () => {
    let refused = true
    routes['/api/teachers/video'] = () => (refused ? no(409, 'profile_hidden') : ok({ url: 'https://sb.eno.vn/storage/v1/object/sign/teacher-videos/v.mp4?token=1', expiresIn: 600 }))
    const { rerender } = render(strip({ iAmTeacher: false, video: flags({ shareOn: true, shared: true }), videoReadAt: 10 }))
    perfNow = 20 // the refusal lands at 20
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Watch intro video/ })) })
    expect(screen.queryByRole('button', { name: /Watch intro video/ })).toBeNull()
    // A poll that left at 15, before the refusal, is older than it: still no Watch.
    await act(async () => { rerender(strip({ iAmTeacher: false, video: flags({ shareOn: true, shared: true }), videoReadAt: 15 })) })
    expect(screen.queryByRole('button', { name: /Watch intro video/ })).toBeNull()
    // The teacher shows the profile again; the poll that left at 30 carries the same flags as the first payload.
    refused = false
    await act(async () => { rerender(strip({ iAmTeacher: false, video: flags({ shareOn: true, shared: true }), videoReadAt: 30 })) })
    expect(screen.getByRole('button', { name: /Watch intro video/ })).toBeTruthy()
  })

  it('school: a stop since the page loaded answers Watch with its reason — and Ask is offered again', async () => {
    routes['/api/teachers/video'] = () => no(403, 'share_required')
    render(strip({ iAmTeacher: false, video: flags({ shareOn: true, shared: true, requested: true }) }))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Watch intro video/ })) })
    expect(screen.getByRole('alert').textContent).toContain('stopped sharing')
    expect(screen.getByRole('button', { name: /Ask for their intro video/ })).toBeTruthy()
  })

  it('a 🎬 line re-reads the state: the teacher\'s send turns the school\'s row into Watch', async () => {
    routes['/api/teachers/video-share'] = () => ok(flags({ shareOn: true, shared: true, requested: true }))
    const payload = flags({ requested: true })
    const { rerender } = render(strip({ iAmTeacher: false, video: payload, videoSignal: 1 }))
    expect(calls('/api/teachers/video-share')).toHaveLength(0) // not on mount — the payload is fresh
    await act(async () => { rerender(strip({ iAmTeacher: false, video: payload, videoSignal: 2 })) })
    expect(calls('/api/teachers/video-share')).toHaveLength(1)
    expect(screen.getByRole('button', { name: /Watch intro video/ })).toBeTruthy()
  })

  // ── Refusals that mean "this can't succeed" hide the action, and say why on the right side (gate review, 2026-10-08) ──
  it('school: an Ask refused because the profile is hidden takes the Ask away, saying why', async () => {
    routes['/api/teachers/video-request'] = () => no(409, 'profile_hidden')
    render(strip({ iAmTeacher: false, video: flags() }))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Ask for their intro video/ })) })
    expect(screen.getByRole('alert').textContent).toContain('isn’t visible right now')
    expect(screen.queryByRole('button', { name: /intro video/ })).toBeNull()
  })

  it.each(['video_missing', 'video_not_on_request', 'profile_hidden'])('teacher: a Send refused with %s takes Send away, saying why', async (code) => {
    routes['/api/teachers/video-share'] = () => no(code === 'video_missing' ? 404 : 409, code)
    render(strip({ video: flags({ requested: true }) }))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Send my intro video/ })) })
    expect(screen.queryByRole('button', { name: /Send my intro video/ })).toBeNull()
    expect(screen.getByRole('alert').textContent).toContain(code === 'profile_hidden' ? 'Show your profile again' : 'no private intro video on your profile')
  })

  it('school: a video no longer kept on request answers Watch with that — never "no video" (it may be public now)', async () => {
    routes['/api/teachers/video'] = () => no(409, 'video_not_on_request')
    render(strip({ iAmTeacher: false, video: flags({ shareOn: true, shared: true }) }))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Watch intro video/ })) })
    expect(screen.getByRole('alert').textContent).toContain('no longer sends their video on request — if they show it, it’s on their profile')
    expect(screen.queryByRole('button', { name: /intro video/ })).toBeNull()
  })

  it('teacher: a Send refused as business_only says who can receive it — and Send goes', async () => {
    routes['/api/teachers/video-share'] = () => no(403, 'business_only')
    render(strip({ video: flags() }))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Send my intro video/ })) })
    expect(screen.getByRole('alert').textContent).toBe('Only school and company accounts can receive your intro video.')
    expect(screen.queryByRole('button', { name: /Send my intro video/ })).toBeNull()
  })

  it.each([
    ['Ask', '/api/teachers/video-request', flags(), /Ask for their intro video/],
    ['Watch', '/api/teachers/video', flags({ shareOn: true, shared: true }), /Watch intro video/],
  ])('school: %s refused as business_only says why, and the video row goes', async (_, path, video, button) => {
    routes[path] = () => no(403, 'business_only')
    render(strip({ iAmTeacher: false, video }))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: button })) })
    expect(screen.getByRole('alert').textContent).toBe('Only school and company accounts can ask for a teacher’s intro video.')
    expect(screen.queryByRole('button', { name: /intro video/ })).toBeNull()
  })

  // ── Ask again, a day later (teacherVideoState `askAgain`) ──────────────────────────────────────────────────────────
  it('school: an ask that stands shows "You asked…"; a day later "Ask again", and asking again goes back to "You asked…"', async () => {
    routes['/api/teachers/video-request'] = () => ok({ ok: true, requested: true, shared: false })
    const { container, rerender } = render(strip({ iAmTeacher: false, video: flags({ requested: true }), videoReadAt: 10 }))
    expect(container.textContent).toContain('You asked for the intro video')
    expect(screen.queryByRole('button', { name: /Ask/ })).toBeNull()
    await act(async () => { rerender(strip({ iAmTeacher: false, video: flags({ requested: true, askAgain: true }), videoReadAt: 20 })) })
    expect(container.textContent).not.toContain('You asked for the intro video')
    perfNow = 30
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Ask again for their intro video/ })) })
    expect(calls('/api/teachers/video-request')).toHaveLength(1)
    expect(container.textContent).toContain('You asked for the intro video')
    expect(screen.queryByRole('button', { name: /Ask/ })).toBeNull()
  })

  it('school: an Ask that finds the video already sent shows Watch — the answer is the newest word', async () => {
    routes['/api/teachers/video-request'] = () => ok({ ok: true, requested: false, shared: true })
    render(strip({ iAmTeacher: false, video: flags() }))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Ask for their intro video/ })) })
    expect(screen.getByRole('button', { name: /Watch intro video/ })).toBeTruthy()
  })

  // ── Business accounts only (teacherVideoState `forBusiness`) ───────────────────────────────────────────────────────
  it('school: a buyer that is not a school or company account gets no video row at all', () => {
    const { container } = render(strip({ iAmTeacher: false, video: flags({ shareOn: true, forBusiness: false }) }))
    expect(container.textContent).not.toContain('intro video')
  })

  it('teacher: nothing to Send to a buyer that is not a business; a standing share keeps Stop, saying why it is idle', async () => {
    const { container, rerender } = render(strip({ video: flags({ requested: true, forBusiness: false }) }))
    expect(screen.queryByRole('button', { name: /Send my intro video/ })).toBeNull()
    expect(container.textContent).not.toContain('intro video')
    await act(async () => { rerender(strip({ video: flags({ shareOn: true, forBusiness: false }) })) })
    expect(container.textContent).toContain('This account is no longer a school or company, so it can’t watch your video.')
    expect(container.textContent).not.toContain('This school can watch your intro video.')
    expect(screen.getByRole('button', { name: 'Stop sharing video' })).toBeTruthy()
  })
})
