import 'server-only'
import { IS_MARKETPLACE, SITE_NAME } from '@/lib/edition'
import { COMPANY } from '@/lib/site-legal'
import { getVisaShopSeller, VISA_SHOP_OWNER_EMAILS } from '@/lib/visa-shop'

/**
 * WHO THE FINISHED-VISA EMAIL SPEAKS AS — per edition, and on eno.vn never as eno.vn.
 *
 * ⛔ THE MARKETPLACE BUILD SENDS THIS MAIL TOO. src/lib/emails/visa-result.ts says it is "sent ONLY by
 * the services edition", and that stopped being true when eno-build.sh began building eno.vn with
 * MARKETPLACE_HOSTS_SERVICES=true: the `.svc.` routes — including
 * src/app/api/visa/admin/applications/[id]/result/route.svc.ts, the desk's "upload the result" button
 * on /admin/visas/[id] — compile into eno.vn, and the partner desk (VietKite) operates its cases there
 * (src/lib/desk-operator.ts). Passing SITE_NAME + COMPANY.email, as the services build correctly does,
 * made the eno.vn copy of this mail say "Thank you for trusting eno.vn with your Vietnam e-Visa", name
 * support@eno.vn, and close with the Công ty TNHH ENO legal footer: the licensed sàn TMĐT named in
 * writing as the provider of a service it may not offer.
 *
 * ⚠️ ON eno.vn THE MAIL IS THE PARTNER'S, SENT THROUGH THE PLATFORM. The name it speaks as is the visa
 * storefront's own name — the Seller that owns the visa listings on this deployment and that the
 * applicant has been chatting with (getVisaShopSeller, keyed on VISA_SHOP_OWNER_EMAIL). eno.vn appears
 * only as the channel ("Provided by <partner> via eno.vn"), never as the provider or a contact.
 *
 * ⚠️ NO SUPPORT ADDRESS ON eno.vn. The repo holds no verified contact inbox for the partner (the
 * provider record in src/lib/visa-provider.ts is placeholders, and is stubbed out of this build), and
 * the storefront owner's LOGIN address is not a published contact. So the mail points the applicant at
 * the chat — where the desk already answers — and names no inbox at all.
 *
 * ⛔ FAILS CLOSED. If the storefront cannot be resolved, or its name is eno.vn's own, there is no
 * honest name to send as: the result is `null` and the caller sends nothing (`unavailable`). The visa
 * is already stored and its card is already in the applicant's chat, which is the delivery that
 * matters; an email that names the licensed company as the visa provider is worse than no email.
 *
 * ⛔ "eno.vn's own" MEANS THE eno BRAND, NOT ONE SPELLING OF IT. The repo's own eno-run visa
 * storefronts are called "Eno Visa" (the renamed desk, e2e/guest/visa.spec.ts), "eno Visa Services"
 * (scripts/seed-visa-shop.mjs default) and "eno.forum" — none of which contains "eno.vn" or the
 * company name, and all of which present the eno brand as the visa provider from the licensed domain.
 * So any name carrying `eno` as a whole word is refused (a word boundary on ASCII letters/digits, so
 * "VietKite" or "Xeno" pass). And because VISA_SHOP_OWNER_EMAILS falls back to support@eno.forum
 * when VISA_SHOP_OWNER_EMAIL is unset (src/lib/visa-shop.ts), an owner list that names ANY eno inbox
 * means this deployment resolved the storefront to eno's own account, whatever it happens to be
 * called today: refused too.
 */
export type VisaResultBrand = {
  /** The name the copy speaks as ("thank you for trusting …", "your … chat"). */
  siteName: string
  /** The inbox the copy names, or null to point only at the chat. */
  supportEmail: string | null
  /** Set when the mail is a partner's sent THROUGH this platform: the platform, for the footer. */
  providedVia: string | null
  /** The From display name, or null to keep the deployment's default sender name. */
  fromName: string | null
}

/** `eno` as a whole word: "Eno Visa", "eno Visa Services", "eno.forum", "ENO" — not "VietKite", "Xeno". */
const ENO_WORD = /(^|[^a-z0-9])eno([^a-z0-9]|$)/i
/** An eno inbox, on either domain or any subdomain of them: support@eno.forum, x@mail.eno.vn. */
const ENO_INBOX = /@([a-z0-9-]+\.)*eno\.(vn|forum)$/i

export async function visaResultBrand(): Promise<VisaResultBrand | null> {
  if (!IS_MARKETPLACE) {
    // The services edition IS the visa service's platform: its own name and inbox, exactly as before.
    return { siteName: SITE_NAME, supportEmail: COMPANY.email, providedVia: null, fromName: null }
  }
  if (VISA_SHOP_OWNER_EMAILS.some((e) => ENO_INBOX.test(e.trim()))) return null
  const seller = await getVisaShopSeller()
  const name = (seller?.name ?? '').replace(/\s+/g, ' ').trim()
  const lower = name.toLowerCase()
  const isEnoVn = [SITE_NAME, COMPANY.name, COMPANY.nameEn].some((own) => own && lower.includes(own.toLowerCase()))
  if (!name || isEnoVn || ENO_WORD.test(name)) return null
  return { siteName: name, supportEmail: null, providedVia: SITE_NAME, fromName: `${name} via ${SITE_NAME}` }
}
