import { NextResponse } from "next/server";

// Serves /.well-known/apple-app-site-association (via a rewrite in next.config.ts —
// the app router ignores dot-folders, so the file can't live under public/.well-known
// like assetlinks.json does).
//
// 404s until APPLE_TEAM_ID is set: Universal Links require a paid Apple Developer
// team, and serving an AASA with a bogus appID would make Apple's CDN cache a broken
// association against the domain. The owner sets the env once the team exists; until
// then iOS simply falls back to opening links in Safari, which is correct.
//
// The components MIRROR the native routing contract (AppDelegate.isRoutablePath +
// native-bootstrap's canonicalAppPath): every first-party path deep-links into the app
// EXCEPT /auth and /signin. Enumerating a handful of prefixes (the old /listings, /c,
// /brands) silently dropped the primary shared surfaces — seller storefronts (/[handle])
// and profiles (/sellers/*) opened Safari instead of the installed app, even though every
// native handler was already ready to route them in-SPA. iOS evaluates `components` top to
// bottom and the FIRST match wins, so the excludes must precede the catch-all.
//
// /auth/* and /signin are DELIBERATELY excluded: the OAuth callback must always complete in
// the browser that started the flow — if Universal Links stole https://eno.vn/auth/callback
// into the native app, the Supabase session cookies would land in the wrong context and
// sign-in would silently fail. (The custom enovn://auth-callback hop is app-internal and
// unaffected by this file.)
export async function GET() {
  const team = process.env.APPLE_TEAM_ID;
  if (!team) {
    return new NextResponse(null, { status: 404 });
  }
  // The shipped App Store bundle id must match this exactly; overridable so a
  // TestFlight/dev bundle can be associated without a code change.
  const bundle = process.env.APPLE_BUNDLE_ID || "vn.eno.app";
  return NextResponse.json(
    {
      applinks: {
        details: [
          {
            appIDs: [`${team}.${bundle}`],
            components: [
              // Excludes first (first match wins) — keep sign-in/OAuth in the browser. Globs are
              // PREFIX-style to match the native isRoutablePath (hasPrefix "/auth" | "/signin"):
              // `/auth*` (not `/auth/*`) so the bare `/auth` path is excluded too, not just
              // `/auth/callback` — otherwise a bare `/auth` would fall through to `/*` and open the app.
              { "/": "/auth*", exclude: true },
              { "/": "/signin*", exclude: true },
              // Everything else first-party deep-links into the app (storefronts, profiles,
              // dashboard, messages, post, listings, categories, brands …).
              { "/": "/*" },
            ],
          },
        ],
      },
    },
    {
      headers: {
        "Cache-Control": "public, max-age=3600",
      },
    }
  );
}
