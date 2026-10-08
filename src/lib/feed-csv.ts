/**
 * RFC-4180 CSV escaping for the Meta catalogue feeds (Commerce Manager CSV): the goods feed
 * (/api/feeds/facebook-catalog) and the apartment-rentals feed (/api/feeds/facebook-rentals).
 *
 * A field with a comma, quote or semicolon is wrapped in quotes — which is also what lets
 * `additional_image_link` carry a comma-separated URL list in one cell. Newlines become spaces.
 * Moved verbatim out of the goods route when the rentals feed became its second caller, so the two
 * feeds cannot escape the same title two different ways.
 */
export function escapeCsv(val: string): string {
  let clean = val.replace(/\r?\n|\r/g, ' ').trim()
  // CSV formula-injection guard: neutralize a leading =, +, - or @ so a listing title
  // can't execute as a formula when the feed is opened in a spreadsheet.
  if (/^[=+\-@]/.test(clean)) clean = `'${clean}`
  if (clean.includes('"') || clean.includes(',') || clean.includes(';')) {
    return `"${clean.replace(/"/g, '""')}"`
  }
  return clean
}
