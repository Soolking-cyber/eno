// Subcategories now live in the canonical taxonomy (src/lib/taxonomy.ts).
// This module stays as a thin re-export for backward compatibility with the
// existing SUBCATEGORIES consumers (the API route + the explorer).
export type { SubcatDef } from './taxonomy'
export { SUBCATEGORIES } from './taxonomy'
