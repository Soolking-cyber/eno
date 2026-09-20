/**
 * What the ad feeds would actually send, and what policy-shaped rows are still getting through.
 *
 *   npx tsx scripts/audit-feed-compliance.ts                       # eno.forum (services edition)
 *   NEXT_PUBLIC_ENO_EDITION=marketplace NEXT_PUBLIC_APP_URL=https://eno.vn \
 *     npx tsx scripts/audit-feed-compliance.ts                     # eno.vn — usually the one you want
 *
 * ⛔ RUN THIS AFTER EVERY CATALOGUE REFETCH. On 2026-09-20 a refetch replaced Vietnamese titles
 * with ENGLISH ones and silently disabled most of FEED_EXCLUDE_RULES, which had been written
 * against a Vietnamese catalogue: canned beer, insulin syringes, forehead thermometers, a
 * stethoscope, Zippo lighter fluid and 130-odd pairs of underwear were all reaching Merchant
 * Center. Nothing failed, nothing logged, and the feed returned HTTP 200 throughout.
 *
 * ⚠️ THE EDITION MATTERS AND THE DEFAULT IS THE WRONG ONE FOR eno.vn. With no env set,
 * next.config.ts's rule treats the build as SERVICES, so `feedCategories()` includes `services`
 * and the run reports AppleCare+ and SIM cards with no google_product_category. Those are the
 * FORUM's feed, not the marketplace's. Set the two variables above for eno.vn's real picture.
 *
 * ⚠️ IT NEEDS A `server-only` STUB, because this repo does not depend on that package — Next
 * aliases it at build time, so importing product-feed.ts outside Next fails with MODULE_NOT_FOUND:
 *     mkdir -p node_modules/server-only && printf '{"name":"server-only","main":"index.js"}' \
 *       > node_modules/server-only/package.json && printf 'module.exports={}' > node_modules/server-only/index.js
 *   (node_modules is gitignored, so this is local and disposable.)
 *
 * ⚠️ THE RISK SCAN BELOW IS A WIDE NET AND IT IS MEANT TO OVER-REPORT. Roughly four in five of its
 * hits are false positives by design — "Replica Jersey" is licensed Nike/Adidas kit, `\bcopy\b`
 * takes photocopiers and copy paper, "Thong Nhat" is a BICYCLE brand, "Casino Royale" is a novel,
 * and books about wine are not wine. READ THE TITLES; do not act on the counts.
 */
import 'dotenv/config'
import { db } from '../src/lib/db'
import { feedExcluded, isMockImages, feedCategories, feedListingTypes, gpcFor } from '../src/lib/product-feed'

/** Wide net for Google/Meta prohibited + restricted classes, VN and EN, unaccented-tolerant. */
const RISK: [RegExp, string][] = [
  [/\b(vape|pod system|shisha|cigar|nicotine|thuoc la|thuốc lá|tinh dau vape|tinh dầu vape|iqos|heets)\b/i, 'TOBACCO/VAPE'],
  [/\b(sung|súng|dao găm|dao gam|kiếm|kiem nhat|con so 8|còng số 8|dui cui|dùi cui|binh xit hoi cay|bình xịt hơi cay|ma tấu|ma tau|đạn|\bammo\b|airsoft)\b/i, 'WEAPON'],
  [/\b(can sa|cần sa|\bcbd\b|\bthc\b|ma tuy|ma túy|bong cuoi|bóng cười|kush|cocaine|poppers)\b/i, 'DRUG'],
  [/\b(bao cao su|condom|sex toy|do choi nguoi lon|đồ chơi người lớn|gel boi tron|gel bôi trơn|duong vat gia|dương vật giả|am dao gia|âm đạo giả|thuoc kich duc|thuốc kích dục)\b/i, 'ADULT'],
  [/\b(casino|co bac|cờ bạc|xo so|xổ số|lo de|lô đề|ca cuoc|cá cược|poker chip)\b/i, 'GAMBLING'],
  [/\b(super ?fake|sieu cap|siêu cấp|hang nhai|hàng nhái|replica|rep 1:1|fake 1:1|\bf1 fake\b|like ?auth)\b/i, 'COUNTERFEIT'],
  [/\b(phao hoa|pháo hoa|phao no|pháo nổ|binh gas|bình gas|con 90|cồn 90|xang|xăng)\b/i, 'DANGEROUS_GOODS'],
  [/\b(kinh ap trong|kính áp tròng|contact lens|lens mat|lens mắt)\b/i, 'CONTACT_LENS'],
  [/\b(thiet bi nghe len|thiết bị nghe lén|camera nguy trang|camera ngụy trang|dinh vi theo doi|định vị theo dõi|spy cam|may nghe len|máy nghe lén)\b/i, 'SPY_GEAR'],
  [/\b(thuoc khang sinh|thuốc kháng sinh|don thuoc|đơn thuốc|thuoc ke don|thuốc kê đơn|vien uong tri|viên uống trị|dac tri|đặc trị)\b/i, 'RX_MEDICINE'],
  [/\b(cho con|chó con|meo con|mèo con|chim canh|chim cảnh|ca canh song|cá cảnh sống|live animal)\b/i, 'LIVE_ANIMAL'],
  [/\b(the cao|thẻ cào|gift ?card|the game|thẻ game|tien ao|tiền ảo|bitcoin|usdt)\b/i, 'CURRENCY/GIFTCARD'],
  [/\b(giam can cap toc|giảm cân cấp tốc|tang can nhanh|tăng cân nhanh|tri nam|trị nám|chua khoi|chữa khỏi|dieu tri ung thu|điều trị ung thư)\b/i, 'HEALTH_CLAIM'],
]

async function main() {
  const rows = await db.listing.findMany({
    where: {
      verified: true, status: 'active',
      listingType: { in: feedListingTypes() },
      category: { slug: { in: feedCategories() } },
    },
    select: { id: true, title: true, images: true, subcategorySlug: true, category: { select: { slug: true } } },
  })
  console.log(`${rows.length} rows match the feed's own filters (verified + active + feed categories + listingType)\n`)

  const byReason = new Map<string, number>()
  let mock = 0, emitted = 0, noGpc = 0
  const risky: { reason: string; title: string }[] = []
  const noGpcSample: string[] = []

  for (const r of rows) {
    const images = (() => { try { return JSON.parse(r.images || '[]') } catch { return [] } })()
    if (isMockImages(images)) { mock++; continue }
    const reason = feedExcluded(r.title)
    if (reason) { byReason.set(reason, (byReason.get(reason) ?? 0) + 1); continue }
    emitted++
    // ⛔ A row with no google_product_category is suppressed as surely as a rejected one.
    if (!gpcFor(r.category.slug, r.subcategorySlug)) { noGpc++; if (noGpcSample.length < 10) noGpcSample.push(`${r.category.slug}/${r.subcategorySlug ?? '—'}  ${r.title.slice(0, 64)}`) }
    for (const [re, label] of RISK) if (re.test(r.title)) { risky.push({ reason: label, title: r.title }); break }
  }

  console.log(`EXCLUDED by the current rules:`)
  for (const [k, v] of [...byReason].sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(6)}  ${k}`)
  console.log(`  ${String(mock).padStart(6)}  mock_images`)
  console.log(`\nWOULD BE SENT TO MERCHANT CENTER: ${emitted}`)
  console.log(`  of those, ${noGpc} carry NO google_product_category (suppressed on arrival)`)
  for (const s of noGpcSample) console.log(`      ${s}`)

  console.log(`\n⛔ RISKY TITLES THAT CURRENTLY PASS (${risky.length}):`)
  const byRisk = new Map<string, string[]>()
  for (const x of risky) { const a = byRisk.get(x.reason) ?? []; a.push(x.title); byRisk.set(x.reason, a) }
  for (const [k, list] of [...byRisk].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`\n  ── ${k} (${list.length})`)
    for (const t of list.slice(0, 8)) console.log(`     ${t.slice(0, 96)}`)
    if (list.length > 8) console.log(`     … and ${list.length - 8} more`)
  }
  await db.$disconnect()
}
main().catch(async (e) => { console.error(e); await db.$disconnect(); process.exit(1) })
