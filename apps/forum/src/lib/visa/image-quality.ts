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

const PORTRAIT_BLOCKING_CHECKS: Record<string, string> = {
  correctPortraitPhoto: 'not_compliant_portrait', singlePerson: 'portrait_must_show_one_person', clearImage: 'portrait_image_blurry',
  straightFace: 'face_must_look_straight', noHat: 'remove_hat', noGlasses: 'remove_glasses', formalClothes: 'wear_formal_clothes',
  whiteBackground: 'use_plain_white_background', faceCentered: 'center_face_in_photo',
  headAndShouldersVisible: 'show_head_and_shoulders', evenLighting: 'portrait_lighting_uneven',
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

export function evaluatePortraitImageQuality(checks: unknown) {
  const issues = failedChecks(checks, PORTRAIT_BLOCKING_CHECKS)
  return { issues, warnings: [] as string[], status: issues.length ? 'failed' as const : 'passed' as const }
}
