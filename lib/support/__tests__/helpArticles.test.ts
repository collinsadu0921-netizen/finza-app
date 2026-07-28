import {
  searchHelpArticles,
  getHelpArticleById,
  getHelpArticlesGroupedByCategory,
  HELP_ARTICLES,
} from "../helpArticles"

describe("helpArticles", () => {
  it("finds credit note article by search", () => {
    const results = searchHelpArticles("credit note")
    expect(results.some((a) => a.id === "create-credit-note")).toBe(true)
  })

  it("finds hubtel setup article by search", () => {
    const results = searchHelpArticles("hubtel")
    expect(results.some((a) => a.id === "setup-hubtel-payments")).toBe(true)
  })

  it("finds reversal article by search", () => {
    const results = searchHelpArticles("reversal")
    expect(results.some((a) => a.id === "journal-entry-reversals")).toBe(true)
  })

  it("supports multi-word search", () => {
    const results = searchHelpArticles("partial payment")
    expect(results.some((a) => a.id === "record-partial-payment")).toBe(true)
  })

  it("loads receipt article by id", () => {
    const article = getHelpArticleById("send-receipt")
    expect(article?.title).toMatch(/receipt/i)
    expect(article?.steps.length).toBeGreaterThan(0)
  })

  it("groups articles by category without empty sections", () => {
    const grouped = getHelpArticlesGroupedByCategory()
    expect(grouped.length).toBeGreaterThan(10)
    grouped.forEach((g) => {
      expect(g.articles.length).toBeGreaterThan(0)
      expect(g.description.length).toBeGreaterThan(0)
    })
  })

  it("has at least 40 articles", () => {
    expect(HELP_ARTICLES.length).toBeGreaterThanOrEqual(40)
  })

  it("explains supplier bills: AP, expenses, inventory, usage, payment, taxes", () => {
    const article = getHelpArticleById("add-supplier-bill")
    expect(article?.title).toBe("Record a supplier bill")
    const blob = [article?.summary, ...(article?.steps ?? [])].join("\n").toLowerCase()
    expect(blob).toMatch(/accounts payable/)
    expect(blob).toMatch(/expense/)
    expect(blob).toMatch(/inventory/)
    expect(blob).toMatch(/used on a job|fulfilled/)
    expect(blob).toMatch(/payment/)
    expect(blob).toMatch(/withholding tax|wht|input tax/)
    expect(article?.summary).toMatch(/expense lines go to expenses/i)
    expect(article?.summary).toMatch(/inventory/i)
  })
})
