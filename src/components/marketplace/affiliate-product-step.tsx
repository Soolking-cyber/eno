'use client'

import { useEffect, useState } from 'react'
import { ArrowUpRight } from '@/components/ui/icons'
import { Button } from '@/components/ui/button'
import { Tr } from '@/context/language-context'

/**
 * THE SECOND STEP FOR A PARTNER WHOSE AFFILIATE LINK CANNOT REACH THE PRODUCT.
 *
 * ⛔ WHY A SECOND STEP EXISTS AT ALL, in one line: SuperSports' tracker drops the destination, so the
 * buy button lands the shopper on the shop's HOME page (measured — src/lib/affiliate-deeplink.ts has
 * the full chain). This offers them the item they actually clicked.
 *
 * ⛔ IT APPEARS ONLY AFTER THE BUY BUTTON HAS BEEN CLICKED, AND THAT ORDER IS THE WHOLE DESIGN.
 * The affiliate click is what counts the visit and sets the merchant's 30-day last-click cookie;
 * the direct product link earns nothing on its own. Shown side by side, half the shoppers would take
 * the plain one and the listing would earn nothing for a sale it produced. Shown after, the shopper
 * has already been counted and is simply being helped to the shelf.
 * ⚠️ AND IT IS THE HONEST VERSION OF "count the click, then redirect": the alternative — firing the
 * affiliate click in a hidden frame or a background tab and then sending the shopper onward — is the
 * forced-click pattern the networks prohibit, and it does not even work, because the merchant's
 * cookie would be third-party and Safari blocks it. Nothing here is hidden from the shopper.
 *
 * ⚠️ IT LISTENS FOR THE CTA RATHER THAN OWNING IT. `data-affiliate-cta` already marks that anchor
 * (the guest e2e keys on it), so the buy button stays a server-rendered link with no client
 * JavaScript in its path — the one control on this page that must work.
 *
 * ⚠️ IT SURVIVES THE ROUND TRIP. The shopper clicks, lands on the shop, comes back to this tab to
 * find the item — so the revealed state is kept in sessionStorage per listing. Session, not local:
 * it describes this visit, not this device, and it must not follow them to next week's browse.
 */
export function AffiliateProductStep({ productUrl, listingId }: { productUrl: string; listingId: string }) {
  const [opened, setOpened] = useState(false)
  const key = `eno_aff_opened_${listingId}`

  useEffect(() => {
    /**
     * ⛔ RESET FIRST, THEN READ (a reviewer's catch, and it would have cost the commission it exists
     * to protect). Next reuses this component across a client-side hop from one listing to another,
     * so `opened` from the listing the shopper just clicked through would survive into the next one
     * and reveal its direct link BEFORE its buy button was pressed — handing the shopper a way past
     * the affiliate click on every listing after the first. The call site also keys this component
     * by listing; this is the belt to that brace.
     */
    setOpened(false)
    // ⚠️ EVERY READ AND WRITE IS GUARDED. sessionStorage throws in a private window and in an
    // embedded webview with storage disabled, and this is decoration on a page whose job is the
    // listing — it degrades to "not yet clicked", never to a broken page.
    try { if (sessionStorage.getItem(key) === '1') setOpened(true) } catch { /* no storage, no memory */ }

    // ⚠️ `auxclick` TOO (a reviewer's catch): a middle-click opens the shop in a new tab without ever
    // firing `click`, so that shopper came back to a listing whose shortcut never appeared. A
    // context-menu "Open in new tab" fires neither and cannot be detected — the button itself still
    // works, so the cost is only that one path misses the shortcut.
    const onClick = (e: MouseEvent) => {
      // ⛔ LEFT OR MIDDLE BUTTON ONLY (a reviewer's catch). `auxclick` also fires for the RIGHT button,
      // so right-clicking the buy button to copy its link revealed the direct product link without the
      // shopper ever visiting the affiliate — exactly the bypass this component is ordered to prevent.
      if (e.button !== 0 && e.button !== 1) return
      const target = e.target as HTMLElement | null
      if (!target?.closest?.('[data-affiliate-cta="true"]')) return
      setOpened(true)
      try { sessionStorage.setItem(key, '1') } catch { /* the reveal still works for this render */ }
    }
    document.addEventListener('click', onClick)
    document.addEventListener('auxclick', onClick)
    return () => {
      document.removeEventListener('click', onClick)
      document.removeEventListener('auxclick', onClick)
    }
  }, [key])

  if (!opened) return null

  return (
    /* ⚠️ `aria-live="polite"` BECAUSE THIS APPEARS IN RESPONSE TO AN ACTION. A sighted shopper sees a
       new block under the button they just pressed; without this, a screen-reader user is told
       nothing at all and the second step may as well not exist. `polite` so it waits its turn. */
    <div aria-live="polite" className="flex flex-col gap-2 rounded-xl bg-muted/50 p-4">
      <p className="text-sm text-body">
        <Tr text="SuperSports opens on their home page — this takes you straight to the item." />
      </p>
      <Button asChild variant="outline" size="lg" className="w-full">
        {/* Same rel as the buy button: this is the same commercial relationship, just the plain URL,
            and an undisclosed commercial link is a link-scheme violation either way. */}
        <a href={productUrl} target="_blank" rel="sponsored nofollow noopener noreferrer" data-affiliate-product-step="true">
          <Tr text="Open this item on SuperSports" />
          <ArrowUpRight className="size-4" aria-hidden />
        </a>
      </Button>
    </div>
  )
}
