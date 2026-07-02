import { searchHelpArticles, getHelpArticleById } from "../helpArticles"

describe("helpArticles", () => {
  it("finds credit note article by search", () => {
    const results = searchHelpArticles("credit note")
    expect(results.some((a) => a.id === "create-credit-note")).toBe(true)
  })

  it("loads receipt article by id", () => {
    const article = getHelpArticleById("send-receipt")
    expect(article?.title).toMatch(/receipt/i)
    expect(article?.steps.length).toBeGreaterThan(0)
  })
})
