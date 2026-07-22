import { beforeEach, describe, expect, it, vi } from 'vitest'

// THE FINISHED VISA — the three properties that decide whether this feature is safe to ship,
// none of which is observable from a live e2e without moving a real applicant's identity
// document around:
//
//  1. NOTHING HAPPENS BEFORE THE ADMIN GATE. The upload route is driven with every data
//     call counted; a non-admin must be refused AND leave every counter at zero. Deleting
//     `if (!admin) …` turns this file red.
//  2. NOBODY ELSE CAN READ THE PDF. The download route is driven as a signed-in stranger
//     and must answer 404 having read nothing out of storage. Deleting the ownership
//     comparison turns this file red.
//  3. ONE RESULT PER CASE, EVER. A second upload is refused before anything is stored, and
//     the lost side of a RACE (the unique-index violation) is refused too — with the object
//     it had already uploaded removed again, so the bucket keeps no orphan.
//
// A FOURTH has its own block: the PDF validation. It is the last moment a wrong file can be
// refused, because the hard cap means there is no second upload to correct it.

// ── The routes' world ─────────────────────────────────────────────────────────────
// Everything both routes touch is mocked, so the tests exercise the handlers' own order of
// operations and nothing else. The counters are the assertion surface for properties 1–3.
const APP_ID = '3f2a91bc-1111-4222-8333-444455556666'
const DOC_ID = '7c1d2e3f-4444-4555-8666-777788889999'

/** A minimal, structurally valid PDF: the header magic and the trailer marker. */
const pdf = (body = 'x') => Buffer.from(`%PDF-1.7\n${body}\n%%EOF\n`, 'latin1')

const h = vi.hoisted(() => {
  const application = {
    id: '3f2a91bc-1111-4222-8333-444455556666',
    user_id: 'applicant-1',
    status: 'processing',
    reference: 'EV-1042',
    encrypted_payload: 'envelope',
  }
  return {
    state: {
      /** visa_documents rows removed by a rollback. */
      deletes: [] as Array<{ table: string; id: string }>,
      deleteError: null as unknown,
      // identities
      admin: 'desk@eno.vn' as string | null,
      profileId: null as string | null,
      rateLimitOk: true,
      cryptoReady: true,
      mailOk: true,
      // data
      application: application as Record<string, unknown> | null,
      loadError: null as { code?: string } | null,
      resultDocs: [] as Array<Record<string, unknown>>,
      docLookupError: null as { code?: string } | null,
      insertError: null as { code?: string } | null,
      storedBytes: Buffer.from('%PDF-1.7\nstored\n%%EOF\n', 'latin1'),
      downloadFails: false,
      shop: { id: 'shop-1', ownerId: 'shop-owner-1' } as { id: string; ownerId: string } | null,
      conversation: {
        id: 'convo-1', buyerProfileId: 'applicant-1', sellerProfileId: 'shop-owner-1',
        listingId: 'listing-1', visaApplicationId: application.id,
      } as Record<string, unknown> | null,
      // counters — the "nothing happened" proof
      caseLoads: 0,
      docLookups: 0,
      uploads: [] as Array<{ path: string; size: number }>,
      inserts: [] as Array<Record<string, unknown>>,
      removed: [] as string[],
      storageDownloads: [] as string[],
      decrypts: 0,
      events: [] as Array<{ id: string; actorType: string; event: string; actorRef?: string; metadata: unknown }>,
      cards: [] as Array<{ senderId: string; kind?: string; meta?: unknown; preview?: string }>,
      mails: [] as Array<Record<string, unknown>>,
    },
  }
})

vi.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number; headers?: Record<string, string> }) =>
      new Response(JSON.stringify(body), {
        status: init?.status ?? 200,
        headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
      }),
  },
}))
vi.mock('@/lib/admin', () => ({
  getAdmin: async () => h.state.admin,
  getCurrentProfileId: async () => h.state.profileId,
}))
vi.mock('@/lib/ratelimit', () => ({ rateLimit: async () => ({ success: h.state.rateLimitOk, remaining: 9 }) }))
vi.mock('@/lib/visa-admin', () => ({ VISA_BUCKET: 'visa-documents' }))
vi.mock('@/lib/visa/crypto', () => ({
  visaCryptoReady: () => h.state.cryptoReady,
  decryptVisaPayload: () => {
    h.state.decrypts += 1
    return { email: 'applicant@example.com', givenNames: 'JOHN', surname: 'SMITH' }
  },
}))
vi.mock('@/lib/visa/records', () => ({
  recordVisaEvent: async (id: string, actorType: string, event: string, actorRef?: string, metadata?: unknown) => {
    h.state.events.push({ id, actorType, event, actorRef, metadata })
  },
}))
vi.mock('@/lib/visa/storage', () => ({
  removeVisaFiles: async (paths: string[]) => { h.state.removed.push(...paths); return true },
}))
vi.mock('@/lib/db', () => ({
  db: {
    conversation: { findUnique: async () => h.state.conversation },
    profile: { findUnique: async () => ({ locale: 'en' }) },
  },
}))
vi.mock('@/lib/messages', () => ({
  insertMessage: async (convo: { id: string }, senderId: string, _body: string, opts?: { kind?: string; meta?: unknown; preview?: string }) => {
    h.state.cards.push({ senderId, kind: opts?.kind, meta: opts?.meta, preview: opts?.preview })
    return { id: 'message-1', mine: true, body: '', createdAt: '', kind: opts?.kind ?? 'text', offerAmount: null, offerStatus: null, meta: null }
  },
}))
vi.mock('@/lib/visa-shop', () => ({ getVisaShopSeller: async () => h.state.shop }))
vi.mock('@/lib/mail', () => ({
  sendMail: async (msg: Record<string, unknown>) => { h.state.mails.push(msg); return h.state.mailOk },
}))
vi.mock('@/lib/emails/visa-result', () => ({
  renderVisaResultEmail: (input: unknown) => ({ subject: `subject ${JSON.stringify(input)}`, html: '<p>ok</p>', text: 'ok' }),
}))

// A tiny chainable stand-in for the PostgREST builder — only the calls these two routes and
// src/lib/visa/result.ts actually make.
vi.mock('@/lib/visa/db', () => {
  const table = (name: string) => {
    const api = {
      select: () => api,
      eq: () => api,
      order: () => api,
      // `.limit(1)` terminates the visa_documents read
      limit: async () => {
        h.state.docLookups += 1
        if (h.state.docLookupError) return { data: null, error: h.state.docLookupError }
        return { data: h.state.resultDocs, error: null }
      },
      // `.maybeSingle()` terminates the visa_applications read
      maybeSingle: async () => {
        h.state.caseLoads += 1
        if (h.state.loadError) return { data: null, error: h.state.loadError }
        return { data: h.state.application, error: null }
      },
      insert: async (row: Record<string, unknown>) => {
        if (h.state.insertError) return { error: h.state.insertError }
        h.state.inserts.push({ table: name, ...row })
        return { error: null }
      },
      // The ROLLBACK path (undoVisaResultUpload). Recorded rather than stubbed so a test can
      // assert the row really went — an un-undone upload spends the one-shot cap forever.
      delete: () => {
        const del = {
          eq: (_column: string, value: unknown) => {
            h.state.deletes.push({ table: name, id: String(value) })
            return del
          },
          then: (resolve: (v: unknown) => unknown) => resolve({ error: h.state.deleteError ?? null }),
        }
        return del
      },
    }
    return api
  }
  return {
    getVisaDb: () => ({
      from: (name: string) => table(name),
      storage: {
        from: () => ({
          upload: async (path: string, bytes: Uint8Array) => {
            h.state.uploads.push({ path, size: bytes.length })
            return { error: null }
          },
          download: async (path: string) => {
            h.state.storageDownloads.push(path)
            if (h.state.downloadFails) return { data: null, error: { message: 'gone' } }
            return { data: new Blob([h.state.storedBytes]), error: null }
          },
        }),
      },
    }),
  }
})

const { POST } = await import('@/app/api/visa/admin/applications/[id]/result/route')
const { GET } = await import('@/app/api/visa/applications/[id]/result/route')
const { checkVisaResultPdf, visaResultFilename, VISA_RESULT_MAX_BYTES } = await import('./result')

const params = (id = APP_ID) => ({ params: Promise.resolve({ id }) })

function uploadRequest(bytes: Buffer, type = 'application/pdf'): Request {
  const form = new FormData()
  form.append('file', new File([new Uint8Array(bytes)], 'anything.pdf', { type }))
  return new Request('https://eno.vn/api/visa/admin/applications/x/result', { method: 'POST', body: form })
}

beforeEach(() => {
  const s = h.state
  s.admin = 'desk@eno.vn'
  s.profileId = null
  s.rateLimitOk = true
  s.cryptoReady = true
  s.mailOk = true
  s.application = {
    id: APP_ID, user_id: 'applicant-1', status: 'processing', reference: 'EV-1042', encrypted_payload: 'envelope',
  }
  s.loadError = null
  s.resultDocs = []
  s.docLookupError = null
  s.insertError = null
  s.storedBytes = Buffer.from('%PDF-1.7\nstored\n%%EOF\n', 'latin1')
  s.downloadFails = false
  s.shop = { id: 'shop-1', ownerId: 'shop-owner-1' }
  s.conversation = {
    id: 'convo-1', buyerProfileId: 'applicant-1', sellerProfileId: 'shop-owner-1',
    listingId: 'listing-1', visaApplicationId: APP_ID,
  }
  s.caseLoads = 0
  s.docLookups = 0
  s.uploads = []
  s.inserts = []
  s.removed = []
  s.storageDownloads = []
  s.decrypts = 0
  s.events = []
  s.cards = []
  s.mails = []
})

/** Nothing about this case was read, stored, recorded, announced or mailed. */
function expectUntouched() {
  expect(h.state.caseLoads).toBe(0)
  expect(h.state.docLookups).toBe(0)
  expect(h.state.uploads).toEqual([])
  expect(h.state.inserts).toEqual([])
  expect(h.state.storageDownloads).toEqual([])
  expect(h.state.decrypts).toBe(0)
  expect(h.state.events).toEqual([])
  expect(h.state.cards).toEqual([])
  expect(h.state.mails).toEqual([])
}

// ── 1. THE ADMIN GATE ─────────────────────────────────────────────────────────────

describe('upload route — the admin gate', () => {
  it('refuses a non-admin and reads NOTHING', async () => {
    h.state.admin = null
    const res = await POST(uploadRequest(pdf()), params())
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'forbidden' })
    // ⚠️ The load-bearing half: a refusal that still touched the case would leak through
    // logs, audit rows and storage even though the caller got a 403.
    expectUntouched()
  })

  it('refuses a signed-in applicant who is not an admin', async () => {
    h.state.admin = null
    h.state.profileId = 'applicant-1'
    const res = await POST(uploadRequest(pdf()), params())
    expect(res.status).toBe(403)
    expectUntouched()
  })

  it('puts no-store on the refusal, not just on the success', async () => {
    h.state.admin = null
    const res = await POST(uploadRequest(pdf()), params())
    expect(res.headers.get('cache-control')).toContain('no-store')
  })
})

// ── 2. THE PDF IS ACTUALLY A PDF ──────────────────────────────────────────────────

describe('checkVisaResultPdf', () => {
  it('accepts a well-formed PDF', () => {
    expect(checkVisaResultPdf(pdf())).toBeNull()
  })
  it('rejects an empty file', () => {
    expect(checkVisaResultPdf(new Uint8Array())).toBe('result_pdf_empty')
  })
  it('rejects something that is not a PDF however it is labelled', () => {
    // A PNG, a ZIP and a JPEG all have their own magic and none of them is %PDF-.
    expect(checkVisaResultPdf(Buffer.from('\x89PNG\r\n\x1a\n', 'latin1'))).toBe('result_pdf_not_a_pdf')
    expect(checkVisaResultPdf(Buffer.from('PK\x03\x04rest-of-a-zip', 'latin1'))).toBe('result_pdf_not_a_pdf')
    expect(checkVisaResultPdf(Buffer.from('<html>not a visa</html>', 'latin1'))).toBe('result_pdf_not_a_pdf')
  })
  it('rejects a truncated PDF — the header alone is not enough', () => {
    expect(checkVisaResultPdf(Buffer.from('%PDF-1.7\nhalf an upload', 'latin1'))).toBe('result_pdf_truncated')
  })
  it('finds the trailer through trailing padding', () => {
    expect(checkVisaResultPdf(Buffer.concat([pdf(), Buffer.alloc(200, 0x0a)]))).toBeNull()
  })
  it('rejects a file past the ceiling the database also enforces', () => {
    const big = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(VISA_RESULT_MAX_BYTES), Buffer.from('%%EOF')])
    expect(checkVisaResultPdf(big)).toBe('result_pdf_too_large')
  })
})

describe('upload route — validation', () => {
  it('refuses a non-PDF and stores nothing', async () => {
    const res = await POST(uploadRequest(Buffer.from('\x89PNG\r\n\x1a\nnot a visa', 'latin1')), params())
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'result_pdf_not_a_pdf' })
    // ⚠️ The file is refused on its BYTES: the request declared application/pdf.
    expect(h.state.uploads).toEqual([])
    expect(h.state.inserts).toEqual([])
    expect(h.state.mails).toEqual([])
    expect(h.state.cards).toEqual([])
  })

  it('refuses a truncated PDF and stores nothing', async () => {
    const res = await POST(uploadRequest(Buffer.from('%PDF-1.7\ncut off mid-upload', 'latin1')), params())
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'result_pdf_truncated' })
    expect(h.state.uploads).toEqual([])
  })

  it('refuses a request with no file at all', async () => {
    const res = await POST(new Request('https://eno.vn/x', { method: 'POST', body: new FormData() }), params())
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'pdf_required' })
    expect(h.state.uploads).toEqual([])
  })
})

// ── 3. ONE RESULT PER CASE, EVER ──────────────────────────────────────────────────

describe('upload route — the hard cap', () => {
  it('refuses a second upload BEFORE anything is stored', async () => {
    h.state.resultDocs = [{ id: DOC_ID, storage_path: 'applicant-1/case/result-1.pdf', created_at: '2026-07-22T00:00:00Z' }]
    const res = await POST(uploadRequest(pdf()), params())
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'result_already_uploaded' })
    // Nothing stored, nothing recorded, and — the point of the cap — no second email.
    expect(h.state.uploads).toEqual([])
    expect(h.state.inserts).toEqual([])
    expect(h.state.cards).toEqual([])
    expect(h.state.mails).toEqual([])
  })

  it('refuses the loser of a race and removes the object it had already uploaded', async () => {
    // Both requests passed the pre-check; Postgres decides. 23505 = unique_violation on
    // visa_documents_one_result_key (scripts/visa-result-unique.mjs).
    h.state.insertError = { code: '23505' }
    const res = await POST(uploadRequest(pdf()), params())
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'result_already_uploaded' })
    expect(h.state.uploads).toHaveLength(1)
    // ⚠️ No orphan left behind in the private bucket.
    expect(h.state.removed).toEqual([h.state.uploads[0].path])
    expect(h.state.cards).toEqual([])
    expect(h.state.mails).toEqual([])
  })

  it('fails CLOSED when the existing-result lookup errors — "I could not tell" is not "there is none"', async () => {
    h.state.docLookupError = { code: '08006' }
    const res = await POST(uploadRequest(pdf()), params())
    expect(res.status).toBe(503)
    expect(h.state.uploads).toEqual([])
  })

  it('refuses a case whose state makes a result meaningless', async () => {
    h.state.application = { ...(h.state.application as object), status: 'draft' }
    const res = await POST(uploadRequest(pdf()), params())
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'application_not_ready_for_result' })
    expect(h.state.uploads).toEqual([])
  })
})

// ── 4. THE HAPPY PATH: stored, announced, mailed — once ───────────────────────────

describe('upload route — delivery', () => {
  it('stores the PDF privately, posts the card as the SHOP, and emails it exactly once', async () => {
    const res = await POST(uploadRequest(pdf('the visa')), params())
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body).toMatchObject({ document: { kind: 'result' }, card: 'posted', email: 'sent', audited: true })
    expect(res.headers.get('cache-control')).toContain('no-store')

    // Stored under the interop path shape, in the private bucket.
    expect(h.state.uploads).toHaveLength(1)
    expect(h.state.uploads[0].path).toMatch(/^applicant-1\/3f2a91bc-1111-4222-8333-444455556666\/result-[0-9a-f-]+\.pdf$/)

    // One row, kind 'result'.
    expect(h.state.inserts).toHaveLength(1)
    expect(h.state.inserts[0]).toMatchObject({ table: 'visa_documents', kind: 'result', application_id: APP_ID })

    // ⚠️ The card is authored as the SHOP, never as the acting admin, and carries no
    // applicant value — two ids and a case number.
    expect(h.state.cards).toHaveLength(1)
    expect(h.state.cards[0].senderId).toBe('shop-owner-1')
    expect(h.state.cards[0].kind).toBe('visa_result')
    expect(h.state.cards[0].meta).toEqual({
      v: 1, applicationId: APP_ID, documentId: body.document.id, reference: 'EV-1042',
    })
    expect(JSON.stringify(h.state.cards[0])).not.toContain('applicant@example.com')
    expect(JSON.stringify(h.state.cards[0])).not.toContain('JOHN')

    // Exactly one email, with the PDF attached and a filename built from the reference.
    expect(h.state.mails).toHaveLength(1)
    expect(h.state.mails[0].to).toBe('applicant@example.com')
    const attachments = h.state.mails[0].attachments as Array<{ filename: string; content: string; contentType: string }>
    expect(attachments).toHaveLength(1)
    expect(attachments[0].filename).toBe('EV-1042-evisa.pdf')
    expect(attachments[0].contentType).toBe('application/pdf')
    // Base64 TEXT, not a serialized Buffer (src/lib/mail.ts documents why).
    expect(typeof attachments[0].content).toBe('string')
    expect(Buffer.from(attachments[0].content, 'base64').toString('latin1')).toContain('the visa')

    // Audited, with counts and a hash — no applicant value, no storage path.
    const audit = h.state.events.find((e) => e.event === 'result_uploaded')
    expect(audit).toBeTruthy()
    expect(audit?.actorRef).toBe('desk@eno.vn')
    expect(JSON.stringify(audit?.metadata)).not.toContain('applicant-1/')
  })

  it('UNDOES the upload when the card cannot be posted, so the cap is not spent', async () => {
    // ⚠️ This test previously asserted 201 — it codified the dead end as success. Two external
    // reviewers (GPT-5.6 and Gemini 3.1, 2026-07-23) found it independently: the cap is one
    // upload per case and the card is the applicant's ONLY route to the file, so committing
    // the row while the card fails leaves a paid-for visa in a private bucket its owner cannot
    // open, with the desk's single attempt already spent. Delivery failure must un-spend it.
    h.state.conversation = null
    const res = await POST(uploadRequest(pdf()), params())

    expect(res.status).toBe(503)
    expect(await res.json()).toMatchObject({ error: 'result_not_delivered' })
    // The row is gone, so the desk can simply upload again…
    expect(h.state.deletes.some((d) => d.table === 'visa_documents')).toBe(true)
    // …and the object does not linger in the bucket.
    expect(h.state.removed.length).toBe(1)
  })

  it('still answers 201 when only the EMAIL failed — the card is the route that matters', async () => {
    // The email is genuinely best-effort: the applicant can already reach the PDF from the
    // card in their thread, so a mail outage must not un-spend a delivered result.
    h.state.mailOk = false
    const res = await POST(uploadRequest(pdf()), params())
    expect(res.status).toBe(201)
    expect(await res.json()).toMatchObject({ card: 'posted', email: 'failed' })
    expect(h.state.inserts).toHaveLength(1)
  })

  it('does not change the case status — approval stays a separate, gated transition', async () => {
    await POST(uploadRequest(pdf()), params())
    expect(h.state.inserts.every((row) => row.table === 'visa_documents')).toBe(true)
  })
})

// ── 5. THE DOWNLOAD, AND WHO MAY DO IT ────────────────────────────────────────────

describe('download route — the ownership check', () => {
  it('refuses a signed-in stranger with 404 and reads NOTHING out of storage', async () => {
    h.state.admin = null
    h.state.profileId = 'someone-else'
    h.state.resultDocs = [{ id: DOC_ID, storage_path: 'applicant-1/case/result-1.pdf', created_at: '2026-07-22T00:00:00Z' }]
    const res = await GET(new Request('https://eno.vn/x'), params())
    expect(res.status).toBe(404)
    // 404, not 403: a 403 would confirm the case exists.
    expect(await res.json()).toEqual({ error: 'not_found' })
    // ⚠️ The load-bearing half. Delete the `application.user_id !== userId` comparison and
    // this line fails, because the stranger would have been handed the bytes.
    expect(h.state.storageDownloads).toEqual([])
    expect(res.headers.get('cache-control')).toContain('no-store')
  })

  it('refuses an anonymous caller', async () => {
    h.state.admin = null
    h.state.profileId = null
    const res = await GET(new Request('https://eno.vn/x'), params())
    expect(res.status).toBe(401)
    expect(h.state.caseLoads).toBe(0)
    expect(h.state.storageDownloads).toEqual([])
  })

  it('streams the PDF to the applicant, named after the case reference', async () => {
    h.state.admin = null
    h.state.profileId = 'applicant-1'
    h.state.resultDocs = [{ id: DOC_ID, storage_path: 'applicant-1/case/result-1.pdf', created_at: '2026-07-22T00:00:00Z' }]
    const res = await GET(new Request('https://eno.vn/x'), params())
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/pdf')
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="EV-1042-evisa.pdf"')
    expect(res.headers.get('cache-control')).toContain('no-store')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(Buffer.from(await res.arrayBuffer()).toString('latin1')).toContain('stored')
    // The bytes came through the handler; no signed or public URL was minted.
    expect(h.state.storageDownloads).toEqual(['applicant-1/case/result-1.pdf'])
  })

  it('is NOT a one-shot link — the same card downloads again and again', async () => {
    h.state.admin = null
    h.state.profileId = 'applicant-1'
    h.state.resultDocs = [{ id: DOC_ID, storage_path: 'applicant-1/case/result-1.pdf', created_at: '2026-07-22T00:00:00Z' }]
    for (let i = 0; i < 3; i++) expect((await GET(new Request('https://eno.vn/x'), params())).status).toBe(200)
    expect(h.state.storageDownloads).toHaveLength(3)
  })

  it('lets the desk read the exact bytes the applicant received', async () => {
    h.state.admin = 'desk@eno.vn'
    h.state.profileId = 'shop-owner-1'
    h.state.resultDocs = [{ id: DOC_ID, storage_path: 'applicant-1/case/result-1.pdf', created_at: '2026-07-22T00:00:00Z' }]
    const res = await GET(new Request('https://eno.vn/x'), params())
    expect(res.status).toBe(200)
    expect(h.state.events.some((e) => e.event === 'result_downloaded' && e.actorType === 'admin')).toBe(true)
  })

  it('answers result_not_ready before the desk has uploaded anything', async () => {
    h.state.admin = null
    h.state.profileId = 'applicant-1'
    const res = await GET(new Request('https://eno.vn/x'), params())
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'result_not_ready' })
  })

  it('refuses a non-uuid case id without touching the database', async () => {
    h.state.admin = null
    h.state.profileId = 'applicant-1'
    const res = await GET(new Request('https://eno.vn/x'), params('../../etc/passwd'))
    expect(res.status).toBe(404)
    expect(h.state.caseLoads).toBe(0)
  })
})

// ── 6. Filenames carry a case number and nothing else ─────────────────────────────

describe('visaResultFilename', () => {
  it('names the file after the case reference', () => {
    expect(visaResultFilename('EV-1042')).toBe('EV-1042-evisa.pdf')
  })
  it('falls back to a constant rather than leaking a case id', () => {
    expect(visaResultFilename(null)).toBe('eno-evisa.pdf')
    expect(visaResultFilename('')).toBe('eno-evisa.pdf')
    expect(visaResultFilename('3f2a91bc-1111-4222-8333-444455556666')).toBe('eno-evisa.pdf')
  })
  it('cannot emit a character that would break a Content-Disposition header', () => {
    // Whatever the column holds, only a parsed reference is ever re-emitted.
    for (const hostile of ['EV-1042"; filename="passport.pdf', 'EV-1042\r\nX-Evil: 1', '../../etc/passwd', 'EV-1042/../x']) {
      expect(visaResultFilename(hostile)).toBe('eno-evisa.pdf')
    }
    expect(visaResultFilename('ev 1042')).toBe('EV-1042-evisa.pdf')
  })
})
