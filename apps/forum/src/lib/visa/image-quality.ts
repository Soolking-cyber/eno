const PASSPORT_BLOCKING_CHECKS: Record<string, string> = {
  correctPassportBiodataPage: 'not_passport_biodata_page',
  singleDataPage: 'use_one_passport_data_page',
  clearImage: 'passport_image_blurry',
  printedTextReadable: 'passport_text_unreadable',
}

const PASSPORT_ADVISORY_CHECKS: Record<string, string> = {
  noSignificantGlare: 'passport_image_has_glare',
  fullPageVisible: 'passport_page_cropped',
  allCornersVisible: 'passport_corners_missing',
  mrzReadable: 'passport_mrz_unreadable',
}

// ⚠️ SEVEN OF THE ELEVEN PORTRAIT CHECKS BLOCK; FOUR ONLY WARN (owner, 2026-07-29).
//
// The four demoted ones are `wear_formal_clothes`, `use_plain_white_background`,
// `center_face_in_photo` and `portrait_lighting_uneven`, and the reason is measured rather than
// assumed. The only applicant who has ever reached this step uploaded two portraits three minutes
// apart on 2026-07-28; the `portrait_analyzed` events record that three codes fired on BOTH
// attempts (`not_compliant_portrait`, `portrait_image_blurry`, `show_head_and_shoulders`) while the
// fourth SWAPPED — `use_plain_white_background` on the first run, `wear_formal_clothes` on the
// second. Same subject, same phone, minutes apart, temperature 0. A verdict that changes when the
// input does not is noise, and blocking a paid application on noise is indefensible.
//
// Three structural reasons the demoted four are the noisy ones, not just the unlucky ones:
//   · WE GRADE OUR OWN OUTPUT. normalizeVisaImage pads every off-ratio portrait with
//     fit:'contain' + background:'#fff', so the model sees pure-white bars around whatever wall
//     the applicant actually stood in front of and has to reconcile two different whites; the same
//     padding re-frames their composition before `faceCentered` is judged, and the JPEG ladder can
//     fall to q58, which adds banding that reads as uneven light.
//   · THEY HAVE NO THRESHOLD. "Even" lighting, a "centered" face and "formal" clothes are not
//     measurable from pixels, and the extract prompt says booleans must be false whenever the
//     criterion is uncertain — so every ambiguous case resolves toward blocking.
//   · THEY DEMAND EQUIPMENT, NOT BEHAVIOUR. A hat comes off in five seconds. A plain white wall
//     is a room you either have or do not, in a hotel at 2am.
//
// ⚠️ THIS IS NOT A CLAIM THAT THE DEPARTMENT DOES NOT CARE. apps/forum/docs/VISA_ASSISTANCE.md
// records, checked against evisa.gov.vn on 2026-07-16, that the official form DOES ask for formal
// clothes and a white background. Demoting them is a deliberate trade: the applicant is warned
// loudly and a human reviews the photo between payment and submission, which is where a beige wall
// should be judged anyway. The seven that still block are the ones that make a photo unusable at
// any desk — not a portrait, more than one person, unreadable, face turned away, hat, glasses, or
// the head and shoulders not in frame.
const PORTRAIT_BLOCKING_CHECKS: Record<string, string> = {
  correctPortraitPhoto: 'not_compliant_portrait', singlePerson: 'portrait_must_show_one_person', clearImage: 'portrait_image_blurry',
  straightFace: 'face_must_look_straight', noHat: 'remove_hat', noGlasses: 'remove_glasses',
  headAndShouldersVisible: 'show_head_and_shoulders',
}

// ⚠️ ADVISORY MEANS RENDERED, NOT DISCARDED. Until 2026-07-29 this function returned
// `warnings: []` and visa-cards.tsx declared the field without ever reading it, so "advisory"
// was a synonym for deleted — the passport gate's four advisory codes had never been shown to a
// human. Demoting a check into a bucket nobody renders is not easing a requirement, it is
// removing one silently. DocumentRow now renders these; do not demote anything else here without
// checking it still reaches the applicant.
const PORTRAIT_ADVISORY_CHECKS: Record<string, string> = {
  formalClothes: 'wear_formal_clothes', whiteBackground: 'use_plain_white_background',
  faceCentered: 'center_face_in_photo', evenLighting: 'portrait_lighting_uneven',
}

function failedChecks(value: unknown, issueMap: Record<string, string>) {
  if (!value || typeof value !== 'object') return Object.values(issueMap)
  const checks = value as Record<string, unknown>
  return Object.entries(issueMap).flatMap(([key, issue]) => checks[key] === true ? [] : [issue])
}

export const PASSPORT_IMAGE_CODES = [...new Set([
  ...Object.values(PASSPORT_BLOCKING_CHECKS),
  ...Object.values(PASSPORT_ADVISORY_CHECKS),
  'passport_mrz_check_failed',
  'passport_image_not_verified',
])]

export function evaluatePassportImageQuality(checks: unknown, mrzValid?: boolean) {
  const issues = failedChecks(checks, PASSPORT_BLOCKING_CHECKS)
  const warnings = failedChecks(checks, PASSPORT_ADVISORY_CHECKS)
  if (mrzValid === false && !warnings.includes('passport_mrz_check_failed')) warnings.push('passport_mrz_check_failed')
  return { issues, warnings, status: issues.length ? 'failed' as const : 'passed' as const }
}

export const PORTRAIT_ADVISORY_CODES = Object.values(PORTRAIT_ADVISORY_CHECKS)

export function evaluatePortraitImageQuality(checks: unknown) {
  const issues = failedChecks(checks, PORTRAIT_BLOCKING_CHECKS)
  const warnings = failedChecks(checks, PORTRAIT_ADVISORY_CHECKS)
  // ⚠️ STATUS FOLLOWS `issues` ALONE. A portrait with warnings and no blocking issue is `passed`,
  // which is the whole point of the demotion — schema.ts gates the applicant on the STATUS, so if
  // warnings counted here nothing would have changed.
  return { issues, warnings, status: issues.length ? 'failed' as const : 'passed' as const }
}
