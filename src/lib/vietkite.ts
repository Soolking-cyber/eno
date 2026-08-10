/**
 * VIETKITE — THE PARTNER'S COMPANY FACTS, IN ONE PLACE.
 *
 * VietKite (Công ty TNHH Cánh Diều Việt) is the licensed travel-and-visa company eno works with.
 * This module holds what a visitor needs to identify and contact a real company: who they are,
 * how to reach them, and the registration/licence numbers that make the claim checkable.
 *
 * ⚠️ FACTS LIVE HERE, NOT IN THE PAGE. Same rule as src/lib/site-legal.ts and for the same reason:
 * a company number typed inline into JSX is a fact nobody can find later, and the one thing worse
 * than a missing registration number is a stale one. One file, one edit, every surface updates.
 *
 * ⚠️ EMPTY STRING MEANS "NOT SUPPLIED YET", AND THE PAGE MUST HIDE THE ROW RATHER THAN PRINT A
 * BLANK. The owner is providing the phone, email and registration details separately (2026-08-10);
 * until each arrives its field stays '' and /vietkite simply does not render that line. Do NOT
 * invent a placeholder value — a plausible-looking fake phone number on a company page is worse
 * than an absent one, because it looks answered.
 *
 * ⚠️ NOTHING HERE MAY CLAIM ENO PERFORMS THE SERVICE. VietKite is the provider of record under its
 * own licence; eno introduces it. That distinction is the whole basis on which this page is
 * allowed to exist, and src/lib/visa-provider.ts already owns the sentence that states it.
 */
export type VietKiteContact = {
  /** Display name, Latin. */
  name: string
  /** Registered Vietnamese company name. */
  legalName: string
  /** E.164 preferred, e.g. "+84 …". '' until supplied. */
  phone: string
  /** '' until supplied. */
  email: string
  /** Street address as one line. '' until supplied. */
  address: string
  /** Mã số doanh nghiệp / enterprise registration number. '' until supplied. */
  registrationNo: string
  /** Travel-service licence number (giấy phép lữ hành). '' until supplied. */
  licenceNo: string
  /** Public website, absolute. '' until supplied. */
  website: string
}

export const VIETKITE: VietKiteContact = {
  name: 'VietKite',
  legalName: 'Công ty TNHH Cánh Diều Việt',
  // ⚠️ Owner is supplying these. Leave '' rather than guessing — see the note above.
  phone: '',
  email: '',
  address: '',
  registrationNo: '',
  licenceNo: '',
  website: '',
}

/** The logo, committed at public/vietkite-logo.png (500×500, transparent). */
export const VIETKITE_LOGO = '/vietkite-logo.png'

/** True once there is at least one way to actually reach them — drives whether the page shows a
 *  contact block at all, so an empty section never renders with a heading and nothing under it. */
export const VIETKITE_HAS_CONTACT = Boolean(VIETKITE.phone || VIETKITE.email || VIETKITE.address)
