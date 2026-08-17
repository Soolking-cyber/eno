/**
 * THE DECLARATION TEXT, AND NOTHING THAT HASHES IT.
 *
 * ⛔ SPLIT OUT OF `declaration.ts` ON 2026-08-17 BECAUSE THAT FILE'S FIRST LINE IS
 * `import { createHash } from 'node:crypto'`, AND A CLIENT COMPONENT IMPORTS THESE CONSTANTS.
 * `verify-client.tsx` is `'use client'` and needs only the words; importing them from the module
 * that also hashes them dragged Turbopack's whole Node-crypto polyfill into the browser bundle —
 * measured at 435.1 KB raw / 130.2 KB gzip (crypto-browserify + asn1.js + bn.js + buffer), which
 * was 44% of everything /dashboard/account/verify shipped.
 *
 * ⚠️ THE RULE, NOT THE INSTANCE: a `'use client'` file importing from a module with ANY node:
 * builtin import pulls that builtin's polyfill, whether or not the imported symbol touches it.
 * Tree-shaking does not save you — the import is at module scope. Keep constants a client needs in
 * a file with no node: imports at all.
 *
 * ⚠️ THE HASH STAYS SERVER-SIDE, which is the point: `declarationHash()` reads these strings and
 * lives next door. Nothing about the legal record changes — same text, same digest.
 */
// ── Identity declaration ────────────────────────────────────────────────────────────────────────
//
// Owner, 2026-08-03: "ask user to confirm if they uploaded truthful and all legal compliance lies
// on them". Before any identity document is submitted, the user makes an explicit declaration: the
// documents are genuine, they belong to them, the information is true, and responsibility for a
// false declaration is theirs.
//
// ⚠️ THIS IS NOT A TERMS CHECKBOX, AND THE DIFFERENCE IS THE WHOLE POINT. A tick-to-continue that
// nobody reads transfers nothing. What makes a declaration hold up is being able to show, for a
// specific person at a specific moment, the EXACT WORDS they affirmed. So we version the text and
// store a hash of the precise string rendered on screen — the same snapshot-hash discipline the
// visa payment consent already uses (`consent_snapshot_hash`).
//
// ⚠️ VIETNAMESE IS AUTHORITATIVE. This is a declaration made to a Vietnamese platform under
// Vietnamese law; the English is a courtesy translation for the expat half of the user base. If the
// two ever diverge in meaning, the Vietnamese governs — say so in the text itself, because a
// bilingual declaration with no stated precedence is ambiguous exactly when it matters.
//
// ⚠️ NEVER EDIT A PUBLISHED VERSION IN PLACE. Add a new one. Records point at a version id, and
// rewriting v1's words retroactively changes what past users are recorded as having affirmed —
// which destroys the only thing this mechanism exists to provide.

export type DeclarationVersion = {
  id: string
  effective: string
  vi: string
  en: string
}

export const DECLARATIONS: Record<string, DeclarationVersion> = {
  'identity-v1': {
    id: 'identity-v1',
    effective: '2026-08-03',
    vi: [
      'Tôi xin cam đoan:',
      '(1) Giấy tờ tôi tải lên là giấy tờ thật, do cơ quan có thẩm quyền cấp, còn hiệu lực và là giấy tờ của chính tôi;',
      '(2) Mọi thông tin tôi cung cấp là đúng sự thật, đầy đủ và chính xác;',
      '(3) Tôi hiểu rằng việc sử dụng giấy tờ giả mạo hoặc khai báo không trung thực là hành vi vi phạm pháp luật, và tôi hoàn toàn chịu trách nhiệm trước pháp luật về nội dung tôi đã khai báo;',
      '(4) Tôi đồng ý để eno.vn xác minh thông tin này theo quy định của Nghị định 248/2026/NĐ-CP và Luật Thương mại điện tử số 122/2025/QH15, và hiểu rằng tài khoản của tôi có thể bị tạm ngừng nếu phát hiện khai báo sai sự thật.',
      'Bản tiếng Việt là bản có giá trị pháp lý.',
    ].join('\n'),
    en: [
      'I declare that:',
      '(1) The documents I have uploaded are genuine, issued by a competent authority, currently valid, and belong to me;',
      '(2) All information I have provided is true, complete and accurate;',
      '(3) I understand that using forged documents or making an untruthful declaration is unlawful, and that I bear full legal responsibility for what I have declared;',
      '(4) I consent to eno.vn verifying this information under Decree No. 248/2026/ND-CP and Law on E-commerce No. 122/2025/QH15, and I understand my account may be suspended if a false declaration is found.',
      'The Vietnamese text is the legally binding version.',
    ].join('\n'),
  },
}

/** The version a new submission must affirm. Bump only by ADDING a version above. */
export const CURRENT_DECLARATION = 'identity-v1'
