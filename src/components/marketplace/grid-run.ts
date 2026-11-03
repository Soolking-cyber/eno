/** Do these rows carry on from the rows before them: the same rows in the same places, perhaps with more after? An appended page does; a new answer does not. */
export function rowsContinue(before: readonly { id: string }[], after: readonly { id: string }[]): boolean {
  return before.length <= after.length && before.every((row, i) => row.id === after[i].id)
}

