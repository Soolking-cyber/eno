// Query-preserving target for the dashboard consolidation redirects (2026-09-01).
//
// ⚠️ WHY THIS EXISTS — a redirect that DROPS the query string silently broke the visa payment
// return. The e-Visa providers send the applicant back to `/dashboard/visa?paid=stripe&aid=…&sid=…`
// (Stripe) / `?paid=paypal&aid=…` / `?pay=cancelled` (see src/lib/visa/payments.ts), and
// cases-client reads `paid`/`pay`/`aid`/`sid`/`token` off the URL to confirm the charge. When the
// old `/dashboard/visa` page became a bare `redirect('/dashboard/services?tab=evisa')`, those params
// were thrown away and the confirmation never fired. Every consolidation redirect now routes through
// here so an in-flight return — or any deep-linked param — survives the hop to its new tab.
//
// The incoming `tab` (if any) is dropped in favour of the section's real tab, so a hand-edited
// `/dashboard/visa?tab=whatever` can't override where the redirect lands.
export function dashboardTabTarget(
  base: string,
  tab: string,
  params: Record<string, string | string[] | undefined>,
): string {
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (k === 'tab') continue
    if (Array.isArray(v)) v.forEach((x) => sp.append(k, x))
    else if (v != null) sp.set(k, v)
  }
  sp.set('tab', tab)
  return `${base}?${sp.toString()}`
}
