// @vitest-environment jsdom
/**
 * ⛔ THE JOB-TEXT REFUSALS IN THE POST WIZARD (teacher visibility plan §3a item 6; approved in the plan, 2026-10-18) — the
 * wizard RUNNING. When the server's job-text screen refuses a hiring post (job-listing.ts jobTextProblem: visa or
 * residence wording, a discriminatory requirement, a candidate fee or adult-venue work — both editions), the seller reads
 * that rule's sentence, the form jumps to the field the server names, and the WORDS that tripped it (`detail`
 * '<field>:<snippet>') show under that field until they are taken out. The server half: core/listings.job-text.test.ts;
 * the sentences are pinned equal to the routes' JOB_TEXT_REFUSAL in post-wizard.job-text-copy.test.ts.
 * ⚠️ No tr()/t() call with literal copy in here: the string harvester (scripts/gen-ui-strings.mjs) scans test files too.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ListingEditData } from './post-wizard'
import type { SerializedCategory } from '@/lib/types'

// Each run cold-loads the whole post wizard: seconds under a loaded suite.
vi.setConfig({ testTimeout: 60_000 })

const h = vi.hoisted(() => ({
  router: { push: () => {}, prefetch: () => {}, replace: () => {}, refresh: () => {}, back: () => {} },
  language: { lang: 'en', t: (k: string) => k, tr: (en: string) => en, setLang: () => {} },
  auth: { user: { id: 'u1' }, profile: null, loading: false, openSignIn: () => {} },
  /** What the save answers: the refusal body (400). */
  refusal: {} as Record<string, unknown>,
  saves: [] as string[],
  /** Each save's parsed body. */
  bodies: [] as Record<string, unknown>[],
}))

vi.mock('next/navigation', () => ({ useRouter: () => h.router, usePathname: () => '/post', useSearchParams: () => new URLSearchParams() }))
vi.mock('sonner', () => ({ toast: Object.assign(() => {}, { success: () => {}, error: () => {}, loading: () => {}, dismiss: () => {} }) }))
vi.mock('@/context/language-context', () => ({
  useLanguage: () => h.language,
  useTr: (s: string) => s,
  Tr: ({ text }: { text?: string | null }) => <>{text}</>,
}))
vi.mock('@/context/auth-context', () => ({ useAuth: () => h.auth }))
vi.mock('@/context/currency-context', () => ({
  vndPerUsd: () => null,
  useCurrency: () => ({ currency: 'VND', rates: null, ratesPending: false, format: (n: number) => String(n) }),
}))
vi.mock('./square-crop-dialog', () => ({ SquareCropDialog: () => null }))
vi.mock('@/lib/analytics', () => ({ trackPostListing: () => {} }))

const { PostWizard } = await import('./post-wizard')
const { JOB_TEXT_REFUSAL } = await import('@/lib/job-listing')
const { JOB_TEXT_BLOCK_CODES } = await import('@/lib/publish-guard')

const CATS = [{ id: 'c-jobs', slug: 'jobs', name: 'Jobs', nameVi: 'Việc làm', icon: 'Briefcase', color: 'violet' }] as unknown as SerializedCategory[]

/** A complete Jobs › Teaching hiring post on the edit screen, so a Save reaches the server. */
const job: ListingEditData = {
  id: 'l1', title: 'English teacher, District 7', description: 'Teach adults in the evenings, 20 hours a week, at our centre.',
  price: 25_000_000, negotiable: false, urgent: false, categorySlug: 'jobs', subcategorySlug: 'teaching', listingType: 'job',
  condition: null, brand: null, model: null, attributes: { jobtype: 'fulltime', experience: '1-3-years', workMode: 'on-site' },
  year: null, mileageKm: null, engineL: null, engineCc: null, areaM2: null, salaryM: 25,
  district: 'Quận 7', city: 'Hồ Chí Minh', lat: null, lng: null, images: [], video: null,
}

function memoryStorage() {
  const m = new Map<string, string>()
  return {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => { m.set(k, String(v)) },
    removeItem: (k: string) => { m.delete(k) },
    clear: () => m.clear(),
    key: (i: number) => [...m.keys()][i] ?? null,
    get length() { return m.size },
  }
}

let scrolledTo: string[] = []

beforeEach(() => {
  scrolledTo = []
  h.saves = []
  h.bodies = []
  // jsdom has no layout: scrollIntoView is recorded instead (the jump).
  Element.prototype.scrollIntoView = function (this: Element) { scrolledTo.push(this.id) }
  vi.stubGlobal('localStorage', memoryStorage())
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const path = String(url)
    if (path.startsWith('/api/me')) {
      return { ok: true, json: async () => ({ user: { id: 'u1', displayName: 'Saigon English Centre', phone: '0901234567', seller: { name: 'Saigon English Centre', phone: '0901234567' } } }) }
    }
    if ((init?.method ?? 'GET') !== 'GET') {
      h.saves.push(path)
      try { h.bodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>) } catch { h.bodies.push({}) }
      return { ok: false, status: 400, json: async () => h.refusal }
    }
    return { ok: true, json: async () => ({}) }
  }))
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const settle = async () => { await act(async () => { await new Promise((r) => setTimeout(r, 0)) }) }
const frame = async () => { await act(async () => { await new Promise((r) => requestAnimationFrame(() => r(null))) }) }
const save = async () => {
  await act(async () => { fireEvent.click(screen.getAllByRole('button').find((b) => /Save changes/.test(b.textContent ?? ''))!) })
  await settle()
  await frame()
}

describe('the post wizard — a job-text refusal', () => {
  it('says each rule’s sentence, jumps to the field the server names and shows the words under it', async () => {
    const words = { title: 'English teacher', description: 'Teach adults' } as const
    for (const [code, field] of JOB_TEXT_BLOCK_CODES.map((c, i) => [c, i % 2 ? 'title' : 'description'] as const)) {
      h.refusal = { error: code, detail: `${field}:${words[field]}`, message: JOB_TEXT_REFUSAL[code] }
      scrolledTo = []
      render(<PostWizard categories={CATS} edit={job} />)
      await settle()
      await save()
      expect(h.saves.at(-1), code).toBe('/api/listings/l1')
      expect(document.body.textContent, code).toContain(JOB_TEXT_REFUSAL[code].en)
      expect(scrolledTo, code).toContain(`pw-${field}`)
      // The note is the field's own error: the control is marked invalid and DESCRIBED BY it, quoting the poster's words.
      const control = field === 'title' ? document.getElementById('pw-title')! : document.querySelector('#pw-description textarea')!
      const describedBy = (control.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean)
      expect(describedBy.map((id) => document.getElementById(id)?.textContent ?? '').join(' '), code).toContain(`Remove or reword this part: “${words[field]}”`)
      expect(control.getAttribute('aria-invalid'), code).toBe('true')
      cleanup()
    }
  })

  it('the note goes once the words are taken out of the field', async () => {
    h.refusal = { error: 'job_residence_wording', detail: 'description:visa support', message: JOB_TEXT_REFUSAL.job_residence_wording }
    render(<PostWizard categories={CATS} edit={{ ...job, description: `${job.description} We offer visa support.` }} />)
    await settle()
    await save()
    expect(document.body.textContent).toContain('Remove or reword this part: “visa support”')
    const box = document.querySelector<HTMLTextAreaElement>('#pw-description textarea')!
    await act(async () => { fireEvent.change(box, { target: { value: job.description } }) })
    expect(document.body.textContent).not.toContain('Remove or reword this part')
    // The rule's sentence stays until the next save, like every refusal.
    expect(document.body.textContent).toContain(JOB_TEXT_REFUSAL.job_residence_wording.en)
  })

  it('an attribute field (an API client’s) has nothing on this form to jump to — the sentence and the words still show', async () => {
    h.refusal = { error: 'job_residence_wording', detail: 'attributes.salaryText:visa' }
    render(<PostWizard categories={CATS} edit={{ ...job, attributes: { ...job.attributes, salaryText: '25M VND + visa' } }} />)
    await settle()
    await save()
    expect(document.body.textContent).toContain(JOB_TEXT_REFUSAL.job_residence_wording.en)
    expect(document.body.textContent).toContain('Remove or reword this part: “visa”')
    expect(scrolledTo.filter((id) => id === 'pw-title' || id === 'pw-description')).toEqual([])
  })

  it('a place field (district, city, location) jumps to the location picker, with the words while the place still holds them', async () => {
    h.refusal = { error: 'job_discrimination', detail: 'district:Female only' }
    render(<PostWizard categories={CATS} edit={{ ...job, district: 'Female only campus' }} />)
    await settle()
    await save()
    expect(scrolledTo).toContain('pw-location')
    expect(document.body.textContent).toContain('Remove or reword this part: “Female only”')
    cleanup()
    // A place that no longer holds those words: the sentence and the jump, no stale words.
    render(<PostWizard categories={CATS} edit={job} />)
    await settle()
    await save()
    expect(document.body.textContent).toContain(JOB_TEXT_REFUSAL.job_discrimination.en)
    expect(document.body.textContent).not.toContain('Remove or reword this part')
  })

  it('the words are found as the screen read them: a phrase the page joins across a line break in one paragraph', async () => {
    h.refusal = { error: 'job_residence_wording', detail: 'description:tạm trú', message: JOB_TEXT_REFUSAL.job_residence_wording }
    render(<PostWizard categories={CATS} edit={{ ...job, description: `${job.description}\nHỗ trợ làm thẻ tạm\ntrú cho giáo viên.` }} />)
    await settle()
    await save()
    const box = document.querySelector('#pw-description textarea')!
    const describedBy = (box.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean)
    expect(describedBy.map((id) => document.getElementById(id)?.textContent ?? '').join(' ')).toContain('Remove or reword this part: “tạm trú”')
  })

  /**
   * ⛔ "REMOVE THIS DETAIL" (2026-10-19): a refusal on an attribute the form has no control for — an API client's key,
   * screened as its Details row prints it ("Visa sponsorship: yes") — offers to drop it; the next save sends the attributes
   * without it.
   */
  it('⛔ an attribute the form does not render: the words, a “Remove this detail” button, and a save without it', async () => {
    h.refusal = { error: 'job_residence_wording', detail: 'attributes.visaSponsorship:Visa', message: JOB_TEXT_REFUSAL.job_residence_wording }
    render(<PostWizard categories={CATS} edit={{ ...job, attributes: { ...job.attributes, visaSponsorship: 'yes' } }} />)
    await settle()
    await save()
    expect(h.bodies.at(-1)?.attributes).toMatchObject({ visaSponsorship: 'yes' })
    expect(document.body.textContent).toContain('Remove or reword this part: “Visa”')
    const remove = screen.getAllByRole('button').find((b) => b.textContent === 'Remove this detail')
    expect(remove).toBeTruthy()
    await act(async () => { fireEvent.click(remove!) })
    // Gone from the form: the words and the button go with it; the rule's sentence stays until the next save.
    expect(document.body.textContent).not.toContain('Remove or reword this part')
    expect(screen.queryAllByRole('button').some((b) => b.textContent === 'Remove this detail')).toBe(false)
    expect(document.body.textContent).toContain(JOB_TEXT_REFUSAL.job_residence_wording.en)
    await save()
    expect(h.bodies.at(-1)?.attributes).toEqual(job.attributes)
  })

  it('an attribute the form renders (a facet chip) is reworded there — no “Remove this detail”', async () => {
    h.refusal = { error: 'job_residence_wording', detail: 'attributes.jobtype:fulltime', message: JOB_TEXT_REFUSAL.job_residence_wording }
    render(<PostWizard categories={CATS} edit={job} />)
    await settle()
    await save()
    expect(screen.queryAllByRole('button').some((b) => b.textContent === 'Remove this detail')).toBe(false)
  })
})
