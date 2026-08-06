/**
 * The price-drop rule CONSTANTS, in a client-safe module.
 *
 * ⚠️ THEY LIVE HERE SO THE SELLER-FACING DIALOGS CAN STOP GUESSING. src/lib/price-drop.ts is
 * `import 'server-only'`, so quick-discount.tsx and bulk-discount.tsx could not read the real gate
 * and each hardcoded a single 20% threshold instead — which INVERTS at deep cuts: below TYPO_FLOOR
 * the badge is guaranteed NOT to appear, so the -90% bulk run the UI promised most confidently was
 * the one certain to earn nothing.
 *
 * price-drop.ts re-exports DROP from here, so there is still exactly ONE definition. Anything a
 * client genuinely cannot evaluate (the 72h age and hold windows, the raise counter, the 30-day
 * reference price) stays server-side — which is why the dialog copy is CONDITIONAL rather than a
 * promise. Do not re-hardcode any of these numbers in a component.
 */
const DAY = 24 * 60 * 60 * 1000

export const DROP = {
  WINDOW_MS: 30 * DAY,        // reference window: lowest offered price in 30 days
  BADGE_MS: 3 * DAY,          // drop badge lifetime — after 3 days the cut just becomes the normal price
  MIN_PRICE: 50_000,          // ₫ floor — penny listings can't farm drop badges
  TYPO_FLOOR: 0.2,            // below 20% of ref = probable typo/giá ảo → no badge
  BAND_SPLIT: 5_000_000,      // ₫ — the % needed to qualify depends on price band
  BAND_SMALL: 0.9,            // < 5M: must drop ≥10% below the 30-day reference
  BAND_LARGE: 0.95,           // ≥ 5M: ≥5% is already meaningful money
  MIN_AGE_MS: 72 * 3600_000,  // listing must be ≥72h old (no post-high-discount-today)
  MIN_HOLD_MS: 72 * 3600_000, // current price must have been held ≥72h (FTC bona fide)
  MAX_RAISES_7D: 2,           // ≥3 raises in 7 days = price-cycling → suppress rewards
  NOTIFY_RATCHET: 0.9,        // notify only ≥10% below the lowest EVER notified price
  NOTIFY_COOLDOWN_MS: 1 * DAY, // max 1 notification per listing per 24h
  RECIPIENT_DAILY_CAP: 5,     // max price_drop notifications per recipient per 24h
  AUDIENCE_CAP: 100,          // fan-out bound per drop event
} as const
