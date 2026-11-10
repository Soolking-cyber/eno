// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { ClassroomCspGuard, loadedForAnotherPage } from './csp-guard'

/**
 * THE CLASSROOM'S OWN DOCUMENT (owner's iPhone, 2026-11-10: "Connecting…" for good): a classroom page shown in a document
 * loaded for another eno.vn page carries the site's CSP — Soniox's socket refused, the face blocked — so it reloads once.
 */
const navigatedFrom = (url: string | null, type = 'navigate') =>
  vi.spyOn(performance, 'getEntriesByType').mockReturnValue((url ? [{ name: url, type }] : []) as unknown as PerformanceEntryList)

afterEach(() => { cleanup(); vi.restoreAllMocks(); sessionStorage.clear() })

describe('loadedForAnotherPage', () => {
  it('a document loaded for a classroom page (either spelling, any depth) keeps its own policy', () => {
    for (const u of ['https://eno.vn/classroom', 'https://eno.vn/classroom/tutors/t1?trace=1', 'https://eno.vn/vi/classroom/voice', 'https://eno.vn/en/classroom']) {
      expect(loadedForAnotherPage(u), u).toBe(false)
    }
  })
  it('one loaded for any other page carries the site\'s policy — never /classrooms, never a look-alike', () => {
    for (const u of ['https://eno.vn/', 'https://eno.vn/?category=teachers', 'https://eno.vn/classrooms', 'https://eno.vn/teachers/classroom', 'https://eno.vn/vi']) {
      expect(loadedForAnotherPage(u), u).toBe(true)
    }
  })
  it('unknown (no entry, a broken URL) → no reload', () => {
    expect(loadedForAnotherPage(undefined)).toBe(false)
    expect(loadedForAnotherPage('not a url')).toBe(false)
  })
})

describe('<ClassroomCspGuard>', () => {
  it('arrived from another page: the classroom page loads again', () => {
    navigatedFrom('https://eno.vn/')
    const reload = vi.fn()
    render(<ClassroomCspGuard reload={reload} />)
    expect(reload).toHaveBeenCalledTimes(1)
  })
  it('⛔ never a loop: a document its own reload made — even one a redirect landed elsewhere — is left as it is', () => {
    const reload = vi.fn()
    navigatedFrom('https://eno.vn/')
    render(<ClassroomCspGuard reload={reload} />)
    cleanup()
    navigatedFrom('https://eno.vn/login?next=/classroom', 'reload') // the reload went to sign-in, which came back here
    render(<ClassroomCspGuard reload={reload} />)
    expect(reload).toHaveBeenCalledTimes(1)
  })
  it('…but ONLY that one (commit review, codex): a page opened afresh moments later, or a reload long after, still reloads', () => {
    const reload = vi.fn()
    navigatedFrom('https://eno.vn/')
    render(<ClassroomCspGuard reload={reload} />)
    cleanup()
    navigatedFrom('https://eno.vn/listings/x') // a new document within the 15 s, then a tap into the classroom
    render(<ClassroomCspGuard reload={reload} />)
    expect(reload).toHaveBeenCalledTimes(2)
    cleanup()
    sessionStorage.setItem('eno-classroom-own-document', String(Date.now() - 60_000))
    navigatedFrom('https://eno.vn/', 'reload') // the owner reloaded the home page a minute after
    render(<ClassroomCspGuard reload={reload} />)
    expect(reload).toHaveBeenCalledTimes(3)
  })
  it('a classroom document, or no navigation entry: nothing happens', () => {
    const reload = vi.fn()
    navigatedFrom('https://eno.vn/classroom/tutors/t1')
    render(<ClassroomCspGuard reload={reload} />)
    cleanup()
    navigatedFrom('https://eno.vn/classroom', 'reload')
    render(<ClassroomCspGuard reload={reload} />)
    cleanup()
    navigatedFrom(null)
    render(<ClassroomCspGuard reload={reload} />)
    expect(reload).not.toHaveBeenCalled()
  })
  it('no storage (commit review, codex): a fresh document still reloads; one a reload made does not', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied') })
    const reload = vi.fn()
    navigatedFrom('https://eno.vn/')
    render(<ClassroomCspGuard reload={reload} />)
    expect(reload).toHaveBeenCalledTimes(1)
    cleanup()
    navigatedFrom('https://eno.vn/', 'reload')
    render(<ClassroomCspGuard reload={reload} />)
    expect(reload).toHaveBeenCalledTimes(1)
  })
})
