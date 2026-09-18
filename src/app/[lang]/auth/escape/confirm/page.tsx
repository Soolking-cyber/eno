import { isNonce } from '@/lib/auth/handoff'
import { HandoffConfirm } from '@/components/marketplace/handoff-confirm'

// Runs in the REAL BROWSER, immediately after Google. The visitor's authorization code is parked;
// this is where they confirm it was really them, and receive the pairing code to carry back.
//
// ⚠️ NO SESSION IS CREATED IN THIS BROWSER, DELIBERATELY. Signing them in here as well would be the
// obvious helpful thing and it is wrong twice: it leaves a live session in a browser they only
// opened to get past Google's webview block, and it hides the failure — they would see a working,
// signed-in eno.vn and never think to switch back to the app that is still waiting.
export const dynamic = 'force-dynamic'

export default async function ConfirmPage({ searchParams }: { searchParams: Promise<{ h?: string; ok?: string }> }) {
  const { h, ok } = await searchParams
  return <HandoffConfirm nonce={isNonce(h) ? h : null} parked={ok === '1'} />
}
