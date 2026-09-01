/**
 * THE VIETNAMESE BANKS A VIETQR TRANSFER CAN REACH.
 *
 * ⛔ A SELLER MUST NOT BE ASKED FOR A NAPAS BIN. The first version of the payout form had a raw
 * six-digit input with "e.g. 970415 for VietinBank" underneath it — a number nobody knows about
 * their own bank, typed by hand, that silently routes money. Owner, 2026-08-31: make it a dropdown.
 * A wrong BIN does not error: it produces a QR that scans, names a different bank, and pays someone
 * else.
 *
 * ⚠️ BAKED IN, NOT FETCHED. `api.vietqr.io` publishes this list and the temptation is to call it —
 * but then a checkout depends on a third party's uptime, and a bank list that changes under a saved
 * account is worse than one that is slightly stale. Regenerate deliberately when a bank is added.
 *
 * ⚠️ ONLY `transferSupported` BANKS. The source lists 65 institutions; 42 accept a NAPAS 247
 * transfer. Offering the rest would let a seller pick a bank that cannot receive the payment,
 * which they would discover only when a buyer's transfer failed.
 *
 * Source: https://api.vietqr.io/v2/banks — fetched 2026-08-31.
 */

export type VnBank = {
  /** The 6-digit NAPAS acquirer BIN that goes into tag 38 of the QR payload. */
  bin: string
  /** What Vietnamese people call it — the label a seller recognises. */
  short: string
  /** The full legal name, for disambiguation. */
  name: string
}

export const VN_BANKS: readonly VnBank[] = [
  { bin: '970425', short: "ABBANK", name: "Ngân hàng TMCP An Bình" },
  { bin: '970416', short: "ACB", name: "Ngân hàng TMCP Á Châu" },
  { bin: '970405', short: "Agribank", name: "Ngân hàng Nông nghiệp và Phát triển Nông thôn Việt Nam" },
  { bin: '970409', short: "BacABank", name: "Ngân hàng TMCP Bắc Á" },
  { bin: '970438', short: "BaoVietBank", name: "Ngân hàng TMCP Bảo Việt" },
  { bin: '970418', short: "BIDV", name: "Ngân hàng TMCP Đầu tư và Phát triển Việt Nam" },
  { bin: '546034', short: "CAKE", name: "TMCP Việt Nam Thịnh Vượng - Ngân hàng số CAKE by VPBank" },
  { bin: '422589', short: "CIMB", name: "Ngân hàng TNHH MTV CIMB Việt Nam" },
  { bin: '970446', short: "COOPBANK", name: "Ngân hàng Hợp tác xã Việt Nam" },
  { bin: '970431', short: "Eximbank", name: "Ngân hàng TMCP Xuất Nhập khẩu Việt Nam" },
  { bin: '970437', short: "HDBank", name: "Ngân hàng TMCP Phát triển Thành phố Hồ Chí Minh" },
  { bin: '668888', short: "KBank", name: "Ngân hàng Đại chúng TNHH Kasikornbank" },
  { bin: '970452', short: "KienLongBank", name: "Ngân hàng TMCP Kiên Long" },
  { bin: '970449', short: "LPBank", name: "Ngân hàng TMCP Lộc Phát Việt Nam" },
  { bin: '970422', short: "MBBank", name: "Ngân hàng TMCP Quân đội" },
  { bin: '970414', short: "MBV", name: "Ngân hàng TNHH MTV Việt Nam Hiện Đại" },
  { bin: '971025', short: "MoMo", name: "CTCP Dịch Vụ Di Động Trực Tuyến" },
  { bin: '970426', short: "MSB", name: "Ngân hàng TMCP Hàng Hải Việt Nam" },
  { bin: '970428', short: "NamABank", name: "Ngân hàng TMCP Nam Á" },
  { bin: '970419', short: "NCB", name: "Ngân hàng TMCP Quốc Dân" },
  { bin: '970448', short: "OCB", name: "Ngân hàng TMCP Phương Đông" },
  { bin: '970430', short: "PGBank", name: "Ngân hàng TMCP Thịnh vượng và Phát triển" },
  { bin: '970412', short: "PVcomBank", name: "Ngân hàng TMCP Đại Chúng Việt Nam" },
  { bin: '971133', short: "PVcomBank Pay", name: "Ngân hàng TMCP Đại Chúng Việt Nam Ngân hàng số" },
  { bin: '970403', short: "Sacombank", name: "Ngân hàng TMCP Sài Gòn Thương Tín" },
  { bin: '970400', short: "SaigonBank", name: "Ngân hàng TMCP Sài Gòn Công Thương" },
  { bin: '970429', short: "SCB", name: "Ngân hàng TMCP Sài Gòn" },
  { bin: '970440', short: "SeABank", name: "Ngân hàng TMCP Đông Nam Á" },
  { bin: '970443', short: "SHB", name: "Ngân hàng TMCP Sài Gòn - Hà Nội" },
  { bin: '970424', short: "ShinhanBank", name: "Ngân hàng TNHH MTV Shinhan Việt Nam" },
  { bin: '970407', short: "Techcombank", name: "Ngân hàng TMCP Kỹ thương Việt Nam" },
  { bin: '963388', short: "Timo", name: "Ngân hàng số Timo by Ban Viet Bank (Timo by Ban Viet Bank)" },
  { bin: '970423', short: "TPBank", name: "Ngân hàng TMCP Tiên Phong" },
  { bin: '546035', short: "Ubank", name: "TMCP Việt Nam Thịnh Vượng - Ngân hàng số Ubank by VPBank" },
  { bin: '970441', short: "VIB", name: "Ngân hàng TMCP Quốc tế Việt Nam" },
  { bin: '970427', short: "VietABank", name: "Ngân hàng TMCP Việt Á" },
  { bin: '970433', short: "VietBank", name: "Ngân hàng TMCP Việt Nam Thương Tín" },
  { bin: '970454', short: "VietCapitalBank", name: "Ngân hàng TMCP Bản Việt" },
  { bin: '970436', short: "Vietcombank", name: "Ngân hàng TMCP Ngoại Thương Việt Nam" },
  { bin: '970415', short: "VietinBank", name: "Ngân hàng TMCP Công thương Việt Nam" },
  { bin: '970432', short: "VPBank", name: "Ngân hàng TMCP Việt Nam Thịnh Vượng" },
  { bin: '970457', short: "Woori", name: "Ngân hàng TNHH MTV Woori Việt Nam" },
]

/** ⚠️ EXACT BIN LOOKUP, so a stored value can always be rendered as the bank a seller chose. */
export function bankByBin(bin: string | null | undefined): VnBank | null {
  const b = (bin ?? '').trim()
  return VN_BANKS.find((x) => x.bin === b) ?? null
}
