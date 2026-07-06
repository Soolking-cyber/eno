import { NextResponse } from 'next/server'
import { normalizePhoneVN } from '@/lib/otp-channels'
import { rateLimit, getRedis } from '@/lib/ratelimit'

// Which channel did the last OTP for this number actually land on? Written by
// the send-sms hook (otp-ch:{phone}, 10-min TTL); the sign-in form reads it so
// it can say "check your Telegram" instead of "check everywhere".
//
// Exposure is deliberately minimal: the key only exists for ~10 min after a
// send that Turnstile + escalating cooldowns already gate, and the channel
// (has-Telegram / has-WhatsApp) is discoverable through those apps' own APIs
// anyway. Still rate-limited so it can't be used as a bulk probe.

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  const gate = await rateLimit('otp-channel-read', ip, 30, '10 m')
  if (!gate.success) return NextResponse.json({ channel: null }, { status: 429 })

  const phone = normalizePhoneVN(new URL(req.url).searchParams.get('phone') || '')
  if (phone.length < 10) return NextResponse.json({ channel: null })

  let channel: string | null = null
  try { channel = (await getRedis()?.get<string>(`otp-ch:${phone}`)) ?? null } catch {}
  return NextResponse.json({ channel })
}
