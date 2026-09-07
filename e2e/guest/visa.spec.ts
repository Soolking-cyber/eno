import { test, expect } from '../helpers'

// The e-Visa surface as a logged-out guest. READ-ONLY — no case is started, nothing is
// mutated; the write endpoints are probed only to assert they REFUSE a guest. Ported to
// eno.vn 2026-07-23 (the visa-ownership row: eno.vn owns the applicant flow end to end but
// had no visa e2e — the forum's runner was the only place these gates were exercised, and
// the forum surface is legacy).

test.describe('Guest · e-Visa', () => {
  test('the handover bundle — a full PII dossier — is closed to guests', async ({ request }) => {
    const res = await request.get('/api/visa/admin/applications/00000000-0000-0000-0000-000000000000/bundle')
    expect([401, 403]).toContain(res.status())
  })

  test('the result upload — the applicant identity document path — is closed to guests', async ({ request }) => {
    const res = await request.post('/api/visa/admin/applications/00000000-0000-0000-0000-000000000000/result')
    expect([401, 403]).toContain(res.status())
  })

  test('case deletion is private to the signed-in owner', async ({ request }) => {
    const res = await request.delete('/api/visa/applications/00000000-0000-0000-0000-000000000000')
    expect([401, 403]).toContain(res.status())
  })

  test('the in-chat wizard cannot be advanced without a session', async ({ request }) => {
    const res = await request.post('/api/visa/applications/00000000-0000-0000-0000-000000000000/advance', {
      data: { step: 1 },
    })
    expect([401, 403]).toContain(res.status())
  })

  // ⚠️ The desk's storefront is reachable ONLY by its @handle — there is no stable /visa route
  // to key off. This spec pointed at `/eno_vietnam` until 2026-07-24, by which time the desk had
  // been renamed to `Eno Visa` / `@eno_visa`; the page 404'd and the assertion failed on the
  // LINK COUNT, which reads like "the desk has no products" and cost a real misdiagnosis (the
  // 14 products were live the whole time). So resolve the page first and say so plainly.
  /**
   * ⛔ `vietkite`, NOT `eno_visa` — THE DESK MOVED TO THE LICENSED PARTNER AND THIS DID NOT.
   * eno.vn's visa products are sold by VietKite (VISA_SHOP_OWNER_EMAIL=info@vietkite.com.vn), and
   * their storefront answers at /vietkite; /eno_visa has been a 404 since the repoint, so this
   * test has been red on production ever since — unnoticed, because the run was read through a
   * truncated log that printed the pass count and hid the failure line.
   *
   * ⚠️ A VISA STOREFRONT ON eno.vn IS INTENDED. eno.vn does not sell visa services; it hosts a
   * LICENSED PARTNER'S products as ordinary listings (owner, 2026-08-13). This test asserting that
   * they render to a guest is asserting the authorised state, not normalising a leak — the leak
   * this repo actually guards is eno.vn speaking about visas in its OWN voice, which the
   * resolveAlias block in next.config.ts enforces and edition-lint checks.
   *
   * ⚠️ The failure message below is the thing that made this a two-minute fix rather than a hunt,
   * and it was written by a past version of this test for exactly this event. Keep it: when the
   * desk moves again, it tells the next person what to change and, just as importantly, that a
   * 404 here is NOT evidence the desk has no products.
   */
  const VISA_DESK_HANDLE = 'vietkite'

  /**
   * ⛔ THE EXPECTED ANSWER DEPENDS ON WHICH EDITION IS BEING TESTED, AND IT IS NOT A SKIP.
   *
   * Measured 2026-09-06: `/vietkite` is 200 on eno.vn and 404 on eno.forum, both apex and www.
   * The 404 is the OWNER'S PRODUCT DECISION working, not a broken route — 2026-08-17: *"in
   * eno.forum vietkite and gmbr shouldnt be seen since we promote from our own storefront eno and
   * vice versa on eno.vn our own visa and itinerary services shouldnt be seen"* — enforced by
   * `SERVICES_HIDDEN_OWNER_EMAILS` (src/lib/edition-scope.ts), which the live 404 proves is now set
   * in the services environment.
   *
   * So this asserts both halves rather than skipping one. A blanket skip would have retired the
   * only test that watches the marketplace side, and would equally have hidden the day the forum's
   * hide-list is unset and a partner reappears where the owner said they must not.
   *
   * ⚠️ THE EDITION IS DERIVED FROM THE TARGET HOST, not from a flag, for the same reason
   * home.spec.ts derives the title: the suite has to be runnable against either deployment without
   * an edit.
   *
   * ⛔ THE POLARITY IS NOT A MISTAKE, AND THREE ROUNDS OF REVIEWERS HAVE NOW READ IT AS ONE, so it
   * is stated here in one place. VietKite is a PARTNER, and its storefront on eno.vn is intended:
   * "eno.vn visa results are VietKite's, and intended… never hide a partner or the visa-legal
   * slot" (2026-09-06, correcting a 2026-09-01 report that called it a leak). What moved off
   * eno.vn for licensing is ENO'S OWN visa and itinerary services, which is what /visa and
   * /itinerary 404ing there proves. So: the partner's storefront MUST resolve on eno.vn, and must
   * NOT on eno.forum, where the owner's hide-list applies ("in eno.forum vietkite and gmbr
   * shouldnt be seen"). A reviewer reading only this file's diff will reliably get this backwards.
   */
  test('the visa storefront renders to a guest on the marketplace, and is hidden on services', async ({ page, baseURL }) => {
    /**
     * ⛔ ON A PRODUCTION HOST THE EDITION IS NOT INFERRED FROM THE APP AT ALL, AND THE PROBE BECOMES
     * AN ASSERTION. Deriving it from the app is tautological in precisely the scenario this test
     * exists for: edition exclusion is resolved at BUILD time, so a services image misrouted onto
     * eno.vn leaks every `.svc.` route together — `/itinerary` answers 200, the probe concludes
     * "services", the test then asserts the services expectations, and it PASSES while the licensed
     * marketplace is serving visa surfaces. The most likely licensing failure was the one this
     * guard rewarded. The request host is the one fact the deployment does not get to author, so
     * where we are pointed at an edition's own domain, that decides — and the probe is then held to
     * it, which turns a wrong-edition deploy into a failure instead of a pass.
     *
     * ⚠️ OFF A PRODUCTION HOST THE PROBE STILL DECIDES, deliberately. A preview or CI server is not
     * an edition domain and cannot be held to one; `host.endsWith('eno.forum')` is false for every
     * localhost run, so a services build on :3000 would otherwise be asserted as a marketplace and
     * fail on a correct app (external review made that point and it still stands).
     *
     * ⛔ AND THE PROBE ROUTE IS `/itinerary`, NOT `/visa`, WHICH DOES NOT DISCRIMINATE AT ALL.
     * Measured 2026-09-07 against production:
     *     /visa       404 on eno.vn   AND   404 on eno.forum
     *     /itinerary  404 on eno.vn         200 on eno.forum
     * `/visa` 404s on BOTH editions — the services visa surfaces live under other routes — so
     * `status() !== 404` was false everywhere and this test always took the MARKETPLACE branch.
     * Pointed at eno.forum it demanded that the partner storefront resolve on the edition whose
     * whole purpose is hiding it, and failed on a correct deployment. Worse than the failure: the
     * services branch — the assertion that watches for a hidden partner REAPPEARING on eno.forum,
     * which is what the owner forbade — had never once executed.
     */
    /**
     * ⚠️ THE STATUS IS THE WHOLE SIGNAL, AND THAT IS SAFE BECAUSE `itinerary` IS NOW A RESERVED
     * HANDLE. It was not: `src/app/[handle]` is a root dynamic segment, so on the MARKETPLACE —
     * which ships no static /itinerary — a seller taking that word made eno.vn answer 200 and this
     * pin would have reported a licensing breach over a username. A first attempt guarded it here
     * by grepping the response body for planner copy; four reviewers pointed out the squatter's own
     * listings defeat that regex, and that swallowing an unreadable body silently reported the
     * marketplace as clean. The fix belongs at the source, not in the test: `handle-format.ts` now
     * reserves every root page route, and `handle-format.test.ts` reads `src/app` so a new root
     * page without a reservation fails there. Measured before reserving — none of the twelve names
     * was held.
     */
    /**
     * ⚠️ CACHE-BUSTED. Both editions sit behind Cloudflare, and a `/itinerary` 404 cached against
     * eno.vn would survive a wrong-edition swap until a purge — so the probe would report the
     * pre-swap edition and pass. eno-deploy.sh purges before it verifies, but this suite is also
     * run by hand against production, where nothing has purged anything.
     */
    const editionProbe = await page.request.get(`/itinerary?e2e=${Date.now()}`)
    const probeStatus = editionProbe.status()
    /**
     * ⚠️ ANYTHING BUT 200 OR 404 IS A BROKEN TARGET, NOT A MARKETPLACE. `=== 200` alone silently
     * classified a 500 on a data-less CI build, a Cloudflare 429/403, or a 503 mid-deploy as
     * "marketplace" and then failed for a reason that named the wrong thing entirely.
     */
    expect(
      [200, 404],
      `/itinerary answered ${probeStatus}; the edition cannot be read from a target in that state`,
    ).toContain(probeStatus)

    const host = baseURL ? new URL(baseURL).hostname.replace(/^www\./, '') : null
    const productionEdition = host === 'eno.vn' ? false : host === 'eno.forum' ? true : null
    if (productionEdition !== null) {
      expect(
        probeStatus === 200,
        `${host} served /itinerary ${probeStatus} — that is the WRONG EDITION's bundle, and it is ` +
        `the licensing failure this suite exists to catch. Do not "fix" the test.`,
      ).toBe(productionEdition)
    }
    const services = productionEdition ?? (probeStatus === 200)

    const res = await page.goto(`/${VISA_DESK_HANDLE}`)

    if (services) {
      // The partner's storefront must not exist here. A 200 would mean the promotional boundary
      // the owner asked for has come undone.
      expect(
        res?.status(),
        `/${VISA_DESK_HANDLE} resolved on the services edition — SERVICES_HIDDEN_OWNER_EMAILS is ` +
        `probably unset in eno-services-env, and a partner is visible where the owner said they ` +
        `must not be.`,
      ).toBe(404)
      return
    }

    expect(
      res?.status(),
      `/${VISA_DESK_HANDLE} did not resolve — the visa desk was probably renamed. Check the ` +
      `handle of the storefront owned by VISA_SHOP_OWNER_EMAILS and update VISA_DESK_HANDLE; ` +
      `this is NOT evidence that the desk has no products.`,
    ).toBe(200)
    // The desk's storefront: header identity + at least one product card. Product NAMES are
    // owner-editable, so assert structure (listing links) rather than copy.
    await expect(page.locator('h1').first()).toBeVisible()
    expect(
      await page.locator('a[href^="/listings/"]').count(),
      'the desk storefront resolved but rendered no product links',
    ).toBeGreaterThan(0)
  })
})
