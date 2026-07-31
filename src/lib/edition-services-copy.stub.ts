/**
 * MARKETPLACE-EDITION STUB for edition-services-copy.ts.
 *
 * eno.vn is a licensed sàn TMĐT. next.config.ts aliases the real module here so its link labels and
 * tile names — "Vietnam e-Visa online", "Trip planner", "Hỗ trợ e-Visa Việt Nam" — are never emitted
 * into a client chunk. Empty arrays render nothing at every call site.
 */
export type ServicesLink = { labelEn: string; labelVi: string; href: string }
export type ServicesTile = { key: string; name: string; nameVi: string; icon: string; kind: 'filter' | 'route'; href: string }

export const SERVICES_FOOTER_LINKS: Record<'popular' | 'explore' | 'help', ServicesLink[]> = { popular: [], explore: [], help: [] }
export const SERVICES_DESK_TILES: ServicesTile[] = []
