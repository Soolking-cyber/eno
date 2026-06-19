// URL-safe slug: lowercase, strip Vietnamese diacritics, đ→d, non-alnum→dash.
export function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // combining diacritics
    .replace(/đ/g, 'd') // đ
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}
