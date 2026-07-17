import { test, expect } from '@playwright/test'

// Authed regression for the post-wizard "use my current location" bug (the one the owner reported):
// before the fix it set province/ward with an empty code, so the area label under-filled and, on
// reopening the picker, the province reset to Ho Chi Minh City. Everything external is mocked so the
// flow is deterministic. Runs only against the seeded standalone server (seller storageState).

const PROVINCES = {
  provinces: [
    { code: '79', name: 'Thành phố Hồ Chí Minh', nameEn: 'Ho Chi Minh City' },
    { code: '01', name: 'Thành phố Hà Nội', nameEn: 'Hanoi' },
  ],
}
const WARDS_01 = { wards: [{ code: 'W_HK', name: 'Phường Hoàn Kiếm', nameEn: 'Hoan Kiem Ward' }] }
// Geolocate to Hanoi / Hoàn Kiếm — a province that is NOT the HCMC default, and the ward only in
// wardCandidates (the top geocode result omits it), so a pass proves both the province change and
// the ward resolution.
const GEOCODE = {
  address: '1 Đinh Tiên Hoàng, Hoàn Kiếm, Hà Nội',
  province: 'Thành phố Hà Nội',
  ward: '',
  wardCandidates: ['Hoàn Kiếm'],
  district: null,
}

test.describe('seller · post wizard — use my current location', () => {
  test.skip(!process.env.E2E_AUTHED_BASE, 'requires standalone server + seeded seller (E2E_AUTHED_BASE)')
  test.use({ geolocation: { latitude: 21.0285, longitude: 105.8542 }, permissions: ['geolocation'] })

  test.beforeEach(async ({ page }) => {
    await page.route('**/api/geo?type=provinces', (r) => r.fulfill({ json: PROVINCES }))
    await page.route('**/api/geo?type=wards*', (r) => {
      const prov = new URL(r.request().url()).searchParams.get('province')
      return r.fulfill({ json: prov === '01' ? WARDS_01 : { wards: [] } })
    })
    await page.route('**/api/reverse-geocode*', (r) => r.fulfill({ json: GEOCODE }))
  })

  test('geolocate fills city/ward and does NOT reset to HCMC on reopen', async ({ page }) => {
    await page.goto('/post')
    await expect(page).not.toHaveURL(/\/signin/)

    const locate = page.getByRole('button', { name: /Use my current location|Dùng vị trí hiện tại/i })
    await locate.scrollIntoViewIfNeeded()
    await locate.click()

    // The area trigger's label becomes the geolocated place (Hoàn Kiếm / Hà Nội) — not the "Set area"
    // placeholder, and not Ho Chi Minh City.
    const areaTrigger = page.getByRole('button', { name: /Hoàn Kiếm|Hoan Kiem|Hà Nội|Hanoi/i })
    await expect(areaTrigger).toBeVisible({ timeout: 10000 })

    // Reopen the picker: the province dropdown must reflect Hà Nội — the pre-fix code:'' made it fall
    // back to HCMC here, silently overwriting the geolocated area on Apply.
    await areaTrigger.click()
    const dialog = page.getByRole('dialog', { name: /Choose area|Chọn khu vực/i })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('combobox', { name: /Hà Nội|Hanoi/i })).toBeVisible({ timeout: 10000 })
  })
})
