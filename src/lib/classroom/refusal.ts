/**
 * A refusal that tells the learner WHEN they can practise again — the week's or the day's sessions are used up, or the
 * teacher's tests for today. ApiError carries a code only, so the session routes catch this one and answer
 * `{ error, nextAt }` (409); the page turns nextAt into "Next practice: Thursday".
 */
export type NextAtCode = 'week_limit' | 'day_limit' | 'test_limit'

export class NextAtRefusal extends Error {
  constructor(readonly code: NextAtCode, readonly nextAt: string) {
    super(code)
    this.name = 'NextAtRefusal'
  }
}
