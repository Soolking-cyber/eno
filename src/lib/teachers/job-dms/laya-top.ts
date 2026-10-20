/** The option a Laya answer ranks first, and its probability. Pure (laya.ts is server-only). */
export function top<T extends Record<string, number>>(row: T): { option: keyof T; p: number } {
  let best: keyof T = Object.keys(row)[0] as keyof T
  for (const k of Object.keys(row) as (keyof T)[]) if (row[k] > row[best]) best = k
  return { option: best, p: row[best] }
}
