import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { VISA_MIN_DIMENSIONS, normalizeVisaImage } from './image-normalization'
import { evaluatePassportImageQuality } from './image-quality'
import { parsePassportMrz } from './mrz'
import { emptyVisaPayload, validateVisaForReview, validateVisaStep, visaDateDefaultsForStart, visaEndDateFor90DayWindow, visaPayloadSchema } from './schema'
import { DEFAULT_EVISA_ENTRY_GATE, EVISA_CHECKPOINTS } from './checkpoints'
import { withAiRetry } from '@/lib/ai-retry'

// PORTED from apps/forum/e2e/visa.spec.ts (2026-07-23, visa-ownership row): eno.vn owns the
// applicant engine end to end, so eno.vn's OWN suite must hold the engine's invariants —
// they used to live only in the forum's runner, meaning a root-side regression in these
// sync-paired libs (see src/lib/sync-pairs.test.ts) could ship with every root gate green.
// The forum's admin-prefill workflow assertions were NOT ported: workflow.ts is a
// forum-only capability (Browserbase hosted prefill) with no root twin.

describe('visa applicant engine (ported forum invariants)', () => {
  it('normalizes portrait and passport uploads to official technical limits', async () => {
    const portraitInput = await sharp({ create: { width: 1200, height: 1600, channels: 4, background: '#d8e8f8' } }).png().toBuffer()
    const portrait = await normalizeVisaImage(portraitInput, 'portrait')
    const portraitMetadata = await sharp(portrait.output).metadata()
    expect(portraitMetadata.format).toBe('jpeg')
    expect([portraitMetadata.width, portraitMetadata.height]).toEqual([800, 1200])
    expect(portrait.output.length).toBeLessThan(1_900_000)
    expect(portrait.report.corrections).toContain('formatted_to_4x6_portrait')

    const passportInput = await sharp({ create: { width: 3200, height: 2000, channels: 3, background: '#f6f0df' } }).png().toBuffer()
    const passport = await normalizeVisaImage(passportInput, 'passport')
    const passportMetadata = await sharp(passport.output).metadata()
    expect(passportMetadata.format).toBe('jpeg')
    expect(passportMetadata.width).toBe(2400)
    expect(passportMetadata.height).toBe(1500)
    expect(passport.output.length).toBeLessThan(1_900_000)

    // ⚠️ 320×480 IS NOW ACCEPTED, AND THAT IS THE CHANGE — NOT A WEAKENED TEST. The upload floor
    // dropped to 240×320 on 2026-08-19 (owner: "as long as its readable passport photo accept it"),
    // so this size, which used to be the canonical rejection, is exactly the case that must now get
    // through. Asserting it PASSES is what stops the old floor being restored by accident.
    const smallButUsable = await sharp({ create: { width: 320, height: 480, channels: 3, background: '#fff' } }).jpeg().toBuffer()
    const upscaled = await normalizeVisaImage(smallButUsable, 'portrait')
    expect([(await sharp(upscaled.output).metadata()).width, (await sharp(upscaled.output).metadata()).height]).toEqual([800, 1200])

    // Below the floor still refuses, with the code the applicant's copy is keyed to. A thumbnail is
    // the one thing a dimension check can honestly identify, and it is all it is asked to do now.
    const thumbnail = await sharp({ create: { width: 160, height: 220, channels: 3, background: '#fff' } }).jpeg().toBuffer()
    await expect(normalizeVisaImage(thumbnail, 'portrait')).rejects.toThrow('portrait_resolution_too_low')
  })

  /**
   * ⚠️ THIS TEST EXISTS BECAUSE NOTHING EXERCISED THE DOWNSCALE PATH, AND A REAL BUG LIVED THERE.
   * Both external reviewers found that `fit: 'inside'` bounds the LONG edge only, so bounding by a
   * square floor let an 800×1200 portrait land at 213×320 — under its 240 short-edge floor — while
   * still reporting success. The assertion that matters is the SHORT edge, since that is the one
   * the square box does not constrain.
   */
  it('downscales an incompressible passport under the official limit without breaching the floor', async () => {
    /**
     * ⚠️ IT MUST BE A PASSPORT, AND THE PIXELS MUST BE INCOMPRESSIBLE — MY FIRST VERSION OF THIS
     * TEST WAS VACUOUS AND I ONLY FOUND OUT BY MEASURING IT.
     *
     * I wrote it against a portrait with a patterned "noise" buffer, it passed, and it proved
     * nothing: portraits are resized to a fixed 800×1200, which came out at 89 KB — so the
     * downscale branch never executed and the assertions below were checking the ordinary path.
     * A passport is bounded at 2400 px instead, ~4.4M pixels, and only data JPEG cannot model
     * survives the quality ladder to reach the loop. That is why the correction marker is asserted
     * FIRST: it is the only thing that proves the expensive fixture did its job, and without it
     * this test silently degrades into a second copy of the one above.
     *
     * ⚠️ SLOW ON PURPOSE (~30s local): several JPEG encodes at 4.4M pixels. That is the price of
     * covering a path that two external reviewers found broken and the rest of the suite could not
     * see. The timeout is 180s, not 90s, because a 2-vCPU GitHub Actions runner is routinely 2–3×
     * slower on mozjpeg 4:4:4 — a reviewer pointed out that 90s was close enough to make this the
     * suite's one flaky test, which is a bad trade for a gate that exists to pin a real bug.
     * Source is kept near 12 MB — well under the 25 MiB intake ceiling — so a future sharp version
     * nudging compression cannot turn this into a confusing `image_size_invalid`.
     */
    // ⚠️ SEEDED, NOT `randomBytes`. codex asked for a reproducible fixture and it is right: a gate
    // whose input differs every run can fail once in a way nobody can reproduce. xorshift32 gives
    // JPEG nothing to model — verified to still reach the downscale branch, which is the property
    // that actually matters and the one the assertion below pins.
    const width = 2600
    const height = 3400
    const pixels = Buffer.allocUnsafe(width * height * 3)
    let seed = 0x9e3779b9
    for (let i = 0; i < pixels.length; i++) {
      seed ^= seed << 13; seed >>>= 0
      seed ^= seed >>> 17
      seed ^= seed << 5; seed >>>= 0
      pixels[i] = seed & 0xff
    }
    const incompressible = await sharp(pixels, { raw: { width, height, channels: 3 } })
      .jpeg({ quality: 85, chromaSubsampling: '4:4:4' })
      .toBuffer()

    const result = await normalizeVisaImage(incompressible, 'passport')
    // The branch actually ran — without this the rest of the test can pass on the ordinary path.
    expect(result.report.corrections).toContain('downscaled_for_official_limit')
    expect(result.output.length).toBeLessThan(1_900_000)

    const meta = await sharp(result.output).metadata()
    const shortEdge = Math.min(meta.width || 0, meta.height || 0)
    const longEdge = Math.max(meta.width || 0, meta.height || 0)
    // The assertion that matters: `fit: 'inside'` bounds the LONG edge, so the short edge is the
    // one a square floor fails to protect. 213×320 from an 800×1200 input was the original bug.
    expect(shortEdge).toBeGreaterThanOrEqual(VISA_MIN_DIMENSIONS.passport.short)
    expect(longEdge).toBeGreaterThanOrEqual(VISA_MIN_DIMENSIONS.passport.long)
  }, 180_000)

  /**
   * ⚠️ THE TRIO IS ALL-OR-NOTHING, AND "CLEAR THE NAME" IS NOW A PROMISE IN THE UI.
   *
   * The owner reported the form "asking twice" and not recognising filled answers. Measured: it
   * recognises them fine — a name ALONE makes the other two required, and the rule was stated only
   * on the name field, which is the one the applicant had already left behind. The chat copy says
   * "fill all three, or clear all three to skip" — clearing only the name does NOT release an
   * applicant who already typed an address, and every partial state is pinned below so the copy and
   * the validator cannot drift apart again.
   */
  it('treats the Vietnam contact as all-or-nothing — only clearing all three skips it', () => {
    const local = (p: Partial<Record<string, string>>) =>
      validateVisaForReview({ ...emptyVisaPayload(), ...p } as never, []).filter((c) => c.startsWith('local_contact'))

    expect(local({})).toEqual([])
    expect(local({ localContactName: 'Tran Thi Mai' }))
      .toEqual(['local_contact_address_required', 'local_contact_phone_required'])
    expect(local({ localContactName: 'Tran Thi Mai', localContactAddress: '25 Bui Vien', localContactPhone: '+84901234567' })).toEqual([])

    /**
     * ⛔ THE PARTIAL STATES ARE THE WHOLE POINT, AND MY FIRST VERSION OF THIS TEST MISSED THEM.
     * It "proved" the escape by clearing all three at once — which is just the empty case again,
     * so the claim lived in the comment and not in the assertion. All three reviewer families
     * caught it, along with the copy it was defending: clearing ONLY the name does not release an
     * applicant who has already typed an address, it swaps two refusals for a different one.
     * Every partial combination is pinned here so the hint and the validator cannot drift apart.
     */
    expect(local({ localContactAddress: '25 Bui Vien' }))
      .toEqual(['local_contact_name_required', 'local_contact_phone_required'])
    expect(local({ localContactPhone: '+84901234567' }))
      .toEqual(['local_contact_name_required', 'local_contact_address_required'])
    expect(local({ localContactName: 'Tran Thi Mai', localContactAddress: '25 Bui Vien' }))
      .toEqual(['local_contact_phone_required'])
    expect(local({ localContactName: 'Tran Thi Mai', localContactPhone: '+84901234567' }))
      .toEqual(['local_contact_address_required'])
    // Clearing the NAME alone is NOT the way out — this is the case the old copy got wrong.
    expect(local({ localContactName: '', localContactAddress: '25 Bui Vien', localContactPhone: '+84901234567' }))
      .toEqual(['local_contact_name_required'])
    // Clearing ALL THREE is, which is what the hint now says.
    expect(local({ localContactName: '', localContactAddress: '', localContactPhone: '' })).toEqual([])
  })

  it('cross-checks standard passport MRZ check digits before autofill', () => {
    const result = parsePassportMrz(
      'P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<',
      'L898902C36UTO7408122F1204159ZE184226B<<<<<10',
    )
    expect(result.valid).toBe(true)
    expect(result.fields).toMatchObject({
      surname: 'ERIKSSON', givenNames: 'ANNA MARIA', passportNumber: 'L898902C3',
      dateOfBirth: '1974-08-12', sex: 'female', passportExpiryDate: '2012-04-15',
    })

    const corrupted = parsePassportMrz(
      'P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<',
      'L898902C35UTO7408122F1204159ZE184226B<<<<<10',
    )
    expect(corrupted.valid).toBe(false)
    expect(corrupted.checks.passportNumber).toBe(false)
  })

  it('keeps page-edge uncertainty advisory when the passport is readable', () => {
    const quality = evaluatePassportImageQuality({
      correctPassportBiodataPage: true,
      singleDataPage: true,
      clearImage: true,
      printedTextReadable: true,
      noSignificantGlare: true,
      fullPageVisible: false,
      allCornersVisible: false,
      mrzReadable: true,
    }, true)
    expect(quality.status).toBe('passed')
    expect(quality.issues).toEqual([])
    expect(quality.warnings).toEqual(['passport_page_cropped', 'passport_corners_missing'])

    const unreadable = evaluatePassportImageQuality({ correctPassportBiodataPage: true, singleDataPage: true, clearImage: false, printedTextReadable: false })
    expect(unreadable.status).toBe('failed')
    expect(unreadable.issues).toEqual(expect.arrayContaining(['passport_image_blurry', 'passport_text_unreadable']))
  })

  it('defaults an omitted or empty religion to None', () => {
    expect(emptyVisaPayload().religion).toBe('None')
    expect(visaPayloadSchema.parse({ religion: '' }).religion).toBe('None')
    expect(visaPayloadSchema.parse({ religion: 'Buddhist' }).religion).toBe('Buddhist')
  })

  it('uses conservative common-tourist defaults without guessing identity fields', () => {
    const payload = emptyVisaPayload('traveler@example.com')
    expect(payload).toMatchObject({
      religion: 'None', passportType: 'ordinary', usedOtherPassportsForVietnam: 'no', hasOtherNationalities: 'no', hasVietnamLawViolation: 'no',
      hasOtherPassports: 'no', entryType: 'single', purposeOfEntry: 'Tourism', currentlyOutsideVietnam: 'yes',
      stayLengthDays: 90, visitedVietnamLastYear: 'no', hasRelativesInVietnam: 'no', estimatedExpenses: 1000,
      expensesCurrency: 'USD', expensesPayer: 'self', paymentMethod: 'credit_card', hasTravelInsurance: 'no', hasChildrenOnPassport: 'no',
    })
    expect(payload).toMatchObject({ surname: '', givenNames: '', passportNumber: '', permanentAddress: '', occupation: '', entryGate: DEFAULT_EVISA_ENTRY_GATE, exitGate: DEFAULT_EVISA_ENTRY_GATE })
  })

  it('defaults to Tan Son Nhat and contains every approved e-visa checkpoint', () => {
    expect(emptyVisaPayload().entryGate).toBe('Tan Son Nhat Airport Border Gate')
    expect(emptyVisaPayload().exitGate).toBe('Tan Son Nhat Airport Border Gate')
    expect(EVISA_CHECKPOINTS).toHaveLength(81)
    expect(new Set(EVISA_CHECKPOINTS).size).toBe(81)
    expect(EVISA_CHECKPOINTS).toEqual(expect.arrayContaining([
      'Noi Bai Airport Border Gate',
      'Moc Bai International Border Gate, Tay Ninh Province',
      'Ho Chi Minh City Port Border Gate, Ho Chi Minh City',
    ]))
  })

  it('fills an inclusive 90-day e-visa window across month and year boundaries', () => {
    expect(visaEndDateFor90DayWindow('2026-07-17')).toBe('2026-10-14')
    expect(visaEndDateFor90DayWindow('2026-12-15')).toBe('2027-03-14')
    expect(visaEndDateFor90DayWindow('2028-02-01')).toBe('2028-04-30')
    expect(visaEndDateFor90DayWindow('')).toBe('')
    expect(visaDateDefaultsForStart('2026-07-17')).toEqual({
      visaValidFrom: '2026-07-17', visaValidTo: '2026-10-14', intendedEntryDate: '2026-07-17', stayLengthDays: 90,
    })

    const payload = { ...emptyVisaPayload(), visaValidFrom: '2026-07-17', visaValidTo: '2026-10-14' }
    expect(validateVisaForReview(payload, [])).not.toContain('visa_period_exceeds_90_days')
    expect(validateVisaForReview({ ...payload, visaValidTo: '2026-10-15' }, [])).toContain('visa_period_exceeds_90_days')
  })

  it('validates each wizard page before allowing the next one', () => {
    const payload = emptyVisaPayload()
    expect(validateVisaStep(payload, [], 0)).toEqual(expect.arrayContaining(['passport_image_required', 'portrait_required']))
    expect(validateVisaStep(payload, [], 1)).toEqual(expect.arrayContaining(['surname_required', 'passport_number_required', 'phone_required']))
    expect(validateVisaStep(payload, [], 2)).toEqual(expect.arrayContaining(['visa_start_required', 'visa_end_required']))
    expect(validateVisaStep(payload, [], 2)).not.toEqual(expect.arrayContaining(['entry_gate_required', 'exit_gate_required']))
  })

  it('automatically moves from a saturated primary checker to the fallback model', async () => {
    const models: string[] = []
    const result = await withAiRetry(
      [{ model: 'primary', delay: 0 }, { model: 'fallback', delay: 0 }],
      async (attempt) => {
        models.push(attempt.model)
        if (attempt.model === 'primary') throw Object.assign(new Error('quota'), { status: 429 })
        return 'checked'
      },
    )
    expect(result).toBe('checked')
    expect(models).toEqual(['primary', 'fallback'])
  })

  it('does not spend a fallback request on permanent provider errors', async () => {
    const models: string[] = []
    await expect(withAiRetry(
      [{ model: 'primary', delay: 0 }, { model: 'fallback', delay: 0 }],
      async (attempt) => {
        models.push(attempt.model)
        throw Object.assign(new Error('invalid request'), { status: 400 })
      },
    )).rejects.toThrow('invalid request')
    expect(models).toEqual(['primary'])
  })
})
