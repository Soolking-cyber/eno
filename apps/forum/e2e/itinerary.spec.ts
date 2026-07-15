import { expectNoA11yViolations, test, expect } from './helpers'

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
  test.beforeEach(async ({ page }) => {
    await page.goto('/itinerary')
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

  test('builds a researched, responsive itinerary from granular controls', async ({ page }) => {
    await page.route('**/api/backend/api/itineraries/generate', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mockResult) })
    })

    await expect(page).toHaveTitle(/Vietnam itinerary builder/i)
    await expect(page.getByRole('heading', { level: 1, name: /A Vietnam itinerary that survives reality/i })).toBeVisible()
    const paceOptions = page.getByRole('radiogroup', { name: /Trip pace/i }).getByRole('radio')
    await expect(paceOptions).toHaveCount(3)
    expect(await paceOptions.evaluateAll((options) => options.every((option) => option.scrollWidth <= option.clientWidth))).toBe(true)

    await page.getByLabel(/Start date/i).fill('2026-09-10')
    await page.getByLabel(/Flying from/i).fill('Singapore (SIN)')
    await page.getByRole('radio', { name: /Premium/i }).click()
    await page.getByRole('slider', { name: /Trip length/i }).press('Home')
    await page.getByRole('slider', { name: /Trip length/i }).press('ArrowRight')
    await page.getByTestId('build-itinerary').click()

    await expect(page.getByRole('heading', { name: /Four thoughtful days/i })).toBeVisible()
    await expect(page.getByRole('heading', { name: /Researched flight options/i })).toBeVisible()
    await expect(page.getByRole('heading', { name: /Searched stay shortlist/i })).toBeVisible()
    await expect(page.getByRole('heading', { name: /Meticulous day-by-day plan/i })).toBeVisible()
    await expect(page.getByRole('heading', { name: /Web research sources/i })).toBeVisible()
    await expect(page.getByText(/Hoi An Central Boutique/i)).toBeVisible()
    await expect(page.getByTestId('itinerary-day')).toHaveCount(4)
    await expectNoA11yViolations(page, 'advanced itinerary result')
  })
})
