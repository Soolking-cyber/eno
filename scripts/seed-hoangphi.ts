/**
 * Luật Hoàng Phi's company-formation offer, posted from the lawyer's review account (owner, 2026-10-01:
 * "add product offer posted from lawyer-review@eno.vn about their company open service with prices etc
 * get their logo"). Turns the account's storefront into the firm's own: name, bio, avatar, banners,
 * /luathoangphi handle, and ONE services listing.
 *
 *   npx tsx scripts/seed-hoangphi.ts --assets <dir>            # DRY RUN — screens the copy, renders nothing remote
 *   npx tsx scripts/seed-hoangphi.ts --assets <dir> --apply    # uploads the images and writes the rows
 *
 * <dir> holds the artwork rendered from the firm's own published logo: cover.png, pk.png, pr.png (1600²,
 * the listing gallery), av.png (512², avatar), bn.png (2560×600) and bm.png (732×376) (storefront banners).
 *
 * ⛔ EVERY PRICE AND INCLUSION IS THE FIRM'S OWN PUBLIC PRICE LIST — https://luathoangphi.vn/thanh-lap-cong-ty/
 * (published 2026-04-28, modified 2026-05-14, read 2026-10-01). The owner chose the public list over a private
 * quote (2026-10-01). Refresh = re-read that page, edit COPY below, re-run. Things the site does NOT publish are
 * deliberately not claimed: VAT and state fees (said to be confirmed in the quote), a founding year, a refund
 * promise, the "85% of customers" / "only 5 slots today" marketing.
 *
 * ⛔ PINNED BY ID AND BY OWNER EMAIL. `Seller.name` is not unique and is user-settable; the storefront this
 * rewrites must be exactly the one owned by lawyer-review@eno.vn. Anything else refuses.
 * ⚠️ officialPartner stays TRUE on this seller for two reasons: the firm holds a signed service agreement with
 * eno (the owner's 2026-10-01 partner rule), and password sign-in for the review account requires it
 * (scripts/register-play-reviewer.mjs). Partners never show a phone: buyers reach the firm through eno chat,
 * which lands in the lawyer-review inbox.
 * ⚠️ legalName / taxCode are NOT set: the firm's site names two entities ("Công ty Luật TNHH Luật Hoàng Phi" in
 * its JSON-LD, "Công ty TNHH Tư vấn đầu tư & Sở hữu trí tuệ Hoàng Phi" on its about page) and publishes no tax
 * code or licence number. The lawyer supplies them; guessing would print a false legal-entity claim.
 *
 * ⛔ IDEMPOTENT ON (sellerId, externalId='hoangphi:company-formation'). status / verified / rankScore are
 * CREATE-ONLY so a moderator's hide survives a re-run; images are re-uploaded only with --reimage.
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
import { validateHandle } from '../src/lib/handle-format'
import { subdomainKey } from '../src/lib/storefront-host'
import { listingMoneyFor, subcategoriesFor } from '../src/lib/taxonomy'
import { detectContentLang } from '../src/lib/detect-lang'

const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined }
const APPLY = process.argv.includes('--apply')
const REIMAGE = process.argv.includes('--reimage')
const ASSETS = arg('assets')

const SELLER_ID = 'ce7bc637ebae789c6bfa01644'
const OWNER_EMAIL = 'lawyer-review@eno.vn'
const HANDLE = 'luathoangphi'
const EXTERNAL_ID = 'hoangphi:company-formation'
const CATEGORY_SLUG = 'services'
// ⚠️ `service-other` until a business/legal aisle exists — `visa-legal` renders as "Visa" and is a boundary
// surface on eno.vn (taxonomy.ts), so it is the one services aisle this must NOT go in.
const SUBCATEGORY = arg('subcategory') ?? 'service-other'
const BUCKET = 'listings'

const SELLER = {
  name: 'Luật Hoàng Phi',
  avatarColor: '#0071B8',
  location: 'TP. Hồ Chí Minh · Hà Nội',
  bio: [
    'Hãng luật tư vấn pháp lý doanh nghiệp: thành lập công ty, thay đổi đăng ký kinh doanh, hộ kinh doanh, công ty vốn nước ngoài.',
    '',
    'Văn phòng TP.HCM: Lầu 11, Block A, Tòa nhà Sky Center, 5B Phổ Quang, phường Tân Sơn Hòa.',
    'Văn phòng Hà Nội: Tòa nhà F4, 112 Trung Kính, phường Yên Hòa.',
    'Giờ làm việc: Thứ 2 – Thứ 7, 08:00 – 18:00.',
    '',
    'Hoang Phi is a Vietnamese law practice for company matters: company formation, registration changes, household businesses and foreign-invested companies. Message us on eno for advice and a quote.',
  ].join('\n'),
}

const TITLE_VI = 'Dịch vụ thành lập công ty: 3 gói, phí dịch vụ từ 1.499.000 đ'
const TITLE_EN = 'Company formation service in Vietnam: 3 packages, service fee from 1,499,000 VND'
const PRICE = 1_499_000

const DESC_VI = `Luật Hoàng Phi nhận thành lập công ty: tư vấn, soạn hồ sơ, đại diện nộp hồ sơ và làm việc với cơ quan nhà nước. Bạn chuẩn bị căn cước công dân, tên công ty, địa chỉ, ngành nghề và vốn điều lệ; Luật Hoàng Phi lo thủ tục, hỗ trợ 100% online.

# Phí dịch vụ (bảng giá Luật Hoàng Phi công bố, cập nhật 05/2026)
Gói Cơ bản: 1.499.000 đ — 8–9 ngày làm việc
Gói Phổ thông: 2.799.000 đ — 7–8 ngày làm việc
Gói Tối ưu: 3.799.000 đ — nhiều quyền lợi nhất

Giá trên là phí dịch vụ, chưa gồm thuế GTGT và lệ phí nhà nước (nếu có); các khoản này được báo rõ trong báo giá trước khi ký hợp đồng. Cần làm nhanh 1–3 ngày thì có tính thêm phí.

# Cả 3 gói đều có
✓ Giấy chứng nhận đăng ký doanh nghiệp
✓ Mã số thuế, mã số xuất nhập khẩu
✓ Công bố thông tin doanh nghiệp
✓ Dấu tròn công ty và dấu chức danh Giám đốc
✓ Hồ sơ nội bộ: điều lệ, danh sách thành viên, quyết định bổ nhiệm
✓ Hỗ trợ mở tài khoản ngân hàng

# Gói Phổ thông có thêm
✓ Biển hiệu công ty
✓ Chữ ký số 1 năm và 500 hóa đơn điện tử
✓ Tư vấn kế toán – thuế giai đoạn đầu (01 tháng)

# Gói Tối ưu có thêm
✓ Biển hiệu công ty
✓ Chữ ký số 3 năm và 500 hóa đơn điện tử
✓ Hỗ trợ kê khai thuế ban đầu
✓ Miễn phí kê khai báo cáo thuế quý đầu tiên
✓ Tư vấn kế toán – thuế giai đoạn đầu (03 tháng)

# Quy trình 5 bước
1. Tiếp nhận: bạn nhắn yêu cầu, nhận báo giá trước khi làm
2. Tư vấn: loại hình, tên công ty (tra cứu tránh trùng), ngành nghề, vốn điều lệ
3. Hồ sơ: soạn hồ sơ, đại diện nộp và theo dõi xử lý
4. Kết quả: Giấy chứng nhận đăng ký doanh nghiệp sau khoảng 3–5 ngày làm việc khi hồ sơ hợp lệ
5. Hỗ trợ sau thành lập: dấu, ngân hàng, chữ ký số, thuế ban đầu theo gói

# Bạn cần chuẩn bị
- Căn cước công dân của chủ sở hữu, các thành viên
- Tên công ty dự kiến
- Địa chỉ trụ sở rõ ràng (không đặt tại căn hộ chung cư để ở)
- Ngành nghề kinh doanh và vốn điều lệ dự kiến
- Hợp đồng thuê hoặc mượn địa điểm khi phát hành hóa đơn

# Luật Hoàng Phi cam kết
- Tư vấn miễn phí bởi luật sư, báo giá trước khi làm
- Không phát sinh chi phí ngoài báo giá
- Chỉ ký hợp đồng và thu phí khi bạn đồng ý; thanh toán trực tiếp hoặc chuyển khoản
- Không cần đi lại, nhận kết quả tận nơi
- Bảo mật thông tin, hỗ trợ sau khi thành lập

# Dịch vụ liên quan
Thay đổi đăng ký kinh doanh: từ 1.000.000 đ đến 1.700.000 đ tùy nội dung
Thành lập hộ kinh doanh: từ 499.000 đ
Công ty vốn nước ngoài, liên doanh: báo giá theo hồ sơ

# Văn phòng
TP.HCM: Lầu 11, Block A, Tòa nhà Sky Center, 5B Phổ Quang, phường Tân Sơn Hòa
Hà Nội: Tòa nhà F4, 112 Trung Kính, phường Yên Hòa
Giờ làm việc: Thứ 2 – Thứ 7, 08:00 – 18:00

Nhắn tin cho Luật Hoàng Phi ngay trên eno để được tư vấn và nhận báo giá.`

// ⚠️ NO Vietnamese-exclusive letters in the English copy (ậ, đ, ơ, ư …): detect-lang.ts would read the
// English text as Vietnamese and send it through vi→en translation. Names are written without diacritics.
const DESC_EN = `Hoang Phi (Luat Hoang Phi) registers your company for you: advice, preparing the file, submitting it on your behalf and dealing with the authorities. You provide the ID cards, company name, address, business lines and charter capital; Hoang Phi handles the procedure, fully online.

# Service fees (Hoang Phi's published price list, updated May 2026)
Basic: 1,499,000 VND — 8–9 working days
Standard: 2,799,000 VND — 7–8 working days
Complete: 3,799,000 VND — the most extensive package

These are service fees. VAT and state fees, where they apply, are not included and are stated in the quote before you sign. A rush filing in 1–3 days costs extra.

# Included in all 3 packages
✓ Enterprise registration certificate
✓ Tax code and import-export code
✓ Public announcement of the company's details
✓ Company seal and Director's title stamp
✓ Internal records: charter, member list, appointment decisions
✓ Help opening a company bank account

# Standard adds
✓ Company signboard
✓ Digital signature for 1 year and 500 e-invoices
✓ Early-stage accounting and tax advice (1 month)

# Complete adds
✓ Company signboard
✓ Digital signature for 3 years and 500 e-invoices
✓ Initial tax registration filings
✓ First quarterly tax report filed free of charge
✓ Early-stage accounting and tax advice (3 months)

# How it works, in 5 steps
1. Request: send your request and get a quote before any work starts
2. Advice: company type, name (checked for duplicates), business lines, capital
3. Filing: the file is prepared, submitted on your behalf and followed up
4. Result: the enterprise registration certificate in about 3–5 working days once the file is valid
5. After formation: seal, bank account, digital signature, initial tax steps, depending on the package

# What you need to prepare
- ID cards of the owner and members
- Your proposed company name
- A clear head-office address (not a residential apartment)
- Business lines and planned charter capital
- A lease or loan agreement for the premises when you start issuing invoices

# Hoang Phi's commitments
- Free advice from a lawyer, and a quote before any work
- No costs beyond the quote
- You sign and pay only once you agree; pay in person or by bank transfer
- No need to visit an office; results delivered to you
- Confidential handling, and support after formation

# Related services
Registration changes: from 1,000,000 to 1,700,000 VND depending on the change
Household business registration: from 499,000 VND
Foreign-invested companies and joint ventures: quoted per case

# Offices
Ho Chi Minh City: Floor 11, Block A, Sky Center Building, 5B Pho Quang, Tan Son Hoa Ward
Hanoi: F4 Building, 112 Trung Kinh, Yen Hoa Ward
Hours: Monday to Saturday, 08:00 – 18:00

Message Hoang Phi on eno for advice and a quote.`

async function main() {
  console.log(`${APPLY ? 'APPLY' : 'DRY RUN'} — Luật Hoàng Phi storefront + 1 listing (subcategory ${SUBCATEGORY})\n`)

  // 1. Copy screens — the same ones a seller's own post goes through (phone, contact info, banned words).
  assertCleanTexts([TITLE_VI, TITLE_EN, DESC_VI, DESC_EN, SELLER.bio, SELLER.name, SELLER.location])
  if (TITLE_EN.length > 140 || TITLE_VI.length > 140) throw new Error('title over 140 chars')
  if (DESC_EN.length > 5000 || DESC_VI.length > 5000) throw new Error(`description over 5000 chars (en ${DESC_EN.length}, vi ${DESC_VI.length})`)
  for (const [k, t] of [['title_en', TITLE_EN], ['desc_en', DESC_EN]] as const) {
    if (detectContentLang(t) === 'vi') throw new Error(`${k} reads as Vietnamese to detect-lang — remove Vietnamese-only letters`)
  }
  console.log(`copy screens: clean · title en ${TITLE_EN.length} / vi ${TITLE_VI.length} · desc en ${DESC_EN.length} / vi ${DESC_VI.length}`)

  if (!subcategoriesFor(CATEGORY_SLUG).some((sc) => sc.slug === SUBCATEGORY)) { console.error(`"${SUBCATEGORY}" is not a ${CATEGORY_SLUG} subcategory — refusing`); process.exit(1) }
  if (SUBCATEGORY === 'visa-legal') { console.error('visa-legal renders as "Visa" — a boundary aisle on eno.vn; refusing'); process.exit(1) }

  // 2. The seller — by id AND owner email, never by name.
  const seller = await db.seller.findUnique({
    where: { id: SELLER_ID },
    select: { id: true, name: true, ownerId: true, officialPartner: true, trustScore: true, phone: true, avatarUrl: true, handle: { select: { handle: true } } },
  })
  if (!seller || !seller.ownerId) { console.error(`seller ${SELLER_ID} not found or ownerless — refusing`); process.exit(1) }
  const owner = await db.profile.findUnique({ where: { id: seller.ownerId }, select: { id: true, email: true, accountType: true } })
  if (owner?.email !== OWNER_EMAIL) { console.error(`seller ${SELLER_ID} is owned by ${owner?.email ?? '?'}, not ${OWNER_EMAIL} — refusing`); process.exit(1) }
  if (!seller.officialPartner) { console.error('seller is not an official partner — the review account needs the flag for password sign-in; refusing'); process.exit(1) }
  if (seller.phone) { console.error('seller has a stored phone — partners never show one; refusing until it is cleared'); process.exit(1) }
  console.log(`seller: "${seller.name}" (${seller.id}) owned by ${owner.email}, accountType ${owner.accountType} → "${SELLER.name}", business`)

  // 3. Handle.
  if (seller.handle && seller.handle.handle !== HANDLE) { console.error(`seller already has /${seller.handle.handle}, not /${HANDLE} — refusing to guess which the storefront should use`); process.exit(1) }
  if (seller.handle) console.log(`handle: already /${seller.handle.handle}`)
  else {
    const problem = validateHandle(HANDLE)
    if (problem) { console.error(`handle "${HANDLE}" is ${problem} — refusing`); process.exit(1) }
    const taken = await db.$queryRaw<{ handle: string }[]>`SELECT "handle" FROM "Handle" WHERE replace("handle", '_', '') = ${subdomainKey(HANDLE)}`
    if (taken.length) { console.error(`/${HANDLE} is already taken (by /${taken[0].handle}) — refusing`); process.exit(1) }
    console.log(`handle: /${HANDLE} is free`)
  }

  // 4. Category + existing row.
  const category = await db.category.findUnique({ where: { slug: CATEGORY_SLUG }, select: { id: true, name: true, nameVi: true } })
  if (!category) { console.error(`category "${CATEGORY_SLUG}" not found`); process.exit(1) }
  const existing = await db.listing.findFirst({ where: { sellerId: SELLER_ID, externalId: EXTERNAL_ID }, select: { id: true, images: true, status: true } })
  console.log(`listing: ${existing ? `exists (${existing.id}, ${existing.status}) — will update copy${REIMAGE ? ' and images' : ''}` : 'new'}`)

  // 5. Assets.
  if (!ASSETS) { console.error('--assets <dir> required'); process.exit(1) }
  const need = ['cover.png', 'pk.png', 'pr.png', 'av.png', 'bn.png', 'bm.png']
  for (const f of need) if (!existsSync(join(ASSETS, f))) { console.error(`missing ${join(ASSETS, f)}`); process.exit(1) }
  for (const f of need) { const m = await sharp(join(ASSETS, f)).metadata(); console.log(`  ${f.padEnd(10)} ${m.width}x${m.height} ${m.format}`) }

  const money = listingMoneyFor({ categorySlug: CATEGORY_SLUG, listingType: 'service' } as Parameters<typeof listingMoneyFor>[0])
  if (!APPLY) { console.log(`\nprice ${PRICE.toLocaleString('vi-VN')} ${money.currency} (${money.priceUnit})\nDRY RUN — re-run with --apply.`); await db.$disconnect(); return }

  // ── writes ─────────────────────────────────────────────────────────────────────────────────────────
  const storageUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/+$/, '')
  const secret = process.env.SUPABASE_SECRET_KEY
  if (!storageUrl || !secret) { console.error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY required'); process.exit(1) }
  if (/supabase\.co$/.test(new URL(storageUrl).hostname)) { console.error(`Refusing to upload to ${storageUrl} — retired project`); process.exit(1) }
  const storage = createClient(storageUrl, secret, { auth: { persistSession: false } }).storage.from(BUCKET)
  const pub = (name: string) => `${storageUrl}/storage/v1/object/public/${BUCKET}/${name}`
  const put = async (name: string, buf: Buffer) => {
    const { error } = await storage.upload(name, buf, { contentType: 'image/webp', upsert: false, cacheControl: '31536000' })
    if (error) throw new Error(`upload ${name}: ${error.message}`)
    return pub(name)
  }
  const ts = Date.now().toString(36)

  // Gallery — stored CLEAN under affiliate/m/ so the app draws the eno.vn mark (never burned in).
  let images = existing?.images
  if (!existing || REIMAGE || !images || images === '[]') {
    const host = makeImageHost({ storage, storageUrl, bucket: BUCKET, edge: 1600, quality: 86, mark: 'overlay' })
    const urls: string[] = []
    for (const f of ['cover.png', 'pk.png', 'pr.png']) {
      const u = await host.fromBuffer(readFileSync(join(ASSETS, f)), 'luathoangphi-thanh-lap-cong-ty')
      if (!u) throw new Error(`image host failed for ${f} — nothing written`)
      urls.push(u)
    }
    images = JSON.stringify(urls)
    console.log(`gallery: ${urls.length} images`)
  }

  // Avatar (512², the firm's monogram on its brand blue) + banners at the storefront's reserved sizes.
  // ⚠️ Storefront images only on the FIRST run (or --reimage): a re-run must not upload fresh copies and
  // orphan the previous ones (a reviewer's catch). Uploads still precede the transaction, so a failed
  // transaction can strand objects — accepted: they are inert, and the run is repeatable.
  const current = await db.seller.findUnique({ where: { id: SELLER_ID }, select: { avatarUrl: true, bannerUrl: true, bannerMobileUrl: true } })
  const fresh = REIMAGE || !current?.avatarUrl || !current?.bannerUrl
  const avatarUrl = !fresh ? current!.avatarUrl! : await put(`partner/avatar-${SELLER_ID}-${ts}.webp`, await sharp(join(ASSETS, 'av.png')).flatten({ background: '#0071B8' }).webp({ quality: 92 }).toBuffer())
  const bannerUrl = !fresh ? current!.bannerUrl! : await put(`partner/banner-${SELLER_ID}-${ts}.webp`, await sharp(join(ASSETS, 'bn.png')).resize(2560, 600, { fit: 'cover' }).webp({ quality: 88 }).toBuffer())
  const bannerMobileUrl = !fresh ? (current!.bannerMobileUrl ?? null) : await put(`partner/banner-m-${SELLER_ID}-${ts}.webp`, await sharp(join(ASSETS, 'bm.png')).resize(732, 376, { fit: 'cover' }).webp({ quality: 88 }).toBuffer())

  const attributes = JSON.stringify({ serviceLocation: 'online', providerType: 'business' })
  const fields = {
    title: TITLE_EN, titleVi: TITLE_VI, description: DESC_EN, descriptionVi: DESC_VI,
    price: PRICE, priceUnit: money.priceUnit, currency: money.currency, negotiable: false,
    condition: null, listingType: 'service', categoryId: category.id, subcategorySlug: SUBCATEGORY,
    brandSlug: null, model: null, attributes,
    // The HCMC office is in the former Tân Bình district (now phường Tân Sơn Hòa); the area chips key on
    // the district name. No coordinates: a wrong pin is worse than the approximate-area map.
    location: 'Tân Bình', district: 'Tân Bình', city: 'Hồ Chí Minh',
    images: images!, affiliateUrl: null, sellerTrustScore: seller.trustScore,
    searchText: buildSearchText([TITLE_EN, TITLE_VI, DESC_EN, DESC_VI, category.name, category.nameVi, SELLER.name, 'Hoang Phi', 'luat su', 'lawyer', 'thanh lap cong ty', 'company formation', 'business registration']),
  }

  await db.$transaction(async (tx) => {
    await tx.seller.update({ where: { id: SELLER_ID }, data: { name: SELLER.name, bio: SELLER.bio, location: SELLER.location, avatarColor: SELLER.avatarColor, avatarUrl, bannerUrl, bannerMobileUrl } })
    await tx.profile.update({ where: { id: owner.id }, data: { accountType: 'business' } })
    if (!seller.handle) await tx.handle.create({ data: { handle: HANDLE, sellerId: SELLER_ID } })
    await tx.listing.upsert({
      where: { sellerId_externalId: { sellerId: SELLER_ID, externalId: EXTERNAL_ID } },
      update: fields,
      create: {
        ...fields, sellerId: SELLER_ID, externalId: EXTERNAL_ID, verified: true, status: 'active',
        rankScore: browseRankScore({ sellerTrustScore: seller.trustScore, postedAt: new Date(), featured: false }),
      },
    })
  })
  const row = await db.listing.findFirst({ where: { sellerId: SELLER_ID, externalId: EXTERNAL_ID }, select: { id: true } })
  console.log(`\nAPPLIED: storefront /${seller.handle?.handle ?? HANDLE} · listing /listings/${row?.id}`)
  console.log('Rollback: UPDATE "Listing" SET status=\'hidden\' WHERE "externalId"=\'hoangphi:company-formation\';')
  await db.$disconnect()
}
main().catch(async (e) => { console.error(e); await db.$disconnect(); process.exit(1) })
