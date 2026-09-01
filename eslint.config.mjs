import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
import { dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Design-system guard: ban the hardcoded brand hex as a Tailwind arbitrary
// value (bg-[#0a66c2] / hover:bg-[#004182] / bg-[#e8f1fb]) so the token
// migration can't regress. Bare hex data values (avatarColor defaults, etc.)
// are NOT matched — only the bracketed class form. Use bg-primary / text-brand
// / hover:bg-brand-dark / bg-brand-50 instead.
const BRAND_HEX_RULES = [
  {
    selector: "Literal[value=/\\[#(?:0a66c2|004182|e8f1fb)\\]/i]",
    message: "Use a theme token (bg-primary / text-brand / hover:bg-brand-dark / bg-brand-50) instead of a hardcoded brand hex class.",
  },
  {
    selector: "TemplateElement[value.raw=/\\[#(?:0a66c2|004182|e8f1fb)\\]/i]",
    message: "Use a theme token (bg-primary / text-brand / hover:bg-brand-dark / bg-brand-50) instead of a hardcoded brand hex class.",
  },
];

/**
 * ⚠️ A DATABASE WRITE THAT FAILS SILENTLY IS INDISTINGUISHABLE FROM ONE THAT SUCCEEDED.
 *
 * `.catch(() => {})` on a `db.*` call was the idiom for "best-effort, do not block the response",
 * and the intent is right — a trust heartbeat or a view counter must not 500 a page. What was wrong
 * is the SILENCE: 17 of these existed on 2026-08-05, six of them on the trust, enforcement, dispute
 * and moderation paths, including two that write `verified: false` to take a listing down. If that
 * write failed, the admin saw success, the listing stayed live, and nothing anywhere recorded it.
 *
 * The fix is not to stop swallowing — it is to swallow OUT LOUD:
 *     .catch((e) => logError(e, { op: 'moderate.unverifyListing' }))
 * Same latency, same non-blocking behaviour, one line in Cloud Logging when it goes wrong.
 *
 * Scoped to `src/lib` and `src/app/api` via the block below — MOSTLY server code, where `logError`
 * reaches Cloud Logging.
 *
 * ⚠️ "MOSTLY", NOT "UNAMBIGUOUSLY" — an earlier version of this comment claimed the latter and a
 * reviewer disproved it in one line: `src/lib/analytics.ts` opens with "Client-side GA4 events" and
 * touches `window`. A handful of `src/lib` modules are browser code, and for those the rule's
 * premise is inverted — reporting a failed beacon puts JSON in the visitor's console and nothing in
 * Cloud Logging. Those sites take a narrow `eslint-disable-next-line` that states the reason,
 * rather than the rule pretending they do not exist.
 *
 * ⚠️ KNOWN GAP, STATED RATHER THAN PAPERED OVER. A reviewer pointed out that Server Components and
 * Server Actions live in `src/app/**\/*.tsx` and are therefore NOT covered. That is true. Widening
 * the rule to all of `src/` was measured and produces 52 violations — every one of them in a CLIENT
 * component (`components/`, `context/`, `hooks/`), where a fire-and-forget failure has no server log
 * to reach and the rule's premise does not hold. Telling server `.tsx` from client `.tsx` needs the
 * `'use client'` directive, which an AST selector cannot see, so the honest options were "cover the
 * server code we can identify" or "fail 52 times for a reason that does not apply". This is the
 * first. A silent catch in a Server Component is still a real gap; it is just not one this selector
 * can close.
 */
const SILENT_DB_CATCH_RULES = [
  {
    selector: "CallExpression[callee.property.name='catch'] > ArrowFunctionExpression[body.type='BlockStatement'][body.body.length=0]",
    message: "Do not swallow an error silently. Use .catch((e) => logError(e, { op: 'area.action' })) — same non-blocking behaviour, but a failed write stops being invisible.",
  },
]

/**
 * ⚠️ APPLIED TO src/** ONLY — see the scoped block further down, and note WHY it is a separate
 * const rather than more entries in the array above. ESLint flat config REPLACES a rule's options
 * wholesale when a later block re-declares it, so a scoped `no-restricted-syntax` for src/** would
 * silently drop the brand-hex guard exactly where it matters most. Composing both lists into the
 * scoped block is what keeps that from happening.
 *
 * Scoped because the hazard is SERVER logs, not a developer's terminal. Applied repo-wide this
 * flagged four sites in operator-run CLI tooling — .claude/skills/authed-e2e/seed-users.ts and
 * scripts/push-test.mjs — which echo an email the operator themselves typed as an argument, to
 * their own stdout. Echoing the input is the entire purpose of those lines; "Cloud Logging
 * retention outlives the incident" is not true of them.
 */
const PII_LOG_RULES = [
  // ── PII must not reach the logs ────────────────────────────────────────────────
      // Passing a bare `phone` or `email` IDENTIFIER straight into console.* dumps a
      // subscriber's real contact details into Cloud Logging, where retention outlives the
      // incident that produced them. Found 2026-08-05 at api/auth/send-sms/route.ts:157
      // ("all channels failed for", phone) — sixty lines after :98 got the same job right with
      // `phone.slice(0, 6)`. The failure mode was perverse: that line fires most during a
      // provider outage, so the worse the incident, the more complete the dump.
      //
      // The four selectors below cover the ways a raw value actually reaches console.* in this
      // codebase's style: a bare argument, a member access, an object property (shorthand
      // `{ phone }` OR renamed `{ prefix: phone }` — the second still logs the whole number, and an
      // earlier draft of this rule wrongly treated it as safe), and a template interpolation.
      //
      // ⚠️ IT BANS THE RAW VALUE, NOT THE TOPIC, AND IT IS NOT COMPREHENSIVE PII PROTECTION.
      // Deliberately still passing: `phone.slice(0, 6)` and `maskEmailHandle(email)` (the value is
      // transformed before it is logged — the whole point), and `{ prefix: phone.slice(0, 6) }`.
      // Known gaps, stated so nobody mistakes a green lint for a guarantee: a custom logger wrapper
      // instead of console.*, an alias (`const p = phone`), and any deeper nesting than one level.
  // Both external reviewers of the commit that added this raised exactly that, and both judged
  // the rule worth keeping anyway: it closes the specific defect class that reached production at
  // api/auth/send-sms/route.ts:157, at zero cost in src/**.
  {
    selector: "CallExpression[callee.object.name='console'] > Identifier[name=/^(phone|email)$/]",
    message: "Never log a raw phone/email. Use phone.slice(0, 6), maskEmailHandle(email), or an opaque id — Cloud Logging retention outlives the incident.",
  },
  {
    selector: "CallExpression[callee.object.name='console'] > MemberExpression[property.name=/^(phone|email)$/]",
    message: "Never log a raw phone/email (e.g. user.phone). Log a prefix, a masked handle, or an opaque id — Cloud Logging retention outlives the incident.",
  },
  {
    selector: "CallExpression[callee.object.name='console'] > ObjectExpression > Property[value.name=/^(phone|email)$/]",
    message: "Never log a raw phone/email inside an object — `{ phone }` and `{ prefix: phone }` both dump the whole value. Slice or mask it first.",
  },
  {
    selector: "CallExpression[callee.object.name='console'] > TemplateLiteral > Identifier[name=/^(phone|email)$/]",
    message: "Never interpolate a raw phone/email into a log template. Slice or mask it first — Cloud Logging retention outlives the incident.",
  },
];

const eslintConfig = [...nextCoreWebVitals, ...nextTypescript, {
  rules: {
    "no-restricted-syntax": ["error", ...BRAND_HEX_RULES],

    // TypeScript rules
    "@typescript-eslint/no-explicit-any": "off",
    "@typescript-eslint/no-unused-vars": "off",
    "@typescript-eslint/no-non-null-assertion": "off",
    "@typescript-eslint/ban-ts-comment": "off",
    "@typescript-eslint/prefer-as-const": "off",
    "@typescript-eslint/no-unused-disable-directive": "off",
    
    // React rules
    "react-hooks/exhaustive-deps": "off",
    "react-hooks/purity": "off",
    "react-hooks/immutability": "off",
    "react-hooks/set-state-in-effect": "off",
    // Same React-Compiler-strictness family as the three above (all off): these flag
    // intentional, documented patterns this codebase uses on purpose — reading/writing a
    // ref during render for the sanctioned "adjust-state / position-on-open / previous-value"
    // technique (area-filter, listings-explorer's search-jitter fix, listings-map card sizing),
    // and manual useMemo/useCallback the compiler can't auto-preserve. `static-components`
    // below stays ON — it catches genuine remount bugs (a component recreated each render).
    "react-hooks/refs": "off",
    "react-hooks/preserve-manual-memoization": "off",
    "react/no-unescaped-entities": "off",
    "react/display-name": "off",
    "react/prop-types": "off",
    "react-compiler/react-compiler": "off",
    
    // Next.js rules
    "@next/next/no-img-element": "off",
    "@next/next/no-html-link-for-pages": "off",
    
    // General JavaScript rules
    "prefer-const": "off",
    "no-unused-vars": "off",
    "no-console": "off",
    "no-debugger": "off",
    "no-empty": "off",
    "no-irregular-whitespace": "off",
    "no-case-declarations": "off",
    // Correctness rules deliberately ON (audit 2026-07-19): unreachable code and
    // silent switch fallthrough are bugs, not style. `no-fallthrough` accepts an
    // explicit `// falls through` comment where the cascade is intended.
    "no-fallthrough": ["error", { commentPattern: "falls?\\s?through" }],
    "no-unreachable": "error",
    "no-dupe-else-if": "error",
    "no-mixed-spaces-and-tabs": "off",
    "no-redeclare": "off",
    "no-undef": "off",
    "no-useless-escape": "off",
  },
}, {
  // ── i18n gate ──────────────────────────────────────────────────────────────────
  // Every user-facing string must go through tr()/t()/<Tr> (2026-07-06 i18n audit:
  // raw JSX literals ship English to 9 machine-translated languages and regress
  // silently). This FAILS CI on raw text typed directly into JSX. Fix = wrap it:
  //   <span>Hello</span>  →  <span>{tr('Hello', 'Xin chào')}</span>
  // Strings in expressions/props are not flagged (ignoreProps) — the rule targets
  // the common raw-text case. After adding copy, ALSO run
  // `node scripts/gen-ui-strings.mjs` (CI checks freshness).
  // EXEMPT (intentionally English): /developers + developers-panel (API docs incl.
  // literal header names), the EN-SEO landing components (they target English
  // search queries), and /admin (staff-only).
  //
  // ⚠️ THE SEO-ARTICLE ENTRIES ARE LISTED ONE BY ONE, NOT AS A GLOB, and that is deliberate.
  // seo-landing.tsx needs a single exemption because its pages pass prose through PROPS (which
  // `ignoreProps` already covers) and only the component itself renders JSX text. The long-form
  // guides are the opposite shape: their prose IS JSX, because the whole point of them is
  // contextual links inside sentences, so each page needs the exemption too. Naming the files
  // rather than globbing `src/app/**/page.svc.tsx` keeps the exemption from silently covering
  // every future services route — the visa application flow, the dashboard, the admin queue — none
  // of which is English-only SEO copy and all of which must stay behind the i18n gate.
  files: ["src/components/**/*.tsx", "src/app/**/*.tsx"],
  ignores: [
    "src/app/developers/**",
    "src/components/marketplace/developers-panel.tsx",
    "src/components/marketplace/seo-landing.tsx",
    "src/components/marketplace/seo-article.tsx",
    // ⚠️ `.forum.svc.` — THESE THREE MOVED TIERS AND THE EXEMPTION DID NOT FOLLOW, WHICH TURNED CI
    // RED WHILE Cloud Build STAYED GREEN (Cloud Build never runs eslint). Renaming them to the
    // forum-only infix left these paths matching nothing, and 136 jsx-no-literals errors came back
    // on prose that was exempt five minutes earlier. The paths are written out rather than globbed
    // on purpose — see the note above — and that is exactly what makes a rename a silent breakage.
    // If any of these moves again, this list moves with it.
    // ⚠️ WHY THEY ARE FORUM-ONLY, STATED SO NOBODY OVER-READS IT: only `official-process` is e-visa
    // marketing. The two arrival guides are ORDINARY expat content — they are on the stricter tier
    // because their prose NAMES the e-visa, evisa.gov.vn and the licensed partner (the same reason
    // scripts/edition-lint.mjs lists them), not because a marketplace may not publish a guide about
    // moving to Vietnam. If that vocabulary ever comes out of them, they can come back to eno.vn.
    "src/app/moving-to-vietnam/page.forum.svc.tsx",
    "src/app/first-month-in-vietnam/page.forum.svc.tsx",
    "src/app/vietnam-evisa/official-process/page.forum.svc.tsx",
    "src/app/admin/**",
    "src/components/admin/**",
  ],
  rules: {
    "react/jsx-no-literals": ["error", {
      noStrings: true,
      ignoreProps: true,          // props are usually code (className, ids); label props reviewed
      noAttributeStrings: false,
      allowedStrings: [
        // symbols / punctuation / units that read the same in every language
        "·", "—", "–", "-", "•", "…", "/", "|", "+", "%", "°", "★", "☆", "✓", "×", "→", "←", "@",
        "(", ")", ":", ",", ".", "?", "!", "&", "#",
        "VND", "₫", "km", "m²", "cc", "L", "kg", "GB", "TB", "MB",
        "1 km", "20 km", "=", "−", "↓", "©", "“", "”", "💰", "❤️", "+000", "1", "/600", "≈", "~", "% ·", "★ ·",
        "×1,000", "×1,000,000", "×1,000,000,000",
        "support@eno.vn", "eno.vn/", "eno.vn ·", "eno.vn —", ") · Email:", "Email:",
        // brand / proper nouns
        "eno", "eno.vn", "Zalo", "WhatsApp", "Telegram", "Facebook", "Instagram", "YouTube", "Google",
        "DELETE", // the typed deletion keyword — must NOT be translated
      ],
    }],
  },
}, {
  // ── PII-in-logs gate, application code only ────────────────────────────────────────
  // ⚠️ BOTH LISTS, NOT JUST THE PII ONE. Flat config replaces a rule's options wholesale when a
  // later block re-declares it, so listing only PII_LOG_RULES here would turn the brand-hex guard
  // OFF for every file under src/ — the exact place it exists to protect. Spreading both keeps the
  // repo-wide rules intact and adds the PII selectors on top.
  files: ["src/**/*.ts", "src/**/*.tsx"],
  rules: {
    "no-restricted-syntax": ["error", ...BRAND_HEX_RULES, ...PII_LOG_RULES],
  },
}, {
  // ⚠️ ALL THREE LISTS, for the flat-config reason spelled out above: a later block re-declaring
  // `no-restricted-syntax` REPLACES the earlier options wholesale, so omitting any list here would
  // silently switch it off for exactly the server code that most needs it.
  files: ["src/lib/**/*.ts", "src/app/api/**/*.ts"],
  ignores: ["**/*.test.ts"],
  rules: {
    "no-restricted-syntax": ["error", ...BRAND_HEX_RULES, ...PII_LOG_RULES, ...SILENT_DB_CATCH_RULES],
  },
}, {
  // Playwright fixtures receive a `use(...)` callback that is NOT the React `use` hook;
  // the react-hooks plugin misfires on it. E2E specs are not React components.
  files: ["e2e/**"],
  rules: { "react-hooks/rules-of-hooks": "off" },
}, {
  // ⚠️ "build/**" matches only a TOP-LEVEL build/, so Gradle output was being linted:
  // android/app/build/intermediates/.../native-bridge.js is git-ignored (android/.gitignore:24)
  // yet accounted for a large share of the repo's lint warnings — noise from a generated file
  // nobody can act on, in a directory that only exists after an Android build. The nested globs
  // below cover both native projects' build output and their Pods/Gradle caches.
  ignores: ["node_modules/**", ".next/**",
    // Self-hosted Tesseract WASM assets (public/tesseract/**) — third-party minified worker + core
    // JS for the on-device passport MRZ reader. Not our source; linting them reports require()/
    // this-alias errors from a bundle we do not author. See public/tesseract/PROVENANCE.md.
    "public/tesseract/**",
    // ⚠️ `.next-*` TOO, not just `.next`. next.config.ts now honours NEXT_DIST_DIR so two
    // sessions can run dev and preview side by side, and a developer following that advice
    // gets `.next-dev/` — which this list did not cover, so `npm run lint` linted 155 build
    // artefacts and reported 1190 errors that were not in the source tree at all. CI never
    // saw it (the directory is gitignored, so it does not exist there), which is exactly what
    // makes it the kind of breakage that survives: it only ever fires locally, for whoever
    // opted in, and it buries the real findings under generated code.
    ".next-*/**", "coverage/**", "out/**", "build/**", "**/build/**", "android/**/build/**", "ios/**/Pods/**", "apps/android/**/build/**", "apps/wasp-pilot/**", "next-env.d.ts", "examples/**", "skills", "apps/forum/**", "src/generated/prisma/**", "public/vendor/**", "cache-handler.cjs", "playwright-report/**", "test-results/**"]
}];

export default eslintConfig;
