import { describe, expect, it } from 'vitest'
import { firstPlan, parseFocus, pickPlan, type PlanRow } from './plans'
import { mergeFocus, parseFocusItems, workingOnLines } from './focus'

const row = (over: Partial<PlanRow>): PlanRow => ({ id: 'p', source: 'ai', status: 'draft', brief: 'b', focus: {}, openingLine: '', updatedAt: new Date('2026-10-01'), ...over })

describe('plans', () => {
  it('⛔ a teacher-approved plan wins over any AI draft, newer or older', () => {
    const teacher = row({ id: 't', source: 'teacher', status: 'approved', updatedAt: new Date('2026-10-01') })
    const draft = row({ id: 'd', updatedAt: new Date('2026-10-05') })
    expect(pickPlan([draft, teacher])?.id).toBe('t')
    expect(pickPlan([draft])?.id).toBe('d')
    expect(pickPlan([row({ status: 'used' })])).toBeNull()
  })
  it('drill sentences are short and speakable — anything else is dropped', () => {
    const f = parseFocus({ drill: ['Say <b>hi</b>', 'x'.repeat(90), 'What’s up', 'Can you help me?', 'Say “hello” please', 'I think so.'], focusWords: ['a', 'a', 'b'] })
    // typographic apostrophes made plain, double quotes dropped (iPhone Smart Punctuation) — kept; at most PLAN_LIMITS.drill
    expect(f.drill).toEqual(["What's up", 'Can you help me?', 'Say hello please'])
    expect(f.focusWords).toEqual(['a', 'b'])
  })
  it('the first plan is a get-to-know-you talk, simpler at A1–A2, opening with the teacher’s greeting', () => {
    expect(firstPlan('A1', 'Hello there!', 'Anna').openingLine).toBe('Hello there!')
    expect(firstPlan('A2', '', 'Anna').openingLine).toContain("I'm Anna")
    expect(firstPlan('A1', '', 'Anna').brief).toMatch(/present simple/)
    expect(firstPlan('B2', '', 'Anna').brief).toMatch(/reasons/)
  })
})

describe('"Working on"', () => {
  const now = new Date('2026-10-25T00:00:00Z')
  it('counts a mistake each session it comes back, and fixes it once it is right twice since it last came up wrong', () => {
    let items = mergeFocus([], [{ kind: 'grammar', label: 'past tense -ed' }], [], now)
    items = mergeFocus(items, [{ kind: 'grammar', label: 'Past tense -ed' }], [], now)
    expect(items[0]).toMatchObject({ count: 2, fixed: false })
    items = mergeFocus(items, [], ['grammar: past tense -ed'], now)
    expect(items[0]).toMatchObject({ rightStreak: 1, fixed: false })
    items = mergeFocus(items, [], ['grammar: past tense -ed'], now)
    expect(items[0].fixed).toBe(true)
    // …and it reopens when it comes back
    items = mergeFocus(items, [{ kind: 'grammar', label: 'past tense -ed' }], [], now)
    expect(items[0]).toMatchObject({ fixed: false, rightStreak: 0, count: 3 })
  })
  it('⛔ a session with no evidence neither credits nor resets (only the top lines are worked on); a slip does reset', () => {
    let items = mergeFocus([], [{ kind: 'grammar', label: 'articles' }], [], now)
    items = mergeFocus(items, [], ['grammar: articles'], now)
    items = mergeFocus(items, [], [], now)
    expect(items[0]).toMatchObject({ rightStreak: 1, fixed: false })
    items = mergeFocus(items, [{ kind: 'grammar', label: 'articles' }], [], now)
    items = mergeFocus(items, [], ['grammar: articles'], now)
    expect(items[0]).toMatchObject({ rightStreak: 1, fixed: false, count: 2 })
    items = mergeFocus(items, [], ['grammar: articles'], now)
    expect(items[0].fixed).toBe(true)
  })
  it('⛔ credit matches the KIND too, and a bare label is never credited (opus)', () => {
    let items = mergeFocus([], [{ kind: 'pronunciation', label: 'th' }, { kind: 'vocabulary', label: 'th' }], [], now)
    items = mergeFocus(items, [], ['pronunciation: th', 'th'], now)
    expect(items.find((i) => i.kind === 'pronunciation')!.rightStreak).toBe(1)
    expect(items.find((i) => i.kind === 'vocabulary')!.rightStreak).toBe(0)
  })
  it('a blank label is no item', () => {
    expect(mergeFocus([], [{ kind: 'grammar', label: '   ' }, { kind: 'grammar', label: '' }], [], now)).toEqual([])
  })
  it('⛔ a full list still takes this session’s new mistake (opus)', () => {
    let items = mergeFocus([], Array.from({ length: 20 }, (_, i) => ({ kind: 'grammar' as const, label: `old ${i}` })), [], new Date('2026-10-01'))
    items = mergeFocus(items, Array.from({ length: 20 }, (_, i) => ({ kind: 'grammar' as const, label: `old ${i}` })), [], new Date('2026-10-02'))
    items = mergeFocus(items, [{ kind: 'vocabulary', label: 'brand new' }], [], now)
    expect(items).toHaveLength(20)
    expect(items.some((i) => i.label === 'brand new')).toBe(true)
  })
  it('open items come first, most frequent first; the tutor recycles only open ones, as "kind: label"', () => {
    const items = parseFocusItems([
      { kind: 'grammar', label: 'a', count: 1, fixed: true },
      { kind: 'pronunciation', label: 'th', count: 5 },
      { kind: 'vocabulary', label: 'b', count: 2 },
      { kind: 'nonsense', label: 'x' },
    ])
    expect(items).toHaveLength(3)
    expect(workingOnLines(items)).toEqual(['pronunciation: th', 'vocabulary: b'])
  })
})
