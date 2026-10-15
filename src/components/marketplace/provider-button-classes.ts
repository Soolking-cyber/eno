/**
 * THE PROVIDER BUTTONS' ONE LOOK — Google, Apple and LinkedIn (2026-10-15: moved out of sign-in-form.tsx so the teacher
 * form's "Sign in with LinkedIn" door is the same button, not a copy that drifts). The why of every class is in
 * sign-in-form.tsx beside ProviderPair / GOOGLE_BUTTON / APPLE_BUTTON (owner, 2026-10-09: "make sure they look same").
 */
// ⚠️ A UNITLESS LEADING (1.25): the apps' text zoom grows the glyphs, never a px line box (sign-in-form.tsx).
export const PROVIDER_TITLE = 'text-[19px] font-bold leading-tight' // design-lint-allow: Apple HIG custom button — title = 43% of the 44px height (19px)
/** White, a black inset ring (never a border: it would push a 44px logo to 46px), no ring in dark mode, grows rather than clips. */
export const PROVIDER_BUTTON = 'flex min-h-11 w-full items-center justify-center whitespace-normal rounded-xl inset-ring inset-ring-black bg-white px-4 text-center text-black hover:bg-neutral-100 disabled:opacity-50 cursor-pointer dark:inset-ring-transparent'
