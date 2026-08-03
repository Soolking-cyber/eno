/* eslint-disable react/jsx-no-literals -- deliberately bilingual (VI+EN shown simultaneously per ND52 test-operation notice) */
import { PRELAUNCH } from '@/lib/site-legal'

// Always-visible pre-launch notice (both languages at once, deliberately NOT
// dismissible and NOT behind the language toggle): while the MoIT sàn TMĐT
// registration is pending, the site must clearly read as "under construction /
// test operation — not officially operational" to anyone who lands on it.
// Server component, zero JS. Remove by flipping PRELAUNCH in src/lib/site-legal.ts.
export function PrelaunchNotice() {
  if (!PRELAUNCH) return null
  return (
    /* ⚠️ LOUDER ON PURPOSE (owner, 2026-08-02: "put the test mode warning back but bolder more
       visible"). It had been a 11px tinted whisper that read as decoration; the whole point of the
       notice is that a visitor cannot miss that the site is not trading yet.
       What changed: solid --warning fill instead of a 10% tint, text-xs instead of text-2xs, both
       halves bold, and a ⚠ glyph.

       ⚠️ THE TEXT COLOUR MUST FLIP WITH THE THEME, and `text-white` alone is a TRAP here, because
       --warning is not one colour: it is #92400e (amber-800, dark) in light mode and #fbbf24
       (amber-400, bright) in dark. Measured:
           light  #92400e + white    → 7.09:1  ✓
           dark   #fbbf24 + white    → 1.67:1  ✗ effectively invisible
           dark   #fbbf24 + #1b1b1b  → 10.32:1 ✓  (--background in dark mode)
       So white in light mode, and `dark:text-background` in dark — a TOKEN, not a raw hex:
       design-lint rejects raw colours, and --background is the dark canvas (#1b1b1b) in that theme,
       which is exactly the near-black wanted here. Contrast now goes UP in both themes, which
       matters because this banner is site-wide and its previous scheme was already marginal enough
       that an opacity-80 on this exact text measured 3.95:1 and had to be deleted after axe flagged
       it on every page. Never reintroduce an opacity here, and never assume one text colour works
       on a token that inverts. */
    <div
      id="prelaunch-banner"
      role="status"
      className="bg-warning px-3 py-2 text-center text-xs font-bold leading-snug text-white dark:text-background"
    >
      <span aria-hidden="true">⚠ </span>
      <span>Website đang xây dựng và chạy thử nghiệm — chưa chính thức hoạt động.</span>{' '}
      <span>This website is under construction and in test operation — not yet officially launched.</span>
    </div>
  )
}
