#!/usr/bin/env node
// ── auth_handoff: Google sign-in for contexts Google refuses ─────────────────────────────────────
//
// Google rejects OAuth inside embedded webviews (403 disallowed_useragent): in-app browsers
// (Facebook / Zalo / Instagram / TikTok), Android System WebViews, and iOS home-screen PWAs. The
// visitor must finish in a real browser, which has a SEPARATE COOKIE JAR — so a session created
// there leaves the original context logged out. This table carries the sign-in back across that
// boundary.
//
// ⚠️ IT PARKS AN AUTHORIZATION CODE, NEVER A SESSION. The PKCE `code_verifier` is generated in, and
// never leaves, the ORIGINATING context. A parked code is therefore useless to anyone else.
//
// ⚠️⚠️ AND THAT ALONE IS NOT ENOUGH — THE FIRST VERSION OF THIS WAS AN ACCOUNT TAKEOVER.
// Three reviewers found it independently. The attack: the attacker opens a handoff in THEIR app
// (their cookie, their verifier), sends the victim the escape link, the victim authenticates, the
// callback parks THE VICTIM'S code under the attacker's nonce, and the attacker claims and
// exchanges it. A pairing code displayed in the APP does not fix this — the attacker controls the
// app side and can simply read it off their own screen.
//
// THE FIX IS THE DIRECTION OF THE CODE. `pair_hmac` holds a short code MINTED IN THE BROWSER, in
// the same request that parks the authorization code, and shown ONLY on the browser's screen. The
// app must present it to redeem. An attacker's app never sees it; only the person looking at the
// browser does. That inverts the asymmetry and the takeover dies.
//
// ⚠️ THE PAIR IS STORED AS AN HMAC, NOT PLAINTEXT, and `nonce_hash` is inside the message so a pair
// captured from one row cannot be replayed against another.
import { Client } from 'pg'

const STATEMENTS = [
  [
    'auth: handoff table',
    `CREATE TABLE IF NOT EXISTS public.auth_handoff (
       nonce_hash   text        PRIMARY KEY,
       auth_url     text        NOT NULL,
       code         text,
       pair_hmac    text,
       pair_expires timestamptz,
       -- sha256 of the secret handed to the BROWSER that completed Google, as an httpOnly cookie.
       -- /consent will not mint a pairing code without it. See src/lib/auth/handoff.ts.
       browser_hash text,
       attempts     smallint    NOT NULL DEFAULT 0,
       state        text        NOT NULL DEFAULT 'pending'
                    CHECK (state IN ('pending','awaiting_consent','awaiting_pair','claimed','void')),
       created_at   timestamptz NOT NULL DEFAULT now(),
       expires_at   timestamptz NOT NULL
     )`,
  ],
  // Additive for an already-created table (the column post-dates the first version of this script).
  ['auth: handoff browser binding column', `ALTER TABLE public.auth_handoff ADD COLUMN IF NOT EXISTS browser_hash text`],
  ['auth: handoff RLS on', `ALTER TABLE public.auth_handoff ENABLE ROW LEVEL SECURITY`],
  [
    // ⚠️⚠️ REVOKE FIRST — RLS IS NOT WHAT KEEPS PostgREST OUT, GRANTS ARE. This table sits in the
    // `public` schema, which Supabase exposes over the REST API, and its rows hold a LIVE OAuth
    // authorization code. Supabase's default privileges hand SELECT on new public tables to `anon`
    // and `authenticated`, so without this revoke the codes are one unauthenticated GET away.
    'auth: handoff revoke API roles',
    `REVOKE ALL ON public.auth_handoff FROM anon, authenticated, PUBLIC`,
  ],
  [
    // ⚠️ THE OLD POLICY WAS `FOR ALL USING (true)` WITH NO `TO`, which in Postgres means TO PUBLIC —
    // i.e. every grantee, not "service role only" as its comment claimed. Both external reviewers
    // flagged it independently. Scoped to service_role now; the revoke above is the real fence and
    // this is the second one.
    'auth: handoff service-role policy',
    `DO $$ BEGIN
       IF EXISTS (SELECT 1 FROM pg_policies WHERE tablename='auth_handoff' AND policyname='service_all') THEN
         DROP POLICY service_all ON public.auth_handoff;
       END IF;
       IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='auth_handoff' AND policyname='service_only') THEN
         CREATE POLICY service_only ON public.auth_handoff FOR ALL TO service_role USING (true) WITH CHECK (true);
       END IF;
     END $$`,
  ],
  ['auth: handoff expiry index', `CREATE INDEX IF NOT EXISTS auth_handoff_expires_idx ON public.auth_handoff (expires_at)`],
]

const url = process.env.DIRECT_URL || process.env.DATABASE_URL
if (!url) {
  console.error('DIRECT_URL or DATABASE_URL required')
  process.exit(1)
}
const client = new Client({ connectionString: url })
await client.connect()
try {
  for (const [label, sql] of STATEMENTS) {
    await client.query(sql)
    console.log(`✓ ${label}`)
  }
} finally {
  await client.end()
}
