/**
 * THE POST WIZARD'S PROGRESS, AS THE SELLER SEES IT — a display-only view of the publish gate.
 *
 * ⚠️ WHY THIS EXISTS: post-wizard.tsx's `checks` array is the GATE (what blocks Publish), and it
 * used to be the progress display too. A gate is the wrong shape for that, because every
 * conditional gate item leaked into what the seller read as "how much is left":
 *   · while auth loaded, a guest was shown "Add your name & phone" and a badge of 7, which fell to 6
 *     once auth resolved — the form changing its mind with nobody touching it;
 *   · picking Electronics completed "Pick a category" and ADDED "Pick the condition" AND "Fill in
 *     the specifics", so forward progress left the count where it was, or raised it;
 *   · a guest's "Sign in to publish" was an `ok: true` row, rendered struck-through as if done.
 *
 * ⚠️ `ok` IS NEVER RECOMPUTED HERE — every step's `ok` is the AND of the gate rows it groups. The
 * predicates (title ≥ 3 chars, description ≥ 20, the required facets…) live in ONE place, the
 * wizard's `checks`, so the badge can never say "done" while Publish still refuses, however the
 * gate changes later. This file only groups, names, orders and hides.
 *   · title + description → one "about" step (one section on screen, one thing to finish);
 *   · condition + required facets → one "specifics" step. Picking a category completes `category`
 *     and adds `specifics` in the same render, so the count cannot rise from that pick.
 *     ⚠️ It CAN still rise by one where a SUBCATEGORY brings the first required facet (Pets › Dogs,
 *     Community › Events, Travel › Tours): the category-level shelf asks nothing, the subcategory
 *     does. That is a real new question, and inventing a pending step before it exists would make
 *     the badge disagree with the gate, which is the one thing this model must never do.
 *   · `signin` is never a step: sign-in is how Publish ends for a guest, not a field to fill, and
 *     the aside says so in words instead.
 *   · `contact` is a step only once the account is known (`showContact`).
 *   · any gate row this file does not know is shown as its own step, labelled with its gate label,
 *     so a check added to the gate later can never be invisible.
 *
 * ⚠️ EVERY t() BELOW IS A LITERAL, and the photo countdown is literal branches (plus a literal label
 * with the count appended for uncommon minimums) rather than a template, because
 * scripts/gen-ui-strings.mjs harvests only literal `t('…', '…')` pairs — a template literal never
 * reaches the pre-warmed catalogue (see the note on `checks`).
 */

export type GateCheck = { key: string; ok: boolean; label: string }

export type PublishStep = {
  key: string
  ok: boolean
  /** Shown when done (checked, struck through): what the step IS. */
  name: string
  /** Shown while outstanding: what to DO. */
  todo: string
  /** The `pw-<target>` element scrollToField() jumps to. */
  target: string
}

/** Gate rows this file groups or hides. Anything else passes through as its own step. */
const KNOWN = new Set(['photo', 'category', 'title', 'description', 'condition', 'details', 'price', 'location', 'contact', 'signin'])

export function publishSteps(i: {
  /** The wizard's publish gate, verbatim. */
  checks: readonly GateCheck[]
  photos: number
  minPhotos: number
  /** Labels of the required facets still unanswered, already translated. */
  missingFacetLabels: string[]
  /** False while auth or the profile is loading, and for a guest. */
  showContact: boolean
  t: (vi: string, en: string) => string
}): PublishStep[] {
  const { checks, t } = i
  const gate = new Map(checks.map((c) => [c.key, c]))
  const ok = (key: string) => gate.get(key)?.ok !== false
  const steps: PublishStep[] = []

  if (gate.has('photo')) {
    // ⚠️ THE COUNT IS `left`, NEVER AN ASSUMED 3. The old branches hard-coded "Add 3 photos" for any
    // minimum other than 1, so a minimum of 5 with no photos read "Add 3 photos". The common counts
    // keep their literal sentences; any other count falls back to a literal label plus the number
    // outside t() (the same shape as the specifics row below), so every string stays harvestable.
    const left = Math.max(0, i.minPhotos - i.photos)
    const n = left || i.minPhotos
    const fresh = i.photos === 0 || left === 0
    const todo = fresh && n === 1
      ? t('Thêm 1 ảnh', 'Add 1 photo')
      : fresh && n === 3
        ? t('Thêm 3 ảnh', 'Add 3 photos')
        : !fresh && n === 2
          ? t('Thêm 2 ảnh nữa', 'Add 2 more photos')
          : !fresh && n === 1
            ? t('Thêm 1 ảnh nữa', 'Add 1 more photo')
            : `${t('Số ảnh cần thêm', 'Photos still needed')}: ${n}`
    steps.push({ key: 'photo', ok: ok('photo'), name: t('Ảnh', 'Photos'), todo, target: 'photo' })
  }

  if (gate.has('category')) {
    steps.push({ key: 'category', ok: ok('category'), name: t('Danh mục', 'Category'), todo: t('Chọn danh mục', 'Pick a category'), target: 'category' })
  }

  if (gate.has('title') || gate.has('description')) {
    const titleOk = ok('title')
    steps.push({
      key: 'about',
      ok: titleOk && ok('description'),
      name: t('Tiêu đề & mô tả', 'Title & description'),
      todo: titleOk ? t('Viết mô tả (ít nhất 20 ký tự)', 'Write a description (at least 20 characters)') : t('Nhập tiêu đề', 'Add a title'),
      target: titleOk ? 'description' : 'title',
    })
  }

  if (gate.has('condition') || gate.has('details')) {
    const conditionOk = ok('condition')
    const labels = i.missingFacetLabels
    // The facet names sit OUTSIDE t(): they are taxonomy copy, already translated by the caller,
    // and ": " is punctuation. No t() string here carries leading or trailing whitespace.
    const specificsTodo = labels.length
      ? `${t('Điền thông số', 'Fill in the specifics')}: ${labels.slice(0, 2).join(', ')}${labels.length > 2 ? '…' : ''}`
      : t('Điền thông số', 'Fill in the specifics')
    steps.push({
      key: 'specifics',
      ok: conditionOk && ok('details'),
      name: t('Thông số', 'Specifics'),
      todo: conditionOk ? specificsTodo : t('Chọn tình trạng', 'Pick the condition'),
      target: conditionOk ? 'details' : 'condition',
    })
  }

  if (gate.has('price')) {
    steps.push({ key: 'price', ok: ok('price'), name: t('Giá', 'Price'), todo: t('Nhập giá', 'Set a price'), target: 'price' })
  }

  if (gate.has('location')) {
    steps.push({ key: 'location', ok: ok('location'), name: t('Khu vực', 'Location'), todo: t('Chọn khu vực', 'Set the area'), target: 'location' })
  }

  if (gate.has('contact') && i.showContact) {
    steps.push({ key: 'contact', ok: ok('contact'), name: t('Liên hệ', 'Contact'), todo: t('Thêm tên & SĐT của bạn', 'Add your name & phone'), target: 'contact' })
  }

  for (const c of checks) {
    if (!KNOWN.has(c.key)) steps.push({ key: c.key, ok: c.ok, name: c.label, todo: c.label, target: c.key })
  }

  return steps
}
