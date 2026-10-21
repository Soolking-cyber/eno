/**
 * A passport number as a person types it, or null when it cannot be one. ICAO 9303 numbers are letters and
 * digits — nine in the MRZ field, a longer one overflowing into the optional data (up to about 22 in all) —
 * so 4–22 is deliberately loose: a reviewer reading the photograph, not this regex, is the check. Spaces,
 * dashes and `<` filler are how people copy it, not part of it.
 *
 * Shared by the verify form (in front of Send), the submit service (in front of the consent challenge) and
 * the review (the number the reviewer re-types off the photo), so the three can never disagree on a shape.
 */
export function passportNumberShape(raw: string | undefined | null): string | null {
  const v = (raw ?? '').toUpperCase().replace(/[\s<-]/g, '')
  return /^[A-Z0-9]{4,22}$/.test(v) ? v : null
}
