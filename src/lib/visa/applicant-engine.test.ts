import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { normalizeVisaImage } from './image-normalization'
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

    const tooSmall = await sharp({ create: { width: 320, height: 480, channels: 3, background: '#fff' } }).jpeg().toBuffer()
    await expect(normalizeVisaImage(tooSmall, 'portrait')).rejects.toThrow('portrait_resolution_too_low')
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
