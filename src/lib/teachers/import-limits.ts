/**
 * The CV reader's limits (teacher CV import, 2026-10-15) — one module for the browser (the panel says them before a
 * file is sent) and the server (src/lib/teachers/import-file.ts and the route enforce them).
 */

/** Under Next's 10 MiB /api body cap (proxyClientMaxBodySize), the multipart envelope included. */
export const IMPORT_MAX_BYTES = 8 * 1024 * 1024
/** A CV is a few pages; a 30-page PDF is a portfolio or a book — refused before any model reads it. */
export const IMPORT_MAX_PDF_PAGES = 15
/** Word text from the browser — far above any CV, far below what would cost real money. */
export const IMPORT_MAX_TEXT_CHARS = 60_000
