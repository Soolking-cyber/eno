/**
 * ── EACH PARTNER SHOP'S OWN RETURN POLICY, ON ITS OWN WEBSITE (owner, 2026-11-28: "and return policy from respective
 * partner website") ──
 *
 * The partner shops whose goods eno.vn lists for sale, by SELLER ID — the id is the identity, as `ENO_RUN_PARTNERS`
 * (src/lib/eno-run-partners.ts) pins it — each with the page on its own site where it states returns, exchanges and refunds.
 * Agents read these through the UCP catalog (src/lib/ucp/catalog.ts): the variant's `seller.links` (refund_policy) and a
 * `dev.ucp.shopping.policy.return` policy over that partner's products.
 *
 * ⛔ A LINK, NOT A RESTATEMENT. The terms differ by product (new or used, phone or laptop) and change on the partner's
 * side, so eno.vn never copies a day count or a condition: the summary says whose policy applies and the URL holds it.
 * ⛔ NO POLICY FOR A SELLER NOT LISTED HERE. A private seller has none, and eno.vn has none of its own for goods it does not
 * sell (buyers pay sellers directly), so nothing is said for them rather than something invented.
 *
 * Each URL was opened on 2026-11-28 (200, the shop's own domain) and its text read for the returns section:
 * - Hoàng Hà Mobile: no separate returns page; "Chính sách bảo hành" carries "II. Chính sách đổi trả hàng hoá".
 * - CellphoneS: the footer's "Chính sách đổi trả" link.
 * - Điện Thoại Vui: "Chính sách bảo hành", whose "đổi trả" table covers new and used (máy cũ) items.
 * - HAGA Smartech: "Chính sách đổi trả và hoàn tiền".
 * - ShopDunk: "Đổi trả".
 * - VinWonders (tickets): the Terms ("Điều khoản và Quy định"), whose "Chính sách hoàn, huỷ" section governs refunds.
 * SDC_store, the other store with goods for sale, has no partner site on record (PARTNER_SOURCES), so no entry.
 */
export type PartnerReturnPolicy = { name: string; url: string }

export const PARTNER_RETURN_POLICIES: Readonly<Record<string, PartnerReturnPolicy>> = {
  cmwgyb5m10000rjq4xxjkwwaz: { name: 'Hoàng Hà Mobile', url: 'https://hoanghamobile.com/chinh-sach-bao-hanh' },
  cmt78nvif0000gpq48kvzmxjw: { name: 'CellphoneS', url: 'https://cellphones.com.vn/tos?part=refund-policy' },
  cmtr9qva90000glq44fkjs18b: { name: 'Điện Thoại Vui', url: 'https://dienthoaivui.com.vn/chinh-sach-bao-hanh' },
  'ed20fff4-0ba5-4ee4-a032-743d9c7cdd4d': { name: 'HAGA Smartech', url: 'https://hagasmartech.com/chinh-sach-doi-tra-hang-va-hoan-tien' },
  cmwgyb5sl0001rjq4yuj9b2sq: { name: 'ShopDunk', url: 'https://shopdunk.com/chinh-sach-doi-tra' },
  cmt6v9x4o00004fq4v6qokman: { name: 'VinWonders', url: 'https://vinwonders.com/vi/terms-and-conditions/' },
}

export const partnerReturnPolicy = (sellerId: string | null | undefined): PartnerReturnPolicy | null =>
  (sellerId && Object.hasOwn(PARTNER_RETURN_POLICIES, sellerId) ? PARTNER_RETURN_POLICIES[sellerId] : null)
