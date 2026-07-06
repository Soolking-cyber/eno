// ── Legal identity of the site operator — single source of truth ────────────────
// Decree 52/2013 Đ.36/Đ.29 requires the operator's name, address, ERC number
// (+ date/place of issue) and contact channels displayed on the site. Values are
// PLACEHOLDERS until the company registration (ERC) is issued — update HERE only
// and the footer + all legal pages pick it up. Keep keys stable.
export const COMPANY = {
  /** Legal (Vietnamese) company name, per the ERC. */
  name: 'Công ty TNHH ENO (đang đăng ký thành lập)',
  nameEn: 'ENO Company Limited (registration in progress)',
  address: 'TP. Hồ Chí Minh, Việt Nam (địa chỉ trụ sở đang cập nhật)',
  /** ERC = Giấy chứng nhận đăng ký doanh nghiệp (số, ngày cấp, nơi cấp). */
  erc: 'đang cập nhật',
  ercIssued: 'đang cập nhật',
  phone: 'đang cập nhật',
  email: 'support@eno.vn',
  /** Personal-data protection contact (PDPL 91/2025 rights requests). */
  privacyEmail: 'support@eno.vn',
}

// Bump when the Terms/Regulations change materially — new acceptances stamp this
// onto Profile.tosVersion (E-Transactions Law: keep a record of what was accepted
// when). Announce changes on-platform ≥5 days before the new version takes effect.
export const TOS_VERSION = '2026-07'

// True while the site is in pre-launch test operation (before the MoIT sàn TMĐT
// registration at online.gov.vn is confirmed). Drives the always-visible bilingual
// notice. Flip to false on the day the registration is confirmed — and add the
// "Đã đăng ký Bộ Công Thương" badge to the footer at the same time.
export const PRELAUNCH = true
