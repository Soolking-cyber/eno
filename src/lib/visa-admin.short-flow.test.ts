import { describe, expect, it, vi } from 'vitest'

// ── A short-flow case can be closed (2026-10-06) ─────────────────────────────────────────────────────────────────
// eno.forum's quick flow and eno.vn's photos-only flow never pass approve_for_prefill (it needs the full form), so under
// the literal map a short-flow case could never reach `processing` → the result upload could never close it →
// retention_until was never written and the passport + portrait were kept forever. The literal map stays pinned to the
// forum copy (visa-transition-drift.test.ts); these widen it for short-flow cases only.
vi.mock('@/lib/supabase-admin', () => ({ getSupabaseAdmin: () => null }))
vi.mock('@/lib/db', () => ({ db: {} }))

const { VISA_ADMIN_TRANSITIONS, visaAdminTransitionsFor } = await import('./visa-admin')
const { visaAdminActionsFor, VISA_ADMIN_ACTIONS } = await import('@/app/[lang]/admin/visas/visa-status')
const { VISA_PHOTOS_DECLARATION_VERSION, VISA_QUICK_DECLARATION_VERSION } = await import('./visa/dm-steps')

const FULL = 'evisa-applicant-declaration-2026-07-24'
const SHORT = [VISA_PHOTOS_DECLARATION_VERSION, VISA_QUICK_DECLARATION_VERSION]

describe('short-flow transitions', () => {
  it.each(SHORT)('%s: from review the desk may mark it filed, and the result upload may close it', (version) => {
    for (const status of ['ready_for_review', 'under_review']) {
      const allowed = visaAdminTransitionsFor({ status, applicant_confirmation_version: version })
      expect(allowed).toEqual(expect.arrayContaining(['processing', 'approved', 'cancelled']))
    }
  })

  it('a full-form case keeps exactly the literal map', () => {
    for (const status of Object.keys(VISA_ADMIN_TRANSITIONS)) {
      expect(visaAdminTransitionsFor({ status, applicant_confirmation_version: FULL })).toEqual(VISA_ADMIN_TRANSITIONS[status])
      expect(visaAdminTransitionsFor({ status, applicant_confirmation_version: null })).toEqual(VISA_ADMIN_TRANSITIONS[status])
    }
  })

  it.each(SHORT)('%s: every button the case page offers is a legal transition, and "applicant approval" is not offered', (version) => {
    for (const status of Object.keys(VISA_ADMIN_ACTIONS)) {
      const app = { status, applicant_confirmation_version: version }
      const allowed = visaAdminTransitionsFor(app)
      for (const [next] of visaAdminActionsFor(app)) expect(allowed).toContain(next)
      if (status === 'ready_for_review' || status === 'under_review') {
        expect(visaAdminActionsFor(app).map(([next]) => next)).not.toContain('applicant_approval')
        expect(visaAdminActionsFor(app).map(([next]) => next)).toEqual(expect.arrayContaining(['processing', 'cancelled']))
      }
    }
  })
})
