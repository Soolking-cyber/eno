/**
 * THE THIRD-PARTY PROVIDER OF RECORD FOR THE E-VISA SERVICE — services edition only.
 *
 * The service is SOLD BY a licensed Vietnamese travel company and MERELY LISTED BY us. That is the
 * entire legal architecture of the arrangement, and every sentence a user reads has to reflect it:
 * the partner performs the work under its own licence and answers for the outcome; eno.forum is the
 * intermediary platform and takes a commission. Checkout happens on the partner's side.
 *
 * ⚠️ EVERY VALUE BELOW IS A PLACEHOLDER. No number here has been seen on a document. They must be
 * filled from (a) the SIGNED AGREEMENT, for the legal name, tax code and address, and (b) the
 * VERIFIED LICENCE ITSELF, for the international travel-service licence number and its issuer.
 * Copying a number out of a website, an email signature or a chat message is not verification.
 *
 * ⚠️ AND THE LICENCE COPIES MUST BE ON FILE BEFORE THE SERVICE IS ADVERTISED AT ALL. Advertising
 * Law 75/2025 puts the burden on the party publishing the advertisement to hold the documents
 * evidencing the advertised business's eligibility — a platform that runs the listing is not
 * excused by pointing at the partner. `PROVIDER_LICENCE_ON_FILE` below exists so that duty is a
 * value in the code rather than a promise in a meeting; it stays false until the copies are held.
 *
 * ⚠️ NEVER HARDCODE ANY OF THIS ANYWHERE ELSE, and never write a plausible-looking licence or tax
 * number "as a sample". A fabricated licence number rendered on a public page is a fabricated
 * licence number, whatever the variable was called.
 *
 * ⚠️ THIS MODULE IS ALIASED AWAY ON A MARKETPLACE BUILD (next.config.ts → visa-provider.stub.ts),
 * which is why the provider's name and the word "visa" may appear here at all. eno.vn is a licensed
 * sàn TMĐT and may not so much as mention the service. A runtime `IS_SERVICES` gate controls
 * BEHAVIOUR but leaves the strings in the artifact — see src/lib/edition-services-copy.ts, which
 * exists for exactly this reason and documents the measurement. So: import this module freely from
 * pages that render on BOTH editions, gate the RENDER on IS_SERVICES, and the alias keeps the words
 * out of eno.vn's chunks.
 *
 * ⚠️ THE STUB IS NOT TYPE-CHECKED AGAINST THIS FILE. An alias is a bundler resolution; `tsc` only
 * ever sees this module. Adding an export here and using it in a shared page is a green typecheck
 * and a crash on eno.vn. src/components/marketplace/edition-stubs.test.ts checks the pair.
 */

export type VisaProvider = {
  /** Trading name, as users will see it. */
  brand: string
  /** Full legal entity name per the signed agreement — NOT guessed from the brand. */
  legalName: string
  legalNameEn: string
  /** Mã số thuế / enterprise code. */
  taxCode: string
  /**
   * Giấy phép kinh doanh dịch vụ lữ hành quốc tế — the international travel-service licence number
   * (Tourism Law 09/2017). This is the licence that lets the partner do the work eno cannot.
   */
  licenceNo: string
  /** The authority that issued it, as printed on the licence. */
  licenceIssuer: string
  licenceIssuerEn: string
  /** Registered head-office address per the agreement. */
  address: string
  /**
   * true only once verified COPIES of the licence and business registration are held on file.
   *
   * ⚠️ Not "the partner told us the number". Not "we saw it on their site". The documents.
   */
  licenceOnFile: boolean
}

/** The one placeholder token, so a grep finds every unfilled field at once. */
const PENDING = 'đang xác minh'

export const VISA_PROVIDER: VisaProvider = {
  brand: 'VietKite',
  // ⚠️ Deliberately NOT "Công ty TNHH VietKite" or any other invented form. The legal name comes off
  // the agreement; inventing a company form is inventing a legal entity.
  legalName: `VietKite (tên pháp nhân đầy đủ ${PENDING} theo hợp đồng đã ký)`,
  legalNameEn: 'VietKite (full legal entity name pending verification from the signed agreement)',
  taxCode: PENDING,
  licenceNo: PENDING,
  licenceIssuer: PENDING,
  licenceIssuerEn: 'pending verification from the licence document',
  address: PENDING,
  licenceOnFile: false,
}

/**
 * Whether the service may be advertised at all yet (Advertising Law 75/2025 — see the header).
 *
 * Gate the marketing surfaces on this, not the legal disclosure: a disclosure that appears only
 * after the paperwork lands is a disclosure nobody reads while it matters.
 */
export const PROVIDER_LICENCE_ON_FILE = VISA_PROVIDER.licenceOnFile

/**
 * The provider-of-record disclosure, EN authored + curated VI.
 *
 * ⚠️ THREE CLAIMS IT MUST NEVER MAKE, each of which has a specific way of being wrong:
 *   · that eno performs, handles or guarantees the visa work — the partner does, under its licence;
 *   · that eno is a government body, an immigration agency, or able to influence a decision;
 *   · that the two sites are unrelated — see AFFILIATION in src/lib/site-legal.ts.
 *
 * Render with tr(PROVIDER_OF_RECORD.en, PROVIDER_OF_RECORD.vi) rather than putting legal copy
 * through the machine translation layer.
 */
export const PROVIDER_OF_RECORD = {
  en: `Vietnam e-visa services listed here are provided by ${VISA_PROVIDER.brand}, a Vietnamese travel company holding an international travel-service licence. ${VISA_PROVIDER.brand} is the provider of record: it performs the visa work under its own licence and is responsible for that service and its outcome. eno.forum operates the platform, passes your application to ${VISA_PROVIDER.brand} and receives a commission. eno.forum is not a government body, is not an immigration agency, and does not decide visa applications.`,
  vi: `Dịch vụ e-visa Việt Nam niêm yết tại đây do ${VISA_PROVIDER.brand} — doanh nghiệp lữ hành Việt Nam có giấy phép kinh doanh dịch vụ lữ hành quốc tế — cung cấp. ${VISA_PROVIDER.brand} là bên cung cấp dịch vụ chính thức: thực hiện công việc xin thị thực theo giấy phép của mình và chịu trách nhiệm về dịch vụ cũng như kết quả. eno.forum vận hành nền tảng, chuyển hồ sơ của bạn cho ${VISA_PROVIDER.brand} và nhận hoa hồng. eno.forum không phải cơ quan nhà nước, không phải đại lý xuất nhập cảnh và không quyết định kết quả hồ sơ thị thực.`,
  /** One line, for a badge or the row under a CTA where the paragraph does not fit. */
  shortEn: `Provided by ${VISA_PROVIDER.brand}, a licensed Vietnamese travel company. eno.forum is the platform, not the provider.`,
  shortVi: `Do ${VISA_PROVIDER.brand} — doanh nghiệp lữ hành Việt Nam có giấy phép — cung cấp. eno.forum là nền tảng trung gian, không phải bên cung cấp dịch vụ.`,
}
