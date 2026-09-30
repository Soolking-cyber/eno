/**
 * THE KINDS OF RENTAL THAT ARE A HOME — somewhere a person lives: an apartment, a house, a room, a serviced apartment.
 *
 * ⛔ ONE DEFINITION, SHARED. `rentals` also holds offices and shopfronts (`office-rental`, "Mặt bằng")
 * and, once build/vehicle-rentals lands, ~6,400 cars and motorbikes. A page that says "homes" must
 * select exactly these, and so must wave-B D1/D1b's `homes=1` feed filter and /c/rentals'
 * homes-only preview when they land — import this, never retype the list.
 * Measured 2026-09-29: 4 of the 8 cards on /housing-vietnam-expats' rail were Office/shopfront
 * (a 1,400m² unit among them), because the landing narrowed by category alone (C1-HOUSING).
 * ⛔ `homestay-serviced` (serviced apartments, "Homestay") IS A HOME — owner decision O-45, 2026-09-30
 * ("do what's recommended"): a serviced apartment is somewhere a person lives month to month, so the
 * housing landings, their rails and their live counts include it. `hotel-short-stay` stays out: a hotel
 * night is a stay, not a home. Offices/shopfronts and vehicles stay out as above.
 */
export const HOME_RENTAL_SUBCATS = ['apartment-rental', 'house-rental', 'room-rental', 'homestay-serviced'] as const

/**
 * The /api/listings param a rentals district page sends with its sort and Show-more while it lists
 * homes only (SEO wave B, D1), so page 2 comes from the set page 1 listed (feed-query.ts). Ignored
 * outside `category=rentals`, and when a subcategory is chosen (that is already narrower).
 */
export const HOMES_ONLY_PARAM = { key: 'homes', value: '1' } as const
