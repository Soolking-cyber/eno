import { NextResponse } from 'next/server'
import { clientIp } from '@/lib/client-ip'
import { normalizePhoneVN, configuredOtpChannels } from '@/lib/otp-channels'
import { rateLimit, kv } from '@/lib/ratelimit'

// Which channel did the last OTP for this number actually land on? Written by
// the send-sms hook (otp-ch:{phone}, 10-min TTL); the sign-in form reads it so
// it can say "check your Telegram" instead of "check everywhere".
//
// Exposure is deliberately minimal: the key only exists for ~10 min after a
// send that Turnstile + escalating cooldowns already gate, and the channel
// (has-Telegram / has-WhatsApp) is discoverable through those apps' own APIs
// anyway. Still rate-limited so it can't be used as a bulk probe.

export const dynamic = 'force-dynamic'

// ⚠️ WS6 — NOT MIGRATED: the throttled answer is a DOMAIN payload at 429, not an error envelope. The
// bytes are `{"channel":null}` with status 429 — deliberately the same shape as the success body
// (see the comment on that line: the 429 "carries NO capability" and the form falls back to the
// generic line by reading `channel`). `rateLimit:` can only emit `{"error":"rate_limited"}`, so
// hoisting the limiter changes both the body and what the sign-in form reads.
// Once the limiter is pinned in the handler all four options are empty — public, GET, no JSON body —
// so the wrapper would be pure churn even setting the 429 aside.
export async function GET(req: Request) {
  const ip = clientIp(req)
  // strict: fail CLOSED — if the limiter backend is down this weak has-app/
  // mid-signup oracle must not become unbounded (verification sweep 2026-07-06).
  const gate = await rateLimit('otp-channel-read', ip, 30, '10 m', { strict: true })
  // 429 deliberately carries NO capability: a throttled caller is the bulk-probe case this gate
  // exists for, and the form already falls back to the generic (still-true) line.
  if (!gate.success) return NextResponse.json({ channel: null }, { status: 429 })

  // ⚠️ `configured` MUST RIDE ALONG ON EVERY RETURN PATH, including this short-circuit. The form
  // asks once on MOUNT with an empty phone so its pre-send warning is honest on first paint; an
  // early return that omitted capability left the copy stuck on the generic fallback forever
  // (caught in a browser, not by tsc — the field is optional on the wire).
  const configured = configuredOtpChannels()
  const phone = normalizePhoneVN(new URL(req.url).searchParams.get('phone') || '')
  if (phone.length < 10) return NextResponse.json({ channel: null, configured })

  let channel: string | null = null
  try { channel = (await kv.get<string>(`otp-ch:${phone}`)) ?? null } catch {}
  // ⚠️ ALSO RETURN WHICH CHANNELS THIS DEPLOYMENT CAN ACTUALLY SEND THROUGH (2026-08-03).
  // The sign-in form warns, BEFORE the send, which app the user needs — and since SpeedSMS was
  // removed there is no floor to catch a wrong guess: the hook answers 200 even when every channel
  // fails, so a bad promise means waiting forever with no error. The form cannot read server env
  // (these are not NEXT_PUBLIC), and preference is not capability — today only Telegram is
  // configured in production, so "check Zalo" would have been a lie. Booleans only; no token, no
  // number, nothing a probe could not learn by attempting a send it is already rate-limited on.
  return NextResponse.json({ channel, configured })
}
