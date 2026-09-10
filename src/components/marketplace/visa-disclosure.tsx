import { Info } from '@/components/ui/icons'
import { OFFICIAL_EVISA_URL, OFFICIAL_EVISA_HOST } from '@/lib/visa-provider'

/**
 * WHO WE ARE NOT, AND WHERE THE REAL THING IS — on every screen that sells an e-visa.
 *
 * ⛔ THIS EXISTS BECAUSE GOOGLE PLAY REJECTED THE APP (Misleading Claims, 2026-09-10) and because
 * the disclaimer we already had was INVISIBLE IN THE APP. The only non-government statement on
 * /vietnam-evisa lived inside `sections`, which SeoLanding wraps in `.web-only`, and
 * globals.css:1503 is `html.native .web-only { display: none; }`. The Capacitor shell loads
 * www.eno.forum, layout.tsx adds `html.native`, so a Play reviewer opening the app saw e-visa
 * prices, an Apply button and NO disclaimer at all. The store listing was never the whole problem.
 *
 * ⛔ SO IT MUST NEVER BE PLACED INSIDE `.web-only`, AND IT MUST NOT BE COLLAPSED, TABBED OR PUT
 * BELOW A FOLD. Play's wording is "clear and easy-to-see"; a disclaimer a reviewer has to scroll
 * past a price grid to reach is the finding they already made once, in their own words: it "is now
 * BELOW the cards".
 *
 * ⛔ AND THE OFFICIAL LINK IS A REAL ANCHOR, NOT PROSE. Play asks for "a clear, official, valid and
 * functional URL". `evisa.gov.vn` written as text in a paragraph is not a link, and several of our
 * pages mention it that way — that is what this component replaces.
 *
 * ⚠️ THE CALLER SUPPLIES THE TEXT so this works in both a server SEO page (English, prebuilt) and a
 * client screen (through `tr`). Putting `useLanguage` in here would make it client-only and it is
 * needed most on the server-rendered pages.
 */
export function VisaDisclosure({
  text,
  textVi,
  linkLabel,
  className = '',
}: {
  /** The disclaimer itself — normally PROVIDER_OF_RECORD.en / .vi. */
  text: string
  /**
   * ⛔ THE SECOND LANGUAGE, FOR SERVER-RENDERED SURFACES THAT CANNOT ASK WHICH ONE TO USE. The PDP
   * and the storefront are server components: `useLanguage` is not available to them, so the first
   * cut passed `.en` unconditionally and a Vietnamese buyer got the compliance-critical "not a
   * government body" sentence in a language they may not read (codex, on the diff, 2026-09-10). A
   * disclaimer nobody can read is the same as no disclaimer, so both are rendered rather than one
   * being guessed at. Client screens pass `tr(...)` and leave this out.
   */
  textVi?: string
  /** Label for the official-portal anchor, e.g. "Official Vietnam e-Visa portal". */
  linkLabel: string
  className?: string
}) {
  /**
   * ⛔ RENDER NOTHING RATHER THAN AN EMPTY BOX. On the marketplace edition `@/lib/visa-provider` is
   * aliased to a stub whose strings are all `''`, so this component drew a tinted panel containing
   * an info icon, a blank paragraph and a dangling "—" — a compliance notice that says nothing,
   * which is worse than no notice at all because it looks like one. Seen in the app (owner,
   * 2026-09-10). The caller cannot easily know: on eno.vn the alias is applied at BUILD time and
   * every call site passes what looks like real copy.
   * ⚠️ THIS IS NOT A WAY TO SUPPRESS THE DISCLAIMER. It fires only where there is no visa surface
   * to disclaim — eno.vn compiles no wallet, no checkout and a stubbed provider. Anywhere the copy
   * is real, so is the panel.
   */
  if (!text.trim() || !OFFICIAL_EVISA_URL) return null

  // Built outside JSX: a bare template literal in markup trips the no-literals rule, and this is a
  // domain name rather than copy — there is nothing here to translate.
  const hostSuffix = OFFICIAL_EVISA_HOST ? ` — ${OFFICIAL_EVISA_HOST}` : ''
  return (
    <aside className={`flex max-w-3xl items-start gap-3 rounded-xl bg-tint p-4 ${className}`}>
      <Info className="mt-0.5 h-4 w-4 shrink-0 text-accent-foreground" aria-hidden />
      <div className="min-w-0">
        <p className="text-sm leading-relaxed text-body">{text}</p>
        {textVi && <p className="mt-2 text-sm leading-relaxed text-body" lang="vi">{textVi}</p>}
        {/*
          ⚠️ `rel="noreferrer"` AND A NEW TAB, deliberately. This is the one outbound link in the
          product that we WANT people to take, and a government site should open in the user's own
          browser rather than replacing an application they are part-way through.
        */}
        <p className="mt-2 text-sm leading-relaxed">
          <a
            href={OFFICIAL_EVISA_URL}
            target="_blank"
            rel="noreferrer"
            className="font-semibold text-accent-foreground underline underline-offset-2"
          >
            {linkLabel}
          </a>
          {/* The host shown beside the label so the destination is legible before the tap — a
              government link people should be able to recognise, not just trust. */}
              <span className="text-body">{hostSuffix}</span>
        </p>
      </div>
    </aside>
  )
}
