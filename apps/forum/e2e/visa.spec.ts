import { expectNoA11yViolations, test, expect } from './helpers'
import sharp from 'sharp'
import { normalizeVisaImage } from '../src/lib/visa/image-normalization'
import { withAiRetry } from '../src/lib/ai-retry'
import { evaluatePassportImageQuality } from '../src/lib/visa/image-quality'
import { parsePassportMrz } from '../src/lib/visa/mrz'
import { emptyVisaPayload, validateVisaForReview, validateVisaStep, visaDateDefaultsForStart, visaEndDateFor90DayWindow, visaPayloadSchema } from '../src/lib/visa/schema'
import { DEFAULT_EVISA_ENTRY_GATE, EVISA_CHECKPOINTS } from '../src/lib/visa/checkpoints'
import { isAdminPrefillableStatus, isAdminReviewStatus } from '../src/lib/visa/workflow'

test.describe('eno.forum visa assistance', () => {
  test('keeps Gemini diagnostics private to the support admin', async ({ request }) => {
    const response = await request.get('/api/admin/ai-health?probe=1')
    expect(response.status()).toBe(403)
    expect(await response.json()).toEqual({ error: 'admin_required' })
  })

  test('keeps application deletion private to the application owner', async ({ request }) => {
    const response = await request.delete('/api/visa/applications/00000000-0000-0000-0000-000000000000')
    expect(response.status()).toBe(401)
    expect(await response.json()).toEqual({ error: 'auth_required' })
  })

  test('explains the safe guest flow and uses the shared eno.vn footer', async ({ page }) => {
    await page.goto('/visa')
    await expect(page).toHaveTitle(/Vietnam e-Visa assistance/i)
    await expect(page.getByRole('heading', { level: 1, name: /One guided application/i })).toBeVisible()
    await expect(page.getByRole('link', { name: /Official e-Visa website/i })).toHaveAttribute('href', 'https://evisa.gov.vn/')
    await expect(page.locator('header img[src="/logo.svg"]')).toBeVisible()
    const footer = page.locator('footer')
    await expect(footer.getByRole('link', { name: /Help center/i })).toHaveAttribute('href', 'https://eno.vn/help')
    await expect(footer.getByRole('link', { name: /About us/i })).toHaveAttribute('href', 'https://eno.vn/about')
    await expect(footer.getByRole('link', { name: /Post a listing/i })).toHaveAttribute('href', 'https://eno.vn/post')
    await expect(footer.getByRole('link', { name: /^Terms$/i })).toHaveAttribute('href', 'https://eno.vn/terms')
    await expect(footer.getByRole('link', { name: /Forum|Itinerary|Vietnam e-Visa|Marketplace/i })).toHaveCount(0)
    await expectNoA11yViolations(page, 'visa assistance guest page')
  })

  test('normalizes portrait and passport uploads to official technical limits', async () => {
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

    // ⚠️ 320×480 IS NOW ACCEPTED. The shared upload floor dropped to 240×320 on 2026-08-19 (owner:
    // "as long as its readable passport photo accept it"), and image-normalization.ts is sync-paired
    // with the root, so this spec moves with it or the Forum E2E job goes red on a change that never
    // touched apps/forum. A thumbnail is what the floor still refuses.
    const smallButUsable = await sharp({ create: { width: 320, height: 480, channels: 3, background: '#fff' } }).jpeg().toBuffer()
    const upscaled = await normalizeVisaImage(smallButUsable, 'portrait')
    expect([(await sharp(upscaled.output).metadata()).width, (await sharp(upscaled.output).metadata()).height]).toEqual([800, 1200])

    const thumbnail = await sharp({ create: { width: 160, height: 220, channels: 3, background: '#fff' } }).jpeg().toBuffer()
    await expect(normalizeVisaImage(thumbnail, 'portrait')).rejects.toThrow('portrait_resolution_too_low')
  })

  test('cross-checks standard passport MRZ check digits before autofill', () => {
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

  test('keeps page-edge uncertainty advisory when the passport is readable', () => {
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

  test('defaults an omitted or empty religion to None', () => {
    expect(emptyVisaPayload().religion).toBe('None')
    expect(visaPayloadSchema.parse({ religion: '' }).religion).toBe('None')
    expect(visaPayloadSchema.parse({ religion: 'Buddhist' }).religion).toBe('Buddhist')
  })

  test('uses conservative common-tourist defaults without guessing identity fields', () => {
    const payload = emptyVisaPayload('traveler@example.com')
    expect(payload).toMatchObject({
      religion: 'None', passportType: 'ordinary', usedOtherPassportsForVietnam: 'no', hasOtherNationalities: 'no', hasVietnamLawViolation: 'no',
      hasOtherPassports: 'no', entryType: 'single', purposeOfEntry: 'Tourism', currentlyOutsideVietnam: 'yes',
      stayLengthDays: 90, visitedVietnamLastYear: 'no', hasRelativesInVietnam: 'no', estimatedExpenses: 1000,
      expensesCurrency: 'USD', expensesPayer: 'self', paymentMethod: 'credit_card', hasTravelInsurance: 'no', hasChildrenOnPassport: 'no',
    })
    expect(payload).toMatchObject({ surname: '', givenNames: '', passportNumber: '', permanentAddress: '', occupation: '', entryGate: DEFAULT_EVISA_ENTRY_GATE, exitGate: DEFAULT_EVISA_ENTRY_GATE })
  })

  test('defaults to Tan Son Nhat and contains every approved e-visa checkpoint', () => {
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

  test('fills an inclusive 90-day e-visa window across month and year boundaries', () => {
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

  test('validates each wizard page before allowing the next one', () => {
    const payload = emptyVisaPayload()
    expect(validateVisaStep(payload, [], 0)).toEqual(expect.arrayContaining(['passport_image_required', 'portrait_required']))
    expect(validateVisaStep(payload, [], 1)).toEqual(expect.arrayContaining(['surname_required', 'passport_number_required', 'phone_required']))
    expect(validateVisaStep(payload, [], 2)).toEqual(expect.arrayContaining(['visa_start_required', 'visa_end_required']))
    expect(validateVisaStep(payload, [], 2)).not.toEqual(expect.arrayContaining(['entry_gate_required', 'exit_gate_required']))
  })

  test('allows one admin approval action to launch prefill directly from review', () => {
    expect(['ready_for_review', 'under_review', 'ready_to_submit'].filter(isAdminPrefillableStatus)).toEqual(['ready_for_review', 'under_review', 'ready_to_submit'])
    expect(isAdminReviewStatus('ready_for_review')).toBe(true)
    expect(isAdminReviewStatus('under_review')).toBe(true)
    expect(isAdminPrefillableStatus('applicant_approval')).toBe(false)
    expect(isAdminPrefillableStatus('needs_changes')).toBe(false)
  })

  test('automatically moves from a saturated primary checker to the fallback model', async () => {
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

  test('does not spend a fallback request on permanent provider errors', async () => {
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
