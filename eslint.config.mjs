import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
import { dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const eslintConfig = [...nextCoreWebVitals, ...nextTypescript, {
  rules: {
    // Design-system guard: ban the hardcoded brand hex as a Tailwind arbitrary
    // value (bg-[#0a66c2] / hover:bg-[#004182] / bg-[#e8f1fb]) so the token
    // migration can't regress. Bare hex data values (avatarColor defaults, etc.)
    // are NOT matched — only the bracketed class form. Use bg-primary / text-brand
    // / hover:bg-brand-dark / bg-brand-50 instead.
    "no-restricted-syntax": [
      "error",
      {
        selector: "Literal[value=/\\[#(?:0a66c2|004182|e8f1fb)\\]/i]",
        message: "Use a theme token (bg-primary / text-brand / hover:bg-brand-dark / bg-brand-50) instead of a hardcoded brand hex class.",
      },
      {
        selector: "TemplateElement[value.raw=/\\[#(?:0a66c2|004182|e8f1fb)\\]/i]",
        message: "Use a theme token (bg-primary / text-brand / hover:bg-brand-dark / bg-brand-50) instead of a hardcoded brand hex class.",
      },
    ],

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
    "no-fallthrough": "off",
    "no-mixed-spaces-and-tabs": "off",
    "no-redeclare": "off",
    "no-undef": "off",
    "no-unreachable": "off",
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
  files: ["src/components/**/*.tsx", "src/app/**/*.tsx"],
  ignores: [
    "src/app/developers/**",
    "src/components/marketplace/developers-panel.tsx",
    "src/components/marketplace/seo-landing.tsx",
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
        "1 km", "20 km", "=", "−", "↓", "©", "“", "”", "💰", "❤️", "+000",
        "×1,000", "×1,000,000", "×1,000,000,000",
        "support@eno.vn", "eno.vn/", "eno.vn ·", "eno.vn —", ") · Email:", "Email:",
        // brand / proper nouns
        "eno", "eno.vn", "Zalo", "WhatsApp", "Telegram", "Facebook", "Instagram", "YouTube", "Google",
        "DELETE", // the typed deletion keyword — must NOT be translated
      ],
    }],
  },
}, {
  // Playwright fixtures receive a `use(...)` callback that is NOT the React `use` hook;
  // the react-hooks plugin misfires on it. E2E specs are not React components.
  files: ["e2e/**"],
  rules: { "react-hooks/rules-of-hooks": "off" },
}, {
  ignores: ["node_modules/**", ".next/**", "out/**", "build/**", "next-env.d.ts", "examples/**", "skills", "apps/forum/**"]
}];

export default eslintConfig;
