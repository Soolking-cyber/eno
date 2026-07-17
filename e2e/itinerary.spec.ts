import { expectNoA11yViolations, test, expect } from './helpers'
import { readFile } from 'node:fs/promises'
import type { GeneratedItineraryResponse } from '../src/components/itinerary/itinerary-data'
import { buildItinerarySavePayload } from '../src/lib/itinerary-save'

const activity = (title: string, place: string) => ({
  time: '09:00', title, place, details: `A researched visit to ${place} with enough time to enjoy it.`,
  travelMinutes: 20, estimatedCostVnd: 250_000, bookingAdvice: 'Reserve directly if your date is busy.',
})

const mockResult = {
  model: 'gemini-3.5-flash',
  generatedAt: '2026-07-15T10:00:00.000Z',
  searchQueries: ['Da Nang flights September 2026', 'Hoi An official hotels'],
  sources: [
    { title: 'Da Nang International Airport', url: 'https://danangairportterminal.vn/', domain: 'danangairportterminal.vn' },
    { title: 'Vietnam Airlines', url: 'https://www.vietnamairlines.com/', domain: 'vietnamairlines.com' },
  ],
  plan: {
    title: 'Four thoughtful days across Central Vietnam',
    summary: 'A geographically efficient route with a lighter arrival, researched stay options, and realistic transfer buffers.',
    routeSummary: 'Da Nang → Hoi An → Hue',
    routeRationale: 'The route moves north once and avoids backtracking while keeping the airport day deliberately light.',
    budget: { perTravelerLowVnd: 8_000_000, perTravelerHighVnd: 12_000_000, groupLowVnd: 16_000_000, groupHighVnd: 24_000_000, flightsIncluded: true, note: 'Indicative planning range; recheck live inventory.' },
    routeLegs: [
      { from: 'Da Nang', to: 'Hoi An', mode: 'Private transfer', duration: '45–60 min', advice: 'Leave outside commuter peaks.' },
      { from: 'Hoi An', to: 'Hue', mode: 'Car via Hai Van Pass', duration: '3–4 hr', advice: 'Treat this as a scenic transfer day.' },
    ],
    flights: [{ direction: 'outbound', label: 'Morning Singapore to Da Nang lead', route: 'SIN → DAD', airlines: ['Vietnam Airlines', 'Singapore Airlines'], date: '2026-09-10', departureWindow: 'Morning', duration: '2h 45m', stops: 0, priceLowVnd: 3_500_000, priceHighVnd: 5_500_000, fareNote: 'Observed planning range; seats and baggage terms must be rechecked.', url: 'https://www.vietnamairlines.com/' }],
    stays: [{ city: 'Hoi An', name: 'Hoi An Central Boutique', area: 'Cam Pho', category: 'Boutique hotel', why: 'Walkable without being directly in the busiest night corridor.', nightlyLowVnd: 1_600_000, nightlyHighVnd: 2_200_000, url: 'https://example.com/hotel' }],
    days: Array.from({ length: 4 }, (_, index) => ({
      dayNumber: index + 1,
      date: `2026-09-${String(10 + index).padStart(2, '0')}`,
      city: index < 2 ? 'Da Nang' : index === 2 ? 'Hoi An' : 'Hue',
      title: ['Land softly', 'Coast and culture', 'Hoi An at human pace', 'Imperial Hue'][index],
      focus: 'A coherent day with realistic travel buffers and one strong local anchor.',
      paceNote: 'Balanced',
      morning: activity('A calm local start', 'Han River'),
      afternoon: activity('The day’s cultural anchor', 'Cham Museum'),
      evening: activity('Neighborhood dinner', 'An Thuong'),
      foodNote: 'Choose a busy local restaurant and confirm dietary needs before ordering.',
      estimatedDailyCostVnd: 1_500_000,
    })),
    practical: {
      arrival: 'Keep at least 90 minutes between landing and the first commitment.',
      localTransport: 'Use licensed taxis or reputable ride-hailing services.',
      connectivity: 'Buy an eSIM or airport SIM from an identified network counter.',
      money: 'Carry modest cash for markets while using cards at established businesses.',
      weather: 'September can be wet in Central Vietnam, so preserve a flexible indoor option.',
      safety: 'Use normal city precautions and avoid driving a motorbike without suitable licensing and insurance.',
    },
    bookingChecklist: [{ when: 'Now', item: 'Compare the flight lead', reason: 'The displayed range is not held inventory.' }],
    assumptions: ['Travelers can manage ordinary city walking.'],
  },
}

test.describe('eno.forum itinerary builder', () => {
  test('builds the complete owner-only record used for automatic saves', () => {
    const payload = buildItinerarySavePayload({
      result: mockResult as GeneratedItineraryResponse,
      cityIds: ['danang'],
      days: 4,
      budgetId: 'comfort',
      interests: ['food', 'culture'],
    })

    expect(payload).toMatchObject({
      title: mockResult.plan.title,
      destinationId: 'danang',
      days: 4,
      budgetId: 'comfort',
      interests: ['food', 'culture'],
      status: 'ready',
      estimatedBudget: 24_000_000,
    })
    expect(payload.dayPlans).toHaveLength(4)
    expect(payload.dayPlans[0].morning).toContain('A calm local start')
    expect(payload.stays).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'Hoi An Central Boutique', estimatedNightly: 1_600_000 }),
    ]))
  })

  test.beforeEach(async ({ page }) => {
    await page.goto('/itinerary')
    await expect(page.locator('main[data-hydrated]')).toHaveAttribute('data-hydrated', 'true')
  })

  test('proxies marketplace-native itinerary API paths through the allowlist', async ({ request }) => {
    const start = new Date()
    start.setUTCDate(start.getUTCDate() + 30)
    const response = await request.post('/api/backend/api/itineraries/generate', {
      data: {
        locale: 'en', origin: 'Singapore (SIN)', startDate: start.toISOString().slice(0, 10),
        days: 4, travelers: 2, cityIds: ['danang', 'hoian'], budgetId: 'comfort', pace: 'balanced',
        interests: ['food'], accommodation: 'boutique', notes: '',
        flight: { include: true, cabin: 'economy', maxStops: 'one_stop', checkedBags: true },
      },
    })

    expect(response.status()).toBe(401)
    expect(await response.json()).toEqual({ error: 'auth_required' })
  })

  test('supports bounded slider and direct-entry trip sizes', async ({ page }) => {
    const daysSlider = page.getByRole('slider', { name: /Trip length in days/i })
    const travelerSlider = page.getByRole('slider', { name: /Number of travelers/i })
    const daysInput = page.getByRole('spinbutton', { name: /Enter trip length in days/i })
    const travelersInput = page.getByRole('spinbutton', { name: /Enter number of travelers/i })
    const startDateInput = page.getByLabel(/^Start date$/i)
    const endDateDisplay = page.getByText(/^Choose start$/i)

    const startDateBox = await startDateInput.boundingBox()
    const endDateBox = await endDateDisplay.boundingBox()
    expect(startDateBox).not.toBeNull()
    expect(endDateBox).not.toBeNull()
    const dateControlsOverlap = Math.min(startDateBox!.x + startDateBox!.width, endDateBox!.x + endDateBox!.width) > Math.max(startDateBox!.x, endDateBox!.x)
      && Math.min(startDateBox!.y + startDateBox!.height, endDateBox!.y + endDateBox!.height) > Math.max(startDateBox!.y, endDateBox!.y)
    expect(dateControlsOverlap).toBe(false)
    if ((page.viewportSize()?.width || 0) < 640) expect(endDateBox!.y).toBeGreaterThan(startDateBox!.y + startDateBox!.height)

    await expect(page.getByRole('group', { name: /Quick start dates/i })).toHaveCount(0)
    const daysInputBox = await daysInput.boundingBox()
    const travelersInputBox = await travelersInput.boundingBox()
    expect(daysInputBox).not.toBeNull()
    expect(travelersInputBox).not.toBeNull()
    expect(daysInputBox!.x).toBeCloseTo(travelersInputBox!.x, 0)
    expect(daysInputBox!.width).toBeCloseTo(travelersInputBox!.width, 0)

    await expect(daysSlider).toHaveAttribute('min', '1')
    await expect(daysSlider).toHaveAttribute('max', '30')
    await expect(travelerSlider).toHaveAttribute('min', '1')
    await expect(travelerSlider).toHaveAttribute('max', '10')
    await expect(daysInput).toHaveAttribute('max', '30')
    await expect(travelersInput).toHaveAttribute('max', '100')

    await daysInput.fill('30')
    await expect(daysInput).toHaveValue('30')
    await daysInput.fill('31')
    await expect(daysInput).toHaveValue('30')
    await daysInput.fill('0')
    await expect(daysInput).toHaveValue('1')

    await travelersInput.fill('100')
    await expect(travelersInput).toHaveValue('100')
    await expect(travelerSlider).toHaveAttribute('aria-valuenow', '10')
    await travelersInput.fill('101')
    await expect(travelersInput).toHaveValue('100')
    await travelersInput.fill('0')
    await expect(travelersInput).toHaveValue('1')
  })

  test('starts simple and supports searchable, keyboard-first route entry', async ({ page }) => {
    const primaryDestination = page.getByRole('combobox', { name: /^Main destination$/i })
    const addDestination = page.getByRole('combobox', { name: /^Add another stop/i })
    const daysInput = page.getByRole('spinbutton', { name: /Enter trip length in days/i })

    await expect(primaryDestination).toHaveValue('Da Nang')
    await expect(page.getByTestId('itinerary-route-stop')).toHaveCount(0)
    await expect(daysInput).toHaveValue('4')
    await expect(page.getByRole('combobox', { name: /Departure city or airport/i })).toHaveCount(0)

    await addDestination.fill('HUI')
    await addDestination.press('Enter')
    await expect(page.getByTestId('itinerary-route-stop')).toContainText('Hue')
    await expect(daysInput).toHaveValue('6')

    await primaryDestination.fill('SGN')
    await primaryDestination.press('Enter')
    await expect(primaryDestination).toHaveValue('Ho Chi Minh City')

    await page.getByRole('button', { name: /Include flight options/i }).click()
    const origin = page.getByRole('combobox', { name: /Departure city or airport/i })
    await origin.fill('SIN')
    await origin.press('Enter')
    await expect(origin).toHaveValue('Singapore (SIN)')
  })

  test('builds a researched, responsive itinerary from granular controls', async ({ page }) => {
    await page.route('**/api/itineraries/generate', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mockResult) })
    })

    await expect(page).toHaveTitle(/Vietnam itinerary builder/i)
    await expect(page.getByRole('heading', { level: 1, name: /A Vietnam itinerary that survives reality/i })).toBeVisible()
    const paceOptions = page.getByRole('radiogroup', { name: /Trip pace/i }).getByRole('radio')
    await expect(paceOptions).toHaveCount(3)
    expect(await paceOptions.evaluateAll((options) => options.every((option) => option.scrollWidth <= option.clientWidth))).toBe(true)

    await page.getByLabel(/^Start date$/i).fill('2026-09-10')
    await page.getByRole('button', { name: /Include flight options/i }).click()
    await page.getByRole('combobox', { name: /Departure city or airport/i }).fill('Singapore (SIN)')
    await page.getByRole('combobox', { name: /Departure city or airport/i }).press('Enter')
    await page.getByRole('radio', { name: /Premium/i }).click()
    await page.getByRole('slider', { name: /Trip length/i }).press('Home')
    await page.getByRole('slider', { name: /Trip length/i }).press('ArrowRight')
    await page.getByTestId('build-itinerary').click()

    await expect(page.getByRole('heading', { name: /Four thoughtful days/i })).toBeVisible()
    await expect(page.getByRole('heading', { level: 1, name: /A Vietnam itinerary that survives reality/i })).toHaveCount(0)
    await expect(page.getByRole('heading', { name: /Want eno to handle the bookings/i })).toBeVisible()
    await expect(page.getByText(/service fee is 10%/i)).toBeVisible()
    await expect(page.getByRole('link', { name: /Ask eno Concierge/i })).toHaveAttribute('href', /^mailto:support@eno\.vn/)
    await expect(page.getByText(/Gemini|Google Search/i)).toHaveCount(0)
    const downloadPromise = page.waitForEvent('download')
    await page.getByTestId('download-itinerary-docx').click()
    const download = await downloadPromise
    expect(download.suggestedFilename()).toMatch(/^eno-itinerary-.*\.docx$/)
    const downloadPath = await download.path()
    expect(downloadPath).not.toBeNull()
    const wordFile = await readFile(downloadPath!)
    expect(wordFile.subarray(0, 2).toString()).toBe('PK')
    expect(wordFile.byteLength).toBeGreaterThan(5_000)
    await expect(page.getByRole('heading', { name: /Researched flight options/i })).toBeVisible()
    await expect(page.getByRole('heading', { name: /Searched stay shortlist/i })).toBeVisible()
    await expect(page.getByRole('heading', { name: /^Day-by-day plan$/i })).toBeVisible()
    await expect(page.getByRole('heading', { name: /^Travel services and plan links$/i })).toBeVisible()
    await expect(page.getByRole('heading', { name: /^Research sources$/i })).toBeVisible()
    await expect(page.getByRole('link', { name: /eno Travel Marketplace/i })).toHaveAttribute('href', 'https://eno.vn/?category=tickets-travel')
    await expect(page.getByRole('link', { name: /eno Visa Services/i })).toHaveAttribute('href', 'https://eno.vn/?category=services&subcategory=visa-legal')
    await expect(page.getByRole('link', { name: /Official Vietnam e-Visa/i })).toHaveAttribute('href', 'https://evisa.gov.vn/')
    await expect(page.getByRole('link', { name: /Grab Vietnam/i })).toHaveAttribute('href', 'https://www.grab.com/vn/en/download/')
    await expect(page.getByRole('link', { name: /VeXeRe/i })).toHaveAttribute('href', 'https://vexere.com/en-US')
    await expect(page.getByRole('link', { name: /Han River/i })).toHaveAttribute('href', /google\.com\/maps\/search/)
    await expect(page.getByRole('heading', { name: /^Hoi An Central Boutique$/i })).toBeVisible()
    await expect(page.getByTestId('itinerary-day')).toHaveCount(4)
    await expectNoA11yViolations(page, 'advanced itinerary result')
  })

  test('keeps useful travel services available when research citations are absent', async ({ page }) => {
    await page.route('**/api/itineraries/generate', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...mockResult, sources: [] }) })
    })

    await page.getByLabel(/^Start date$/i).fill('2026-09-10')
    await page.getByRole('button', { name: /Include flight options/i }).click()
    await page.getByRole('combobox', { name: /Departure city or airport/i }).fill('Singapore (SIN)')
    await page.getByRole('combobox', { name: /Departure city or airport/i }).press('Enter')
    await page.getByRole('slider', { name: /Trip length/i }).press('Home')
    await page.getByRole('slider', { name: /Trip length/i }).press('ArrowRight')
    await page.getByTestId('build-itinerary').click()

    await expect(page.getByText(/No source links were returned/i)).toHaveCount(0)
    await expect(page.getByRole('heading', { name: /^Travel services and plan links$/i })).toBeVisible()
    await expect(page.getByRole('link', { name: /eno Community Forum/i })).toBeVisible()
    await expect(page.getByRole('link', { name: /Vietnam Railways/i })).toBeVisible()
    await expect(page.getByRole('link', { name: /Hoi An Central Boutique/i })).toBeVisible()
  })
})
