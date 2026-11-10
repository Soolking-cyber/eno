/**
 * A CODE-SPLIT MODULE THAT CAN BE FETCHED AHEAD, AND THEN RENDERS WITHOUT ITS PLACEHOLDER (2026-11-10).
 *
 * `next/dynamic` (React.lazy underneath) shows its `loading` placeholder on the first render of a lazy component even when
 * the chunk is already in memory: `import()` answers with a promise, a promise settles in a microtask, and React has
 * committed the placeholder by then. For one row that is invisible. For the explorer's list it is a frame of 94.5px
 * placeholders replaced by rows of 75 to 95px: every row under the first short one moves (measured on a phone's Jobs feed:
 * layout shift 0.04, once per visit, when the list first draws).
 *
 * `loader()` is what to hand `dynamic()`. Until the module has loaded it returns the import's own promise, so nothing
 * changes. Once it has (because `preload()` was called when the need became known, or an earlier render loaded it), it
 * returns a thenable that calls back SYNCHRONOUSLY. React.lazy's initializer reads the module in that same call
 * (`lazyInitializer`: `ctor().then(…)`, then "if resolved, return it") and renders the component at once: no placeholder,
 * no second commit.
 * ⚠️ The thenable is deliberately not a Promise (a Promise can never settle synchronously). It implements exactly what its
 * two callers use: `.then(onFulfilled)` chains (ours, then next/dynamic's `convertModule`), and React's final
 * `.then(resolve, reject)`. It never rejects: it exists only once a value does.
 * ⚠️ A failed load is forgotten HERE, so a preload that failed on a dropped connection does not pin a rejected promise:
 * the next `preload()`, or the render's own `loader()` call, asks again. (What React.lazy does with a load that fails
 * during its own render is unchanged: it keeps that rejection, as it always has.)
 */
export function preloadable<M>(load: () => Promise<M>): { preload: () => Promise<M>; loader: () => Promise<M>; loaded: () => boolean } {
  let value: { module: M } | null = null
  let pending: Promise<M> | null = null
  const preload = (): Promise<M> => {
    if (!pending) {
      pending = load().then(
        (m) => { value = { module: m }; return m },
        (e) => { pending = null; throw e },
      )
    }
    return pending
  }
  return {
    preload,
    // Typed as the Promise `dynamic()` asks for; see the note above on why the loaded case is not one.
    loader: () => (value ? (settled(value.module) as unknown as Promise<M>) : preload()),
    loaded: () => value !== null,
  }
}

/**
 * A thenable already holding `v`. `.then(f)` runs `f` NOW and returns the next link:
 *   · `f` returns a plain value: another settled link (still synchronous: this is the path React.lazy reads);
 *   · `f` returns a promise or thenable: that promise itself (adopted, as a promise chain would; from there on it is an
 *     ordinary asynchronous chain);
 *   · `f` throws: a rejected promise, never an exception out of `.then`.
 * `catch` passes the value through (there is nothing to catch); `finally` runs its callback and passes the value through,
 * waiting for it if it returns a promise. So a caller may treat `loader()` as the promise its type says it is; only the
 * all-synchronous chain gets the synchronous answer.
 */
type Settled<T> = PromiseLike<T> & { catch: (onRejected?: unknown) => Settled<T>; finally: (onFinally?: (() => unknown) | null) => PromiseLike<T> }
const isThenable = (x: unknown): x is PromiseLike<unknown> => !!x && (typeof x === 'object' || typeof x === 'function') && typeof (x as { then?: unknown }).then === 'function'
function settled<T>(v: T): Settled<T> {
  const self: Settled<T> = {
    then<R1 = T, R2 = never>(onFulfilled?: ((value: T) => R1 | PromiseLike<R1>) | null): PromiseLike<R1 | R2> {
      if (!onFulfilled) return self as unknown as PromiseLike<R1>
      try {
        const next = onFulfilled(v)
        return isThenable(next) ? (next as PromiseLike<R1>) : settled(next as R1)
      } catch (e) {
        return Promise.reject(e)
      }
    },
    catch: () => self,
    finally: (onFinally) => {
      try {
        const r = onFinally?.()
        return isThenable(r) ? Promise.resolve(r).then(() => v) : self
      } catch (e) {
        return Promise.reject(e)
      }
    },
  }
  return self
}
