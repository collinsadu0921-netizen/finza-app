/**
 * Client-side post-accounting UI refresh (no hard reload, no 5-minute polling).
 */

type RouterLike = { refresh: () => void }

export function afterAccountingMutationUi(options?: {
  reload?: () => void | Promise<void>
  router?: RouterLike | null
}): void {
  try {
    void options?.reload?.()
  } catch {
    // ignore reload failures; mutation already succeeded
  }
  try {
    options?.router?.refresh()
  } catch {
    // ignore
  }
}
