import { revalidatePath } from 'next/cache'
import { LANG_VARIANTS } from './lang-variant'

/**
 * ⛔ PURGE A PUBLIC PATH IN EVERY LANGUAGE — `revalidatePath('/listings/x')` NO LONGER PURGES ANYTHING.
 *
 * Pages render under the hidden `[lang]` segment (src/proxy.ts), so the ISR entry for `/listings/x`
 * is keyed `/vi/listings/x` and `/en/listings/x`, and its implicit tag is `_N_T_/vi/listings/x`.
 * Measured on Next 16.3.1: `revalidatePath('/items/7')` tombstoned `_N_T_/items/7`, which no cached
 * page carries — it returned normally and changed nothing. A sold or edited listing would have kept
 * showing its old page for the full 30-day window, silently.
 *
 * A PATTERN (`/listings/[id]` with a type) is prefixed with the segment itself, which covers both
 * variants in one tag.
 */
export function revalidatePublicPath(path: string, type?: 'page' | 'layout'): void {
  if (path.includes('[')) {
    revalidatePath(`/[lang]${path === '/' ? '' : path}`, type)
    return
  }
  for (const lang of LANG_VARIANTS) revalidatePath(`/${lang}${path === '/' ? '' : path}`, type)
}
