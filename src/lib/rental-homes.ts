/**
 * THE KINDS OF RENTAL THAT ARE A HOME — somewhere a person lives: an apartment, a house, a room.
 *
 * ⛔ ONE DEFINITION, SHARED. `rentals` also holds offices and shopfronts (`office-rental`, "Mặt bằng")
 * and, once build/vehicle-rentals lands, ~6,400 cars and motorbikes. A page that says "homes" must
 * select exactly these three, and so must wave-B D1/D1b's `homes=1` feed filter and /c/rentals'
 * homes-only preview when they land — import this, never retype the list.
 * Measured 2026-09-29: 4 of the 8 cards on /housing-vietnam-expats' rail were Office/shopfront
 * (a 1,400m² unit among them), because the landing narrowed by category alone (C1-HOUSING).
 * ⚠️ `homestay-serviced` (serviced apartments) is NOT in it: whether a serviced stay counts as a home
 * here is an owner decision (O-45), open as of this date.
 */
export const HOME_RENTAL_SUBCATS = ['apartment-rental', 'house-rental', 'room-rental'] as const
