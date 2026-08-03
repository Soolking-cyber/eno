// ── Ranking transparency — DERIVED FROM THE LIVE FORMULA, NEVER HAND-WRITTEN ────────────────────
//
// Law 122/2025/QH15 requires a marketplace to disclose the main parameters determining how listings
// are ranked, and their relative importance. That makes the published page a LEGAL STATEMENT about
// our own code.
//
// ⚠️ SO IT IS COMPUTED FROM `RANK`, NOT TRANSCRIBED FROM IT. A hand-written "60% / 25% / 15%" is
// true only until someone tunes a constant — and `ranking-formula.ts` exists precisely because
// three copies of this formula had ALREADY drifted apart in this repo (seed.ts still ran an ancient
// 0.5/0.5 blend). A stale marketing number is embarrassing; a stale disclosure is a false statement
// to a regulator. `ranking-disclosure.test.ts` fails the build if these ever diverge.
//
// ⚠️ Both editions. This is not visa/itinerary-gated.

import { RANK } from '@/lib/ranking-formula'

/** A disclosed ranking factor: what it is, how much it counts, and what it actually measures. */
export type RankingFactor = {
  key: string
  /** Share of the composite, 0–100, already rounded for display. */
  weightPct: number
  labelEn: string
  labelVi: string
  /** Plain-language description of the SIGNAL — not the maths. */
  explainEn: string
  explainVi: string
}

/**
 * ⚠️ ROUND, THEN RECONCILE. Three weights that each round independently can publish as 59/25/15 —
 * and a disclosure whose percentages do not total 100 invites exactly the question we are trying to
 * pre-empt. The largest factor absorbs the rounding residue so the published set always sums to 100.
 */
function toPercentages(weights: number[]): number[] {
  const pct = weights.map((w) => Math.round(w * 100))
  const drift = 100 - pct.reduce((a, b) => a + b, 0)
  if (drift !== 0) {
    const largest = pct.indexOf(Math.max(...pct))
    pct[largest] += drift
  }
  return pct
}

const TRUST = {
  key: 'trust',
  labelEn: 'Seller trust score',
  labelVi: 'Điểm tin cậy của người bán',
  explainEn:
    'An evidence-based score built from completed transactions, buyer reviews, response behaviour, verified identity, and confirmed reports. It is never adjusted by payment.',
  explainVi:
    'Điểm dựa trên bằng chứng: giao dịch đã hoàn tất, đánh giá của người mua, mức độ phản hồi, danh tính đã xác minh và các báo cáo đã được xác nhận. Không bao giờ thay đổi vì lý do thanh toán.',
}

const RECENCY = {
  key: 'recency',
  labelEn: 'Freshness',
  labelVi: 'Độ mới',
  // ⚠️ The half-life is derived too: exp(-t/DECAY_DAYS) = 0.5 → t = DECAY_DAYS·ln2.
  explainEn: `How recently the listing was posted, decaying continuously — a listing loses about half of this component after ${Math.round(RANK.DECAY_DAYS * Math.LN2)} days.`,
  explainVi: `Tin đăng mới được ưu tiên, giảm dần liên tục — sau khoảng ${Math.round(RANK.DECAY_DAYS * Math.LN2)} ngày, yếu tố này còn lại một nửa.`,
}

/** Browse (no query): trust leads, then demand, then freshness. */
export function browseFactors(): RankingFactor[] {
  const [t, d, r] = toPercentages([RANK.BROWSE_TRUST_W, RANK.BROWSE_RELEVANCE_W, RANK.BROWSE_RECENCY_W])
  return [
    { ...TRUST, weightPct: t },
    {
      key: 'demand',
      weightPct: d,
      labelEn: 'Buyer interest',
      labelVi: 'Mức độ quan tâm của người mua',
      explainEn: `How many buyers viewed and contacted this listing. Revealing contact details counts far more than a passing view (about ${RANK.DEMAND_CONTACT_W}×), and the effect saturates so a single popular listing cannot dominate a category.`,
      explainVi: `Số người mua đã xem và liên hệ. Việc xem thông tin liên hệ có trọng số cao hơn nhiều so với lượt xem thoáng qua (khoảng ${RANK.DEMAND_CONTACT_W} lần), và có giới hạn để một tin đăng phổ biến không thể chiếm lĩnh cả danh mục.`,
    },
    { ...RECENCY, weightPct: r },
  ]
}

/** Search (query present): relevance keeps a slim lead, trust is a heavyweight co-factor. */
export function searchFactors(): RankingFactor[] {
  const [rel, t, rec] = toPercentages([RANK.SEARCH_REL_W, RANK.SEARCH_TRUST_W, RANK.SEARCH_RECENCY_W])
  return [
    {
      key: 'relevance',
      weightPct: rel,
      labelEn: 'Match to your search',
      labelVi: 'Mức độ phù hợp với từ khoá của bạn',
      explainEn:
        'How well the listing matches the words you typed — title, category, brand and model.',
      explainVi:
        'Tin đăng khớp với từ khoá bạn nhập đến mức nào — tiêu đề, danh mục, thương hiệu và mẫu mã.',
    },
    { ...TRUST, weightPct: t },
    { ...RECENCY, weightPct: rec },
  ]
}

/** Featured placement is disclosed as a fixed, labelled boost — not hidden inside "relevance". */
export const FEATURED_BOOST_PCT = Math.round(RANK.FEATURED_BOOST * 100)
