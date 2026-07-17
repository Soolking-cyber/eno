import { test, expect, dismissOverlays } from '../helpers'

// Regression cover for "use current location doesn't select city/ward". Everything external is
// mocked so the flow is deterministic: browser geolocation, the /api/geo admin dataset, and the
// reverse-geocoder. We geolocate to a province DIFFERENT from the default (HCMC '79') so the test
// proves BOTH the province change AND the ward auto-select (the ward was the part that silently
// failed — the async resolver read a stale, empty wards list before the fix).

const PROVINCES = {
  provinces: [
    { code: '79', name: 'Thành phố Hồ Chí Minh', nameEn: 'Ho Chi Minh City' },
    { code: '01', name: 'Thành phố Hà Nội', nameEn: 'Hanoi' },
  ],
}
const WARDS_79 = { wards: [{ code: 'W_BN', name: 'Phường Bến Nghé', nameEn: 'Ben Nghe Ward' }] }
const WARDS_01 = {
  wards: [
    { code: 'W_HK', name: 'Phường Hoàn Kiếm', nameEn: 'Hoan Kiem Ward' },
    { code: 'W_OTHER', name: 'Phường Khác', nameEn: 'Other Ward' },
  ],
}
// Reverse-geocode resolves to Hanoi / Hoàn Kiếm (the top result omits the official ward, so the
// real name only rides in wardCandidates — exactly the case the fix must handle).
const GEOCODE = {
  address: '1 Đinh Tiên Hoàng, Hoàn Kiếm, Hà Nội',
  province: 'Thành phố Hà Nội',
  ward: '',
  wardCandidates: ['Hoàn Kiếm'],
  district: null,
}

test.use({ geolocation: { latitude: 21.0285, longitude: 105.8542 }, permissions: ['geolocation'] })

test.describe('Guest · area filter — use current location', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/geo?type=provinces', (r) => r.fulfill({ json: PROVINCES }))
    await page.route('**/api/geo?type=wards*', (r) => {
      const prov = new URL(r.request().url()).searchParams.get('province')
      return r.fulfill({ json: prov === '01' ? WARDS_01 : WARDS_79 })
    })
    await page.route('**/api/reverse-geocode*', (r) => r.fulfill({ json: GEOCODE }))
  })

  test('locate auto-selects the geolocated province AND ward', async ({ page }, testInfo) => {
    // Desktop-only: the AreaFilter resolver is breakpoint-identical, but the narrow-viewport facet
    // row nests Area inside an animated "Filters" sheet (a flaky nested-dialog) — the logic under
    // test is fully exercised on desktop.
    test.skip(testInfo.project.name === 'guest-mobile', 'AreaFilter logic is breakpoint-agnostic; desktop covers it')

    // The faceted explorer (with the Area filter) renders in results mode — a category/query param
    // switches the home out of its curated view.
    await page.goto('/?category=electronics')
    await dismissOverlays(page)

    // Open the Area popover from the facet bar (label is "Area" / "Khu vực" when nothing is set).
    await page.getByRole('button', { name: /^(Area|Khu vực)$/ }).first().click()
    const dialog = page.getByRole('dialog', { name: /Choose area|Chọn khu vực/i })
    await expect(dialog).toBeVisible()

    await dialog.getByRole('button', { name: /Use my current location|Dùng vị trí hiện tại/i }).click()

    // Province combobox switches to Hanoi, and the ward — which started empty — resolves to Hoàn Kiếm
    // (matched from wardCandidates once the province's wards load). Before the fix the ward stayed
    // unset. The combobox accessible name carries its selected value.
    await expect(dialog.getByRole('combobox', { name: /Hanoi|Hà Nội/i })).toBeVisible({ timeout: 10000 })
    await expect(dialog.getByRole('combobox', { name: /Hoan Kiem|Hoàn Kiếm/i })).toBeVisible({ timeout: 10000 })
  })
})
