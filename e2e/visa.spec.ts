import { expectNoA11yViolations, test, expect } from './helpers'
import sharp from 'sharp'
import { normalizeVisaImage } from '../src/lib/visa/image-normalization'
import { withAiRetry } from '../src/lib/visa/ai-retry'
import { evaluatePassportImageQuality } from '../src/lib/visa/image-quality'
import { parsePassportMrz } from '../src/lib/visa/mrz'
import { emptyVisaPayload, visaPayloadSchema } from '../src/lib/visa/schema'

test.describe('eno.forum visa assistance', () => {
  test('explains the safe guest flow and exposes the shared quick links', async ({ page }) => {
    await page.goto('/visa')
    await expect(page).toHaveTitle(/Vietnam e-Visa assistance/i)
    await expect(page.getByRole('heading', { level: 1, name: /One guided application/i })).toBeVisible()
    await expect(page.getByRole('link', { name: /Official e-Visa website/i })).toHaveAttribute('href', 'https://evisa.gov.vn/')
    await expect(page.locator('header img[src="/logo.svg"]')).toBeVisible()
    const footer = page.locator('footer')
    await expect(footer.getByRole('link', { name: 'Forum', exact: true })).toBeVisible()
    await expect(footer.getByRole('link', { name: 'Itinerary', exact: true })).toBeVisible()
    await expect(footer.getByRole('link', { name: /Vietnam e-Visa/i })).toBeVisible()
    await expect(footer.getByRole('link', { name: /Marketplace/i })).toBeVisible()
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

    const tooSmall = await sharp({ create: { width: 320, height: 480, channels: 3, background: '#fff' } }).jpeg().toBuffer()
    await expect(normalizeVisaImage(tooSmall, 'portrait')).rejects.toThrow('portrait_resolution_too_low')
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
      religion: 'None', passportType: 'ordinary', hasOtherNationalities: 'no', hasVietnamLawViolation: 'no',
      hasOtherPassports: 'no', entryType: 'single', purposeOfEntry: 'Tourism', currentlyOutsideVietnam: 'yes',
      stayLengthDays: 14, visitedVietnamLastYear: 'no', hasRelativesInVietnam: 'no', estimatedExpenses: 1000,
      expensesCurrency: 'USD', expensesPayer: 'self', hasTravelInsurance: 'no', hasChildrenOnPassport: 'no',
    })
    expect(payload).toMatchObject({ surname: '', givenNames: '', passportNumber: '', permanentAddress: '', occupation: '', entryGate: '', exitGate: '' })
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
})
