/**
 * Evisa Saigon's two services on its own storefront (owner, 2026-11-18: "https://evisasaigon.vn/ add them as a partner for
 * Work permit and TRC issuance Wp 7-9 weeks 9 million, and TRC 14 days 10.5 million all prices include government fees …
 * fast issuance of 4-5 weeks for WP and 4 days for TRC … plus 1,5 million to WP and plus 1 million to trc do good research
 * about requirements description etc so it looks professional and trust worthy"; then "reuse hoan phi style make it super
 * simple … not much words on card itself all info on description" and "card only names service large … english primary").
 *
 *   npx tsx scripts/seed-evisasaigon.ts --assets <dir>            # DRY RUN — screens the copy, writes nothing
 *   npx tsx scripts/seed-evisasaigon.ts --assets <dir> --apply    # uploads the cards and the avatar, writes the rows
 *
 * <dir> holds wp.png and trc.png (1600², the service name only — the listing cover) and av.png (512², the logo on white).
 *
 * ⛔ PRICES AND TIMES ARE EVISA SAIGON'S OWN QUOTE TO eno (the owner's message above, 2026-11-18), government fees
 * included. Refresh = edit COPY below and re-run. The requirements are the law as read on 2026-11-18 (sources beside each
 * block); nothing here promises a result or a refund — the partner publishes neither.
 *
 * ⛔ PINNED BY SELLER ID AND OWNER EMAIL (scripts/register-partner-seller.mjs `evisasaigon`, an eno-held login). The
 * storefront must be an official partner with no stored phone: buyers reach Evisa Saigon by eno chat, which lands in
 * Admin › Partner inbox.
 *
 * ⛔ LEGAL & PERMITS IS A LICENCE AISLE (taxonomy.ts licenceCheckHold; owner 2026-11-18 chose the check over a whitelist):
 *   · a NEW row is created UNPUBLISHED (verified=false + LICENCE_HELD_NOTE, status active). It goes live once the
 *     registered name and number are entered — scripts/licence-fill-seller.ts --seller=<id> --aisle=legal-permits
 *     --name="CÔNG TY TNHH THƯƠNG MẠI DỊCH VỤ EVISA SAIGON" --number="0317048667" — and an admin approves them under
 *     Admin › Catalogue › Licence checks;
 *   · a re-run's update MERGES the provider values already on the row (withProviderLicence), so the values and the
 *     approval stamp bound to them survive it; it never writes verified, status or the aisle (a stored row elsewhere is
 *     refused), exactly as scripts/seed-hoangphi.ts;
 *   · no serviceLocation: the facet is excluded in licence aisles.
 * ⛔ IDEMPOTENT ON (sellerId, externalId). Images are uploaded on the first run only, or with --reimage.
 */
import 'dotenv/config'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'
import { createClient } from '@supabase/supabase-js'
import { db } from '../src/lib/db'
import { makeImageHost } from '../src/lib/host-product-image'
import { buildSearchText } from '../src/lib/fold'
import { browseRankScore } from '../src/lib/ranking-formula'
import { assertCleanTexts } from '../src/lib/publish-guard'
import { isLicenceCheckSlot, listingMoneyFor, servicePriceBasisApplies, servicePriceBasisOfUnit, subcategoriesFor, withPriceBasis } from '../src/lib/taxonomy'
import { detectContentLang } from '../src/lib/detect-lang'
import { providerLicenceOf, withProviderLicence } from '../src/lib/provider-licence'
import { LICENCE_HELD_NOTE } from '../src/lib/licence-stamp'
import { tombstonePdps } from '../src/lib/pdp-tombstone'
import { enqueuePhotoChecks } from '../src/lib/listing-photo-queue'

const arg = (n: string) => { const eq = process.argv.find((a) => a.startsWith(`--${n}=`)); if (eq) return eq.slice(n.length + 3); const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined }
const APPLY = process.argv.includes('--apply')
const REIMAGE = process.argv.includes('--reimage')
const ASSETS = arg('assets')

const SELLER_ID = 'e3c06e69-4590-4790-8769-ccaac05cfac2'
const OWNER_EMAIL = 'support+evisasaigon@eno.vn'
const HANDLE = 'evisasaigon'
const CATEGORY_SLUG = 'services'
const SUBCATEGORY = 'legal-permits'
const BUCKET = 'listings'

type Service = { externalId: string; image: string; slug: string; price: number; titleEn: string; titleVi: string; descEn: string; descVi: string; keywords: string[] }

// ⚠️ NO Vietnamese-only letters in the English copy (ậ, đ, ơ, ư …): detect-lang.ts would read it as Vietnamese and send it
// through vi→en translation. Place names are written without diacritics there.
const SERVICES: Service[] = [
  {
    externalId: 'evisasaigon:work-permit',
    image: 'wp.png',
    slug: 'evisasaigon-work-permit',
    price: 9_000_000,
    titleEn: 'Work permit in Ho Chi Minh City, 7–9 weeks, government fees included',
    titleVi: 'Làm giấy phép lao động tại TP.HCM, 7–9 tuần, đã gồm lệ phí nhà nước',
    descEn: `Evisa Saigon applies for your Vietnam work permit for a job in Ho Chi Minh City. They check that you qualify, give you the document list for your case, prepare the application with you and your employer, file it and follow it until the permit is issued.

# Price (government fee included)
Standard: 9,000,000 VND, about 7–9 weeks
Fast track: 10,500,000 VND, about 4–5 weeks

Most of the time goes into gathering, legalising and translating documents. Once the file is complete, the authority decides within 10 working days. Costs outside Vietnam, such as legalising papers in your home country, depend on your case: ask Evisa Saigon before you start.

# Who can get one
- 18 or older, healthy enough for the job and not under criminal prosecution
- Qualified for the role as a manager, executive, expert or technical worker. An expert usually needs a university degree and 2 years of related experience; from 5 December 2026, 5 years of related experience without a degree also qualifies
- Hired by a company or organisation that applies for you

Some people are exempt, for example a foreigner married to a Vietnamese citizen, and need an exemption certificate instead. Evisa Saigon checks which applies to you.

# What you prepare
- Passport
- Health certificate issued within the last 12 months
- Criminal record certificate from your home country or Vietnam, issued within the last 6 months
- Degree, and letters from past employers confirming your experience
- 2 colour photos, 4 x 6 cm, white background, no glasses

Foreign documents must be legalised and translated into Vietnamese with a certified translation, unless a treaty exempts them. From 5 December 2026 the passport needs only a copy of its photo page and no legalisation, a health certificate from a clinic abroad is accepted, and so is an electronic criminal record.

# What your employer provides
- The report explaining why the job needs a foreign worker, filed with the permit in one step
- Company documents for your role (for a manager, the appointment)
- Your labour contract, signed after the permit is issued and before you start

# How it works
1. Message Evisa Saigon here on eno with your nationality, job title, employer and start date
2. They confirm you qualify and send your document list
3. They guide you through the health check, legalisation and translations, and prepare your employer's file
4. They file it with the Ho Chi Minh City Department of Home Affairs, or with the management board if your employer is in an industrial park, export processing zone or high-tech park
5. You receive the permit. Next comes your temporary residence card (TRC)

# Good to know
- A work permit lasts up to 2 years and can be extended once, for up to 2 more years. From 5 December 2026, apply for the extension 10 working days to 90 days before it expires
- It covers one employer and one job: a new employer or role needs a new permit
- Apply at least 10 working days and at most 60 days before your start date
- Working without a permit can lead to a fine and deportation
- Rules: Decree 393/2026/ND-CP from 5 December 2026; a file submitted before then follows Decree 219/2025/ND-CP

Evisa Saigon, 385/14 Nguyen Trai, Cau Ong Lanh ward, Ho Chi Minh City. eno introduces Evisa Saigon; the service contract is with them.`,
    descVi: `Evisa Saigon làm giấy phép lao động cho người nước ngoài làm việc tại TP.HCM: kiểm tra điều kiện, gửi danh sách giấy tờ theo trường hợp của bạn, cùng bạn và doanh nghiệp chuẩn bị hồ sơ, nộp và theo dõi đến khi có giấy phép.

# Giá (đã gồm lệ phí nhà nước)
Thường: 9.000.000 đ, khoảng 7–9 tuần
Làm nhanh: 10.500.000 đ, khoảng 4–5 tuần

Phần lớn thời gian dành cho việc chuẩn bị, hợp pháp hóa lãnh sự và dịch thuật giấy tờ. Khi hồ sơ đầy đủ, cơ quan có thẩm quyền giải quyết trong 10 ngày làm việc. Chi phí phát sinh ở nước ngoài, như hợp pháp hóa giấy tờ tại nước bạn, tùy từng trường hợp: hãy hỏi Evisa Saigon trước khi bắt đầu.

# Ai được cấp
- Từ đủ 18 tuổi, đủ sức khỏe theo yêu cầu công việc, không đang bị truy cứu trách nhiệm hình sự
- Đáp ứng điều kiện vị trí nhà quản lý, giám đốc điều hành, chuyên gia hoặc lao động kỹ thuật. Chuyên gia thường cần bằng đại học và 2 năm kinh nghiệm phù hợp; từ ngày 05/12/2026, 5 năm kinh nghiệm phù hợp không cần bằng cấp cũng đủ điều kiện
- Có doanh nghiệp hoặc tổ chức tuyển dụng đứng ra nộp hồ sơ

Một số trường hợp được miễn, ví dụ người nước ngoài kết hôn với công dân Việt Nam; khi đó cần giấy xác nhận không thuộc diện cấp giấy phép lao động. Evisa Saigon kiểm tra trường hợp của bạn.

# Bạn chuẩn bị
- Hộ chiếu
- Giấy chứng nhận sức khỏe cấp trong vòng 12 tháng
- Phiếu lý lịch tư pháp của nước bạn hoặc của Việt Nam, cấp trong vòng 6 tháng
- Bằng cấp và văn bản xác nhận kinh nghiệm của nơi bạn từng làm
- 2 ảnh màu 4 x 6 cm, nền trắng, không đeo kính

Giấy tờ nước ngoài phải hợp pháp hóa lãnh sự và dịch sang tiếng Việt có chứng thực, trừ khi được miễn theo điều ước quốc tế. Từ ngày 05/12/2026, hộ chiếu chỉ cần bản chụp trang thông tin và không phải hợp pháp hóa, chấp nhận giấy chứng nhận sức khỏe do cơ sở y tế nước ngoài cấp và phiếu lý lịch tư pháp điện tử.

# Doanh nghiệp cung cấp
- Báo cáo giải trình nhu cầu sử dụng người lao động nước ngoài, nộp cùng hồ sơ cấp giấy phép trong một bước
- Giấy tờ chứng minh vị trí công việc (với nhà quản lý: văn bản bổ nhiệm)
- Hợp đồng lao động, ký sau khi có giấy phép và trước ngày bắt đầu làm việc

# Quy trình
1. Nhắn Evisa Saigon trên eno: quốc tịch, chức danh, doanh nghiệp và ngày dự kiến bắt đầu làm việc
2. Evisa Saigon xác nhận điều kiện và gửi danh sách giấy tờ
3. Hướng dẫn khám sức khỏe, hợp pháp hóa, dịch thuật và chuẩn bị hồ sơ cho doanh nghiệp
4. Nộp hồ sơ tại Sở Nội vụ TP.HCM, hoặc Ban quản lý nếu doanh nghiệp ở khu công nghiệp, khu chế xuất, khu công nghệ cao
5. Nhận giấy phép. Bước tiếp theo là làm thẻ tạm trú (TRC)

# Cần biết
- Giấy phép lao động có thời hạn tối đa 2 năm, được gia hạn 1 lần, tối đa 2 năm. Từ ngày 05/12/2026, nộp hồ sơ gia hạn trước khi hết hạn từ 10 ngày làm việc đến 90 ngày
- Giấy phép gắn với một doanh nghiệp và một vị trí: đổi doanh nghiệp hoặc vị trí phải xin giấy phép mới
- Nộp hồ sơ trước ngày bắt đầu làm việc ít nhất 10 ngày làm việc và không quá 60 ngày
- Làm việc không có giấy phép có thể bị phạt tiền và trục xuất
- Căn cứ: Nghị định 393/2026/NĐ-CP từ ngày 05/12/2026; hồ sơ nộp trước ngày này theo Nghị định 219/2025/NĐ-CP

Evisa Saigon, 385/14 Nguyễn Trãi, phường Cầu Ông Lãnh, TP.HCM. eno giới thiệu Evisa Saigon; hợp đồng dịch vụ ký trực tiếp với Evisa Saigon.`,
    keywords: ['work permit', 'giay phep lao dong', 'GPLD', 'work permit vietnam', 'work permit hcmc', 'foreign worker'],
  },
  {
    externalId: 'evisasaigon:trc',
    image: 'trc.png',
    slug: 'evisasaigon-the-tam-tru',
    price: 10_500_000,
    titleEn: 'Temporary residence card (TRC) in Ho Chi Minh City, 14 days, government fees included',
    titleVi: 'Làm thẻ tạm trú (TRC) tại TP.HCM, 14 ngày, đã gồm lệ phí nhà nước',
    descEn: `Evisa Saigon applies for your temporary residence card (TRC) once you hold a Vietnam work permit. The card is your permission to live in Vietnam, and you enter and leave the country on it for as long as it is valid.

# Price (government fee included)
Standard: 10,500,000 VND, about 14 days
Fast track: 11,500,000 VND, about 4 days

The government fee for a card valid up to 2 years is 145 USD, included in the price.

# Who can get one
- Work permit holders (card type LD2), or people with a work permit exemption certificate (LD1)
- Sponsored by the employer named on the permit, which must have registered its company file with the immigration office
- Living in Vietnam, with your address declared to the ward police (your landlord or hotel does this)

# What you prepare
- Passport (the original)
- Work permit or exemption certificate
- 2 photos, 2 x 3 cm
- Your employer signs and stamps the request forms (NA6 and NA8), which Evisa Saigon fills in

# How it works
1. Message Evisa Saigon here on eno with your passport expiry date, work permit dates and home address
2. They check your passport, your address declaration and your employer's registration
3. They prepare the forms for your employer to sign and file them with the Ho Chi Minh City Police Immigration Office
4. You get the card and your passport back; Evisa Saigon can deliver them to your door

# Good to know
- A work TRC lasts up to 2 years and usually follows your work permit's dates
- It must end at least 30 days before your passport does, so renew a passport that is close to expiry first
- Your passport stays with the immigration office while the card is made: plan no trips abroad in that time
- Your spouse and children under 18 can then apply for family TRCs (type TT)
- A new employer means a new work permit, then a new TRC
- Rules: Law on Entry, Exit, Transit and Residence of Foreigners in Vietnam (No. 47/2014/QH13, as amended); fees under Circular 28/2026/TT-BTC

Evisa Saigon, 385/14 Nguyen Trai, Cau Ong Lanh ward, Ho Chi Minh City. eno introduces Evisa Saigon; the service contract is with them.`,
    descVi: `Evisa Saigon làm thẻ tạm trú (TRC) cho người nước ngoài đã có giấy phép lao động. Thẻ tạm trú cho phép bạn cư trú tại Việt Nam, và bạn xuất cảnh, nhập cảnh bằng thẻ trong suốt thời hạn của thẻ.

# Giá (đã gồm lệ phí nhà nước)
Thường: 10.500.000 đ, khoảng 14 ngày
Làm nhanh: 11.500.000 đ, khoảng 4 ngày

Lệ phí nhà nước cho thẻ có thời hạn đến 2 năm là 145 USD, đã gồm trong giá.

# Ai được cấp
- Người có giấy phép lao động (thẻ ký hiệu LĐ2), hoặc có giấy xác nhận không thuộc diện cấp giấy phép lao động (LĐ1)
- Được doanh nghiệp ghi trên giấy phép bảo lãnh; doanh nghiệp phải đã nộp hồ sơ giới thiệu với cơ quan quản lý xuất nhập cảnh
- Đang cư trú tại Việt Nam và đã được khai báo tạm trú với công an phường (chủ nhà hoặc khách sạn khai báo)

# Bạn chuẩn bị
- Hộ chiếu bản gốc
- Giấy phép lao động hoặc giấy xác nhận miễn
- 2 ảnh 2 x 3 cm
- Doanh nghiệp ký, đóng dấu tờ khai NA6 và NA8 do Evisa Saigon soạn sẵn

# Quy trình
1. Nhắn Evisa Saigon trên eno: ngày hết hạn hộ chiếu, thời hạn giấy phép lao động và địa chỉ đang ở
2. Evisa Saigon kiểm tra hộ chiếu, khai báo tạm trú và hồ sơ của doanh nghiệp
3. Soạn tờ khai cho doanh nghiệp ký và nộp tại Phòng Quản lý xuất nhập cảnh Công an TP.HCM
4. Nhận thẻ và hộ chiếu; Evisa Saigon có thể giao tận nơi

# Cần biết
- Thẻ tạm trú diện lao động có thời hạn tối đa 2 năm, thường theo thời hạn giấy phép lao động
- Thẻ phải hết hạn trước hộ chiếu ít nhất 30 ngày: hộ chiếu sắp hết hạn thì nên đổi trước
- Hộ chiếu được giữ tại cơ quan xuất nhập cảnh trong thời gian làm thẻ, nên tránh đi nước ngoài lúc này
- Vợ hoặc chồng và con dưới 18 tuổi của bạn có thể làm thẻ tạm trú diện thăm thân (TT)
- Đổi doanh nghiệp thì cần giấy phép lao động mới, rồi làm thẻ tạm trú mới
- Căn cứ: Luật Nhập cảnh, xuất cảnh, quá cảnh, cư trú của người nước ngoài tại Việt Nam (Luật 47/2014/QH13 và các luật sửa đổi); lệ phí theo Thông tư 28/2026/TT-BTC

Evisa Saigon, 385/14 Nguyễn Trãi, phường Cầu Ông Lãnh, TP.HCM. eno giới thiệu Evisa Saigon; hợp đồng dịch vụ ký trực tiếp với Evisa Saigon.`,
    keywords: ['temporary residence card', 'TRC', 'the tam tru', 'residence card vietnam', 'LD1', 'LD2'],
  },
]

async function main() {
  console.log(`${APPLY ? 'APPLY' : 'DRY RUN'} — Evisa Saigon: ${SERVICES.length} listings in ${CATEGORY_SLUG}/${SUBCATEGORY}\n`)

  // 1. Copy screens — the ones a seller's own post goes through (phone, contact info, banned words) — and the limits.
  for (const s of SERVICES) {
    if (s.descEn.startsWith('__') || s.descVi.startsWith('__')) throw new Error(`${s.externalId}: description not written`)
    assertCleanTexts([s.titleEn, s.titleVi, s.descEn, s.descVi])
    if (s.titleEn.length > 140 || s.titleVi.length > 140) throw new Error(`${s.externalId}: title over 140 chars`)
    if (s.descEn.length > 5000 || s.descVi.length > 5000) throw new Error(`${s.externalId}: description over 5000 chars (en ${s.descEn.length}, vi ${s.descVi.length})`)
    for (const [k, t] of [['title_en', s.titleEn], ['desc_en', s.descEn]] as const) {
      if (detectContentLang(t) === 'vi') throw new Error(`${s.externalId} ${k} reads as Vietnamese to detect-lang — remove Vietnamese-only letters`)
    }
    console.log(`copy screens: clean · ${s.externalId} · title en ${s.titleEn.length} / vi ${s.titleVi.length} · desc en ${s.descEn.length} / vi ${s.descVi.length}`)
  }
  if (!subcategoriesFor(CATEGORY_SLUG).some((sc) => sc.slug === SUBCATEGORY)) throw new Error(`"${SUBCATEGORY}" is not a ${CATEGORY_SLUG} subcategory`)
  const licenceAisle = isLicenceCheckSlot(CATEGORY_SLUG, SUBCATEGORY)
  if (!licenceAisle) throw new Error(`${SUBCATEGORY} is expected to be a licence aisle — refusing (the header's hold no longer holds)`)

  // 2. The seller — by id AND owner email, never by name.
  const seller = await db.seller.findUnique({ where: { id: SELLER_ID }, select: { id: true, name: true, ownerId: true, officialPartner: true, trustScore: true, phone: true, avatarUrl: true, handle: { select: { handle: true } } } })
  if (!seller?.ownerId) throw new Error(`seller ${SELLER_ID} not found or ownerless`)
  const owner = await db.profile.findUnique({ where: { id: seller.ownerId }, select: { email: true, accountType: true } })
  if (owner?.email !== OWNER_EMAIL) throw new Error(`seller ${SELLER_ID} is owned by ${owner?.email ?? '?'}, not ${OWNER_EMAIL}`)
  if (seller.handle?.handle !== HANDLE) throw new Error(`seller's handle is /${seller.handle?.handle ?? '(none)'}, not /${HANDLE}`)
  if (!seller.officialPartner) throw new Error('seller is not an official partner — run scripts/set-official-partner.mjs evisasaigon --apply first')
  if (seller.phone) throw new Error('seller has a stored phone — partners never show one')
  if (owner.accountType !== 'business') throw new Error(`owner accountType is ${owner.accountType}, not business`)
  console.log(`seller: "${seller.name}" (${seller.id}) /${HANDLE}, owned by ${owner.email}`)

  // 3. Category + existing rows (never moved: a stored row must already sit in this aisle).
  const category = await db.category.findUnique({ where: { slug: CATEGORY_SLUG }, select: { id: true, name: true, nameVi: true } })
  if (!category) throw new Error(`category "${CATEGORY_SLUG}" not found`)
  const existing = new Map<string, { id: string; images: string; status: string; subcategorySlug: string | null }>()
  for (const s of SERVICES) {
    const row = await db.listing.findFirst({ where: { sellerId: SELLER_ID, externalId: s.externalId }, select: { id: true, images: true, status: true, subcategorySlug: true, categoryId: true } })
    if (row && (row.subcategorySlug !== SUBCATEGORY || row.categoryId !== category.id)) throw new Error(`listing ${row.id} is in "${row.categoryId}/${row.subcategorySlug ?? '(none)'}", not "${CATEGORY_SLUG}/${SUBCATEGORY}" — refusing to move it`)
    if (row) existing.set(s.externalId, row)
    console.log(`listing ${s.externalId}: ${row ? `exists (${row.id}, ${row.status}) — will update copy${REIMAGE ? ' and image' : ''}` : 'new — stored UNPUBLISHED until the licence check approves it'}`)
  }

  // 4. Assets.
  if (!ASSETS) throw new Error('--assets <dir> required')
  for (const f of [...SERVICES.map((s) => s.image), 'av.png']) {
    if (!existsSync(join(ASSETS, f))) throw new Error(`missing ${join(ASSETS, f)}`)
    const m = await sharp(join(ASSETS, f)).metadata()
    console.log(`  ${f.padEnd(8)} ${m.width}x${m.height} ${m.format}`)
  }

  const money = listingMoneyFor({ categorySlug: CATEGORY_SLUG, listingType: 'service' } as Parameters<typeof listingMoneyFor>[0])
  if (!APPLY) { console.log(`\ncurrency ${money.currency} (${money.priceUnit}) · prices ${SERVICES.map((s) => s.price.toLocaleString('vi-VN')).join(' / ')}\nDRY RUN — re-run with --apply.`); await db.$disconnect(); return }

  // ── writes ─────────────────────────────────────────────────────────────────────────────────────────
  const storageUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/+$/, '')
  const secret = process.env.SUPABASE_SECRET_KEY
  if (!storageUrl || !secret) throw new Error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY required')
  if (/supabase\.co$/.test(new URL(storageUrl).hostname)) throw new Error(`Refusing to upload to ${storageUrl} — retired project`)
  const storage = createClient(storageUrl, secret, { auth: { persistSession: false } }).storage.from(BUCKET)

  // Avatar: the logo on white, no eno mark (src/lib/core/media.ts: never on a shop's logo). First run or --reimage only.
  if (REIMAGE || !seller.avatarUrl) {
    if (seller.avatarUrl) console.log(`avatar: replacing (previous, for rollback: ${seller.avatarUrl})`)
    const name = `partner/avatar-${SELLER_ID}-${Date.now().toString(36)}.webp`
    const buf = await sharp(join(ASSETS, 'av.png')).flatten({ background: '#ffffff' }).resize(512, 512, { fit: 'cover' }).webp({ quality: 92 }).toBuffer()
    const { error } = await storage.upload(name, buf, { contentType: 'image/webp', upsert: false, cacheControl: '31536000' })
    if (error) throw new Error(`upload ${name}: ${error.message}`)
    await db.seller.update({ where: { id: SELLER_ID }, data: { avatarUrl: `${storageUrl}/storage/v1/object/public/${BUCKET}/${name}` } })
    console.log('avatar: set')
  }

  // Gallery — stored CLEAN under affiliate/m/ so the app draws the eno.vn mark (never burned in), as Hoàng Phi's.
  const host = makeImageHost({ storage, storageUrl, bucket: BUCKET, edge: 1600, quality: 86, mark: 'overlay' })
  const baseAttributes = JSON.stringify({ providerType: 'business' })
  const attributes = servicePriceBasisApplies(CATEGORY_SLUG, SUBCATEGORY) ? withPriceBasis(baseAttributes, servicePriceBasisOfUnit(money.priceUnit)) : baseAttributes
  const touched: string[] = []
  // ⛔ In a finally (listing-photo-queue.test.ts O6): a throw on a later row still queues the rows already written.
  try {
    for (const s of SERVICES) {
      const prior = existing.get(s.externalId)
      let images = prior?.images
      if (!prior || REIMAGE || !images || images === '[]') {
        if (prior && images && images !== '[]') console.log(`${s.externalId}: replacing gallery (previous, for rollback: ${images})`)
        const u = await host.fromBuffer(readFileSync(join(ASSETS, s.image)), s.slug)
        if (!u) throw new Error(`image host failed for ${s.image} — nothing written for ${s.externalId}`)
        images = JSON.stringify([u])
      }
      // ⚠️ NO subcategorySlug HERE: `fields` is the UPDATE too, and a re-run never moves the row (header). The create sets it.
      const fields = {
        title: s.titleEn, titleVi: s.titleVi, description: s.descEn, descriptionVi: s.descVi,
        price: s.price, priceUnit: money.priceUnit, currency: money.currency, negotiable: false,
        condition: null, listingType: 'service', brandSlug: null, model: null,
        // The office is in the former District 1 (now phường Cầu Ông Lãnh); the area chips key on the district name.
        // No coordinates: a wrong pin is worse than the approximate-area map.
        location: 'Quận 1', district: 'Quận 1', city: 'Hồ Chí Minh',
        images: images!, affiliateUrl: null, sellerTrustScore: seller.trustScore,
        searchText: buildSearchText([s.titleEn, s.titleVi, s.descEn, s.descVi, category.name, category.nameVi, 'Evisa Saigon', ...s.keywords]),
      }
      // The provider values (and so the approval stamp) are carried over, never wiped by a re-run (header) — READ IN THE SAME
      // TRANSACTION as the write, under a row lock, so a licence-fill-seller.ts run that landed after step 3 is not
      // overwritten with what this run read earlier (plan review, 2026-11-18).
      const id = await db.$transaction(async (tx) => {
        const [fresh] = await tx.$queryRaw<{ attributes: string | null }[]>`SELECT "attributes" FROM "Listing" WHERE "sellerId" = ${SELLER_ID} AND "externalId" = ${s.externalId} FOR UPDATE`
        const r = await tx.listing.upsert({
        where: { sellerId_externalId: { sellerId: SELLER_ID, externalId: s.externalId } },
        update: { ...fields, attributes: withProviderLicence(attributes, providerLicenceOf(fresh?.attributes)) },
        select: { id: true },
        create: {
          ...fields, categoryId: category.id, subcategorySlug: SUBCATEGORY, sellerId: SELLER_ID, externalId: s.externalId, attributes,
          // ⛔ Held in a licence aisle until the values are approved (header) — a literal, so the publish-path audit
          // (compliance/public-state-writes.test.ts) still sees both branches — carrying the hold's mark, so the approval
          // publishes it (src/lib/licence-stamp.ts LICENCE_HELD_NOTE).
          ...(isLicenceCheckSlot(CATEGORY_SLUG, SUBCATEGORY) ? { verified: false, verificationNotes: LICENCE_HELD_NOTE } : { verified: true }), status: 'active',
          rankScore: browseRankScore({ sellerTrustScore: seller.trustScore, postedAt: new Date(), featured: false }),
        },
        })
        return r.id
      })
      touched.push(id)
      // A re-run edits copy on a row that may already be live: its 30-day PDP must re-render (src/lib/pdp-tombstone.ts) —
      // per row, at once, so a later row's failure cannot leave this one's page stale.
      console.log(`APPLIED: ${s.externalId} → /listings/${id} · PDP tombstones: ${await tombstonePdps(db, [id])}`)
    }
  } finally {
    // New or replaced photos go through the photo check like every script-written one (listing-photo-queue.ts).
    if (APPLY) await enqueuePhotoChecks(db, touched)
  }
  console.log(`\nNEXT: scripts/licence-fill-seller.ts --seller=${SELLER_ID} --aisle=${SUBCATEGORY} --name=… --number=… --apply, then Admin › Catalogue › Licence checks › Approve.`)
  // ⛔ A takedown that files no report must null the licence mark too, or a later 'licence-approve' republishes it (CLAUDE.md).
  console.log(`Rollback: UPDATE "Listing" SET status='hidden', verified=false, "verificationNotes"=NULL, "verificationMethod"=NULL, "verifiedAt"=NULL WHERE "sellerId"='${SELLER_ID}' AND "externalId" LIKE 'evisasaigon:%'; then tombstone ${touched.join(', ')} (src/lib/pdp-tombstone.ts) and purge Cloudflare by tag.`)
  await db.$disconnect()
}
main().catch(async (e) => { console.error(e instanceof Error ? e.message : e); await db.$disconnect(); process.exit(1) })
