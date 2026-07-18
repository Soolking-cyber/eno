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
// /auth/* is DELIBERATELY excluded from the path components: the OAuth callback must
// always complete in the browser that started the flow — if Universal Links stole
// https://eno.vn/auth/callback into the native app, the Supabase session cookies
// would land in the wrong context and sign-in would silently fail.
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
              { "/": "/listings/*" },
              { "/": "/c/*" },
              { "/": "/brands/*" },
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
