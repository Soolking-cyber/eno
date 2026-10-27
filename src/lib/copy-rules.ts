/**
 * WORDING RULES THAT RUNTIME CODE ENFORCES TOO — not only the tests that read shipped copy. The voice concierge
 * (src/lib/concierge/guards.ts, 2026-10-27) holds every sentence and chip it would voice or show to them, because a model
 * can compose a retired claim or a counsel-pending word that no source file holds. One copy each, here in lib (test
 * support is never shipped — plan review round 1, opus): the repo-wide guard test and the page tests import them from
 * here (src/test/teachers-counsel-words.ts re-exports its list for its existing readers). Pure: no imports.
 */

/**
 * ⛔ THE RETIRED TRUST CLAIMS (owner decision 2026-10-04) — the wording that stays retired. Why each one went, and how the
 * repo-wide guard reads every shipped string against this list: src/lib/retired-trust-claims.guard.test.ts.
 */
export const RETIRED_TRUST_CLAIMS: readonly RegExp[] = [
  /public trust score and bad listings get reported/i,
  /tin xấu sẽ bị báo cáo/i,
  /fewer fakes|fewer fake photos|fewer bait/i,
  /fakes and bait prices/i,
  /bait prices (?:and recycled photos )?get caught/i,
  /ít hàng giả|ít giá mồi|bớt hàng giả|bớt giá ảo/i,
  /\bevery (?:eno\.vn |eno\.forum )?seller (?:on this site )?(?:has|carries) a public/i,
  /\bevery seller carries a public trust score/i,
  /public trust score behind every provider|every provider on the site carries/i,
  /Your Trusted Vietnam Network|Trusted classifieds|Guaranteed real prices|Trusted listings/i,
  /so listings stay honest|giúp tin đăng luôn trung thực/i,
  /Mỗi người bán đều có điểm uy tín công khai/i,
  // The scoped variants this change also retired (about, guide, layout, site-title, motorbikes).
  /Sellers build a public trust score/i,
  /Every seller who posts here has a public trust score/i,
  /sellers who post here build (?:public )?trust scores/i,
  /problem sellers get caught fast|so the price and condition are real/i,
  // The second pass (taglines, /about, /guide, /trust, the do-cu guide), 2026-10-04.
  /trusted marketplace for (?:the international community|Vietnam)/i,
  // The forum e-Visa intro's "Your trusted starting point for Vietnam." (owner, 2026-10-05: "Your starting point for Vietnam.").
  /trusted starting point/i,
  /chợ uy tín cho cộng đồng quốc tế|Sàn giao dịch uy tín|Chợ mua bán uy tín|sàn giao dịch uy tín dành cho/i,
  /instead of stars and badges|thay vì số sao và huy hiệu/i,
  /Mỗi người bán trên\s*$/,
  // "Posted here ⇒ a trust score" with no partner badge in it (housing), and the forms this pass replaced
  // with the card's own rule, "a seller who posts from an account" (src/lib/linked-seller.ts
  // isUnratedStorefront: an ownerless storefront shows no score, and the API still takes a signed-out
  // post while IDENTITY_GATE_ENFORCED is unset — the web wizard asks for sign-in first).
  /^\s*show the seller(?:’|')s public trust score and can be messaged/i,
  /On listings posted here, the seller(?:’|')s public trust score sits beside their name, and/i,
  /Listings posted directly here show the seller(?:’|')s public trust score, built from/i,
  /posts here(?: directly)? carries a public trust score/i,
  /Listings posted here carry the seller(?:’|')s public trust score/i,
]

/**
 * ⛔ THE /c/teachers WORDING THAT WAITS FOR COUNSEL (teacher visibility plan C1, decision 4; category-copy.ts TEACHERS_H1
 * has the rule). Until counsel words the school side, none of these on a page written for the people hiring:
 *   · "foreign" / "nước ngoài" — nothing in code keeps a Vietnamese teacher off the page;
 *   · the framing the counsel brief asks to avoid — supplying, providing, leasing or referring teachers ("cung cấp",
 *     "cung ứng", "cho thuê", "giới thiệu giáo viên"), brokering ("môi giới"), recruiting ("tuyển dụng"), "connecting"
 *     ("kết nối");
 *   · the teacher's own job search ("looking for work" / "đang tìm việc").
 * ONE LIST FOR EVERY SURFACE A TEST READS, so the guards cannot drift apart: the title and description
 * (category-copy.test.ts) and the rendered lede (category-lede.test.tsx). Callers NFC-normalize what they test, so a
 * decomposed "nước ngoài" cannot slip past.
 */
export const TEACHERS_COUNSEL_WORDS = /nước ngoài|foreign|cung cấp|cung ứng|cho thuê|giới thiệu giáo viên|môi giới|tuyển dụng|kết nối|looking for work|đang tìm việc/i
