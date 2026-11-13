import { facebookConnectConfigured } from '@/lib/auth/facebook-connect'
import { facebookSignInEnabled } from '@/lib/auth/facebook'

/**
 * Is Import from Facebook switched on here: its worker is configured (FB_IMPORT_WORKER_TOKEN), Connect Facebook is configured, and
 * Facebook sign-in is on. One answer for the signed-in import (GET /api/fb-import) and for a guest's view of the tab
 * (GET /api/fb-import/available — owner, 2026-11-13: the Facebook ads land signed-out visitors on it).
 */
export async function fbImportOn(): Promise<boolean> {
  return Boolean(process.env.FB_IMPORT_WORKER_TOKEN?.trim()) && facebookConnectConfigured() && (await facebookSignInEnabled().catch(() => false))
}
