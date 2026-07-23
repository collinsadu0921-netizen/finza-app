import { afterAccountingMutationUi } from "../afterAccountingMutationUi"

describe("afterAccountingMutationUi", () => {
  it("reloads local data and calls router.refresh without hard reload", () => {
    const reload = jest.fn()
    const refresh = jest.fn()
    afterAccountingMutationUi({ reload, router: { refresh } })
    expect(reload).toHaveBeenCalledTimes(1)
    expect(refresh).toHaveBeenCalledTimes(1)
  })
})
