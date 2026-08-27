// ⛔ ITS OWN FILE, AND THAT IS NOT TIDINESS. This helper is imported by BOTH the server client and
// the BROWSER client. `server.ts` imports `next/headers`, which is server-only — pulling this out of
// there would drag `next/headers` into the client bundle and fail the build. tsc does not catch
// that; `next build` does. Keep this module free of any server-only import.

/**
 * ⛔ `secure`, YES. `httpOnly`, NO — AND THE SECOND HALF IS THE IMPORTANT ONE, BECAUSE IT KEEPS
 * BEING PROPOSED. A security audit on 2026-08-27 called the missing flags HIGH and prescribed
 * `cookieOptions: { httpOnly: true, secure: true }` as a ten-minute change. Half of that is right.
 * `httpOnly: true` would BREAK AUTHENTICATION ACROSS WEB AND NATIVE, for a reason this repo already
 * writes down in auth-context.tsx: **no session lives anywhere but these cookies.** `userStorage`
 * is only wired up when the caller passes `cookies.encode === 'tokens-only'`, which neither client
 * here does, so there is no localStorage copy to fall back on. Measured before concluding:
 *   · `createBrowserClient` reads the jar with `parse(document.cookie)`
 *     (@supabase/ssr 0.12.4, dist/main/cookies.js:82) — an httpOnly cookie is INVISIBLE to it;
 *   · browser.ts arms Realtime from `auth.getSession()` and re-arms on `onAuthStateChange`, so
 *     private channels — the chat — stop authorizing once the token cannot be read;
 *   · 11 files build the browser client and make 39 client-side auth calls, auth-context.tsx and
 *     chat-context.tsx among them;
 *   · `/auth/escape` recovers a stranded sign-in by DETECTING `sb-` cookies from JS;
 *   · the Capacitor / iOS session mirror hangs off `onAuthStateChange`.
 * A test login would still LOOK fine — the server session is set either way — and the damage would
 * surface later as chat silently not delivering. That is why this is written here and not left to
 * be re-derived by the next person handed the same audit finding.
 *
 * ⚠️ THE REAL EXPOSURE IS UNCHANGED AND SHOULD NOT BE FILED AS FIXED: an XSS on this origin can
 * read these tokens, and the CSP still carries `unsafe-inline`/`unsafe-eval`. Closing it means
 * moving the session off JS-readable storage entirely (a server-only session, with the browser
 * client fed a token it never persists) — architecture, not an options object.
 *
 * ⛔ SET ON BOTH CLIENTS, and the audit missed this: browser.ts WRITES these cookies too, from JS,
 * with the same defaults. Fixing only the server leaves the client-written copy without `Secure`,
 * which is the one a signed-in reader actually carries most of the time.
 *
 * ⛔ THE LOCAL PREVIEW MUST NOT GET `Secure`, AND A BARE `NODE_ENV` GATE IS WHY THIS TOOK FOUR
 * DRAFTS. `npm run preview:vn` is a PRODUCTION build served over http://localhost:3000, and
 * CLAUDE.md makes it the mandatory pre-ship review surface — the only one exercising inlined
 * `NEXT_PUBLIC_*` and prerendered ISR. Chromium stores a Secure cookie on localhost (measured), but
 * Safari has historically refused to, so `NODE_ENV === 'production'` alone would have meant a
 * sign-in loop in Safari on the exact artifact the owner reviews before authorising a deploy.
 * `LOCAL_AUTH` is what separates them; see the note on the function below for why not a header.
 * ⚠️ `NEXT_PUBLIC_APP_URL` CANNOT SEPARATE THEM EITHER — it is `https://eno.vn` in the local env
 * file too, so it is true everywhere and distinguishes nothing. Checked, not assumed.
 * ⚠️ The deployed editions are HTTPS-only behind HSTS (`max-age=63072000; includeSubDomains;
 * preload`, measured on the live origin), which is why the plain-HTTP half of the audit finding was
 * already largely mitigated — this flag is defence in depth, not the thing that was holding.
 * ⚠️ THE ONE UNCOVERED COMBINATION, STATED SO NOBODY REDISCOVERS IT: a PRODUCTION build served over
 * plain http by something OTHER than scripts/preview.mjs — a bare `npm run start`, or a container
 * run by hand on localhost. `LOCAL_AUTH` is absent there, so the server says `secure: true` while
 * the browser reads `http:` and says `false`, and WebKit then drops the server-set cookie. It is
 * left uncovered on purpose: CLAUDE.md already states that `npm run start` alone is NOT a preview
 * (it serves no static assets — scripts/preview.mjs exists precisely to copy them), so that
 * launcher is not a surface anyone signs in on. Use `preview:vn` or `dev:vn`.
 *
 * ⚠️ SCOPE, MEASURED: these two factories are the only things in `src` that write a session cookie —
 * no route or component sets an `sb-` cookie by hand. Other cookies this app writes from JS (`lang`,
 * `eno_attr`) carry no `Secure` flag either; they hold no credential, and changing them is a
 * separate piece of work rather than something to slip in here.
 *
 * ⚠️ `sameSite` and `path` are LEFT ALONE deliberately. `lax` is what the cross-edition handoff
 * between eno.vn and eno.forum was built and tested against; tightening it is a separate change
 * with its own blast radius.
 */
/**
 * @param proto the ORIGIN'S OWN scheme, and only the browser can supply one: `location.protocol` is
 *   the document's real origin, not a header anybody can write. The server passes nothing.
 *
 * ⛔ NO REQUEST HEADER IS READ HERE, AND TWO DRAFTS LEARNED THAT THE HARD WAY. The first consulted
 * `Host` to spot a loopback preview; a reviewer pointed out the caller writes `Host`, so a request
 * arriving as `Host: localhost` would be handed a cookie without `Secure` in production. The second
 * swapped it for `x-forwarded-proto` — which is the same class of input, and worse here: a proxy
 * that APPENDS to `X-Forwarded-*` puts the client's own claim first, exactly the element a
 * `.split(',')[0]` picks. Measured on the box before concluding: the origin nginx config sets NO
 * `X-Forwarded-Proto` at all, so the value the container sees is whatever the chain happens to
 * forward — a control resting on something nobody in this repo configures or tests.
 * ⚠️ AND THE FAILURE WAS SILENT IN THE DANGEROUS DIRECTION: had the origin seen `http`, every
 * production cookie would have quietly lost `Secure` with the whole suite green and HSTS hiding the
 * symptom. The server now derives the answer from BUILD-TIME facts it fully controls.
 *
 * ⚠️ `LOCAL_AUTH` is what distinguishes the local preview, and it is not a new mechanism: it is set
 * by scripts/preview.mjs and by nothing else, and the box's build env (/opt/eno/secrets/*.env) does
 * not contain it, so a deployed artifact has it absent. The existing local sign-in hatch already
 * turns on exactly this signal.
 * ⚠️ `NEXT_PUBLIC_LOCAL_AUTH` IS CHECKED TOO, because Next inlines only `NEXT_PUBLIC_*` — a bare
 * `LOCAL_AUTH` read is `undefined` in the browser bundle, so the fallback would not have meant the
 * same thing on both sides. It never fires there today (a document always has a protocol), but a
 * guarantee that holds for only one of two consumers is not one worth writing down.
 */
export function authCookieOptions({ proto }: { proto?: string | null } = {}) {
  // ⛔ NO COMMA-SPLITTING. An earlier draft parsed `x-forwarded-proto`, so it took the first hop of
  // a chain — and a reviewer pointed out that keeping that parsing DOCUMENTS a header shape this
  // function must never be handed. `location.protocol` is a single token; anything comma-separated
  // is a forwarded header, and the right answer to one is to not pass it. Now it cannot be parsed
  // into an accidental `http`.
  const scheme = proto?.trim().replace(/:$/, '').toLowerCase()
  if (scheme) return { secure: scheme === 'https' }
  // ⚠️ FAILS SECURE. Production is `Secure` unless this is demonstrably the local preview.
  // ⚠️ TWO DIFFERENT MECHANISMS COVER THE TWO LOCAL SURFACES, and it is worth being exact about
  // which does what, because an earlier version of this comment credited both to `LOCAL_AUTH`.
  // `npm run dev:vn` is safe because of `NODE_ENV`: it is a development build, so the answer is
  // `false` before the flag is even consulted. `npm run preview:vn` is a PRODUCTION build, so there
  // the flag is the only thing separating it. ⛔ Anyone who builds with `NODE_ENV=production` for
  // local iteration WITHOUT going through preview.mjs therefore loses the first protection and
  // keeps only the second — which is the uncovered combination described above.
  const isLocalPreview = process.env.LOCAL_AUTH === '1' || process.env.NEXT_PUBLIC_LOCAL_AUTH === '1'
  return { secure: process.env.NODE_ENV === 'production' && !isLocalPreview }
}
