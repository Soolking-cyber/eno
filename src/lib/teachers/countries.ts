/**
 * ISO 3166-1 alpha-2 codes for the nationality picker. Names are NOT stored here: the form renders
 * them with `Intl.DisplayNames` in the visitor's language, so there is no 249-row copy to translate.
 * The first block is the nationalities that most often teach in Vietnam, shown first.
 */
export const COMMON_TEACHER_NATIONALITIES = ['US', 'GB', 'CA', 'AU', 'NZ', 'IE', 'ZA', 'PH', 'VN', 'IN', 'FR', 'DE', 'KR', 'JP', 'CN'] as const

export const ALL_COUNTRY_CODES = (
  'AD AE AF AG AI AL AM AO AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BW BY BZ ' +
  'CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM ' +
  'FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GT GU GW GY HK HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE ' +
  'JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN ' +
  'MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS ' +
  'PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TG TH TJ TK TL ' +
  'TM TN TO TR TT TV TW TZ UA UG US UY UZ VA VC VE VG VI VN VU WF WS XK YE YT ZA ZM ZW'
).split(' ')

/** A country's name in `lang`, falling back to the code when the runtime has no display names. */
export function countryName(code: string, lang: string): string {
  try {
    return new Intl.DisplayNames([lang === 'vi' ? 'vi' : lang || 'en'], { type: 'region' }).of(code) ?? code
  } catch {
    return code
  }
}
