/**
 * A CATEGORY'S NAME WHERE IT IS A WAY IN — a rail tile, a "categories" chip, a footer link — rather than
 * the title of the page it opens.
 *
 * ⛔ WHY TEACHERS SAYS "FIND A TEACHER" THERE (nav audit N8, 2026-10-05). The Teachers category holds teacher
 * PROFILES — people offering to teach, for schools and companies to hire. An expat English teacher looking
 * for WORK read the "Teachers / Giáo viên" tile as theirs, tapped it, and found one profile and no jobs; the
 * teaching jobs are under Jobs › Teaching. The entry point now says who it is for.
 *
 * ⚠️ ONLY THE ENTRY POINT. The category's own name (taxonomy.ts, the Category row) stays "Teachers / Giáo
 * viên": it is the /c/teachers H1, its breadcrumb, its <title> and description and the explorer's result
 * line, and renaming it would change all of those along with the tile. The slug and URLs are untouched.
 *
 * Import-free and tiny on purpose: the footer (rendered by ~30 routes) and the home rail import it, and
 * neither may pull taxonomy.ts in (taxonomy-nav.ts says why). The `{ name: …, nameVi: … }` literal is the
 * shape scripts/gen-ui-strings.mjs harvests, so the nine machine-translated languages get the English
 * pre-warmed like every other category name.
 */
export type EntryLabel = { name: string; nameVi?: string }

export const CATEGORY_ENTRY_LABELS: Readonly<Record<string, EntryLabel>> = {
  teachers: { name: 'Find a teacher', nameVi: 'Tìm giáo viên' },
}

/** The label a link INTO `cat` wears: its entry label where it has one, else its own name. */
export function categoryEntryLabel(cat: { slug: string; name: string; nameVi?: string | null }): EntryLabel {
  // `Object.hasOwn`, not `CATEGORY_ENTRY_LABELS[slug]`: a slug of 'constructor' must not read the prototype.
  return Object.hasOwn(CATEGORY_ENTRY_LABELS, cat.slug)
    ? CATEGORY_ENTRY_LABELS[cat.slug]
    // `nameVi` passes through as it came — a category with none must still reach the dictionary / machine
    // translation the way it did before this helper, not be handed its English name as "Vietnamese".
    : { name: cat.name, nameVi: cat.nameVi ?? undefined }
}
