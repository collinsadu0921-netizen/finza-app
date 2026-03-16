/**
 * Simple concurrency limiter: run at most `limit` promises at a time.
 * No new dependency. Used for reconciliation mismatch batch (cap N invoices, limit concurrency).
 */

/**
 * Maps each item through `fn` with at most `limit` concurrent executions.
 * Order of results matches order of items.
 */
export async function runWithConcurrencyLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (limit < 1 || items.length === 0) return []
  const results: R[] = new Array(items.length)
  let index = 0
  async function worker(): Promise<void> {
    while (index < items.length) {
      const i = index++
      const item = items[i]
      results[i] = await fn(item, i)
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker())
  await Promise.all(workers)
  return results
}
