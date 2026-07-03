"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import {
  POPULAR_HELP_ARTICLE_IDS,
  getHelpArticleById,
  getHelpArticlesGroupedByCategory,
  searchHelpArticles,
} from "@/lib/support/helpArticles"

export default function HelpCenterClient() {
  const [query, setQuery] = useState("")

  const results = useMemo(() => searchHelpArticles(query), [query])
  const popular = useMemo(
    () =>
      POPULAR_HELP_ARTICLE_IDS.map((id) => getHelpArticleById(id)).filter(
        (a): a is NonNullable<typeof a> => a != null
      ),
    []
  )
  const grouped = useMemo(() => getHelpArticlesGroupedByCategory(), [])

  const showBrowse = query.trim().length === 0

  return (
    <div className="space-y-8">
      <div>
        <label htmlFor="help-search" className="sr-only">
          Search help articles
        </label>
        <input
          id="help-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search help articles… (e.g. reversal, VAT, credit note, overdue)"
          className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-slate-700 dark:bg-slate-900"
        />
      </div>

      {showBrowse ? (
        <>
          <section>
            <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500">
              Popular guides
            </h2>
            <ul className="mt-3 grid gap-2 sm:grid-cols-2">
              {popular.map((article) => (
                <li key={article.id}>
                  <Link
                    href={`/help/${article.id}`}
                    className="block rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm transition hover:border-blue-200 hover:bg-blue-50/50 dark:border-slate-700 dark:bg-slate-900"
                  >
                    <div className="text-sm font-medium text-slate-800 dark:text-slate-100">
                      {article.title}
                    </div>
                    <p className="mt-0.5 line-clamp-2 text-xs text-slate-500">{article.summary}</p>
                  </Link>
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500">
              Browse by topic
            </h2>
            <div className="mt-4 space-y-8">
              {grouped.map(({ category, description, articles }) => (
                <div
                  key={category}
                  className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900/40"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h3 className="text-base font-semibold text-slate-900 dark:text-white">
                      {category}
                    </h3>
                    <span className="text-xs text-slate-400">
                      {articles.length} article{articles.length === 1 ? "" : "s"}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{description}</p>
                  <ul className="mt-4 grid gap-2 sm:grid-cols-2">
                    {articles.map((article) => (
                      <li key={article.id}>
                        <Link
                          href={`/help/${article.id}`}
                          className="group block rounded-lg px-2 py-2 text-sm transition hover:bg-slate-50 dark:hover:bg-slate-800/60"
                        >
                          <span className="font-medium text-blue-600 group-hover:underline dark:text-blue-400">
                            {article.title}
                          </span>
                          {article.planNote ? (
                            <span className="mt-0.5 block text-[11px] text-amber-600 dark:text-amber-500">
                              {article.planNote}
                            </span>
                          ) : null}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </section>
        </>
      ) : (
        <section>
          <h2 className="text-sm font-semibold text-slate-500">
            {results.length} result{results.length === 1 ? "" : "s"}
          </h2>
          <ul className="mt-3 space-y-3">
            {results.length === 0 ? (
              <li className="text-sm text-slate-500">
                No articles match your search. Try words like &quot;reversal&quot;, &quot;VAT&quot;, or
                &quot;overdue&quot;, or{" "}
                <Link href="/help/contact" className="text-blue-600 hover:underline">
                  contact support
                </Link>
                .
              </li>
            ) : (
              results.map((article) => (
                <li key={article.id}>
                  <Link
                    href={`/help/${article.id}`}
                    className="block rounded-lg border border-slate-200 bg-white p-4 shadow-sm hover:border-blue-200 dark:border-slate-700 dark:bg-slate-900"
                  >
                    <div className="text-xs font-medium uppercase tracking-wider text-slate-400">
                      {article.category}
                    </div>
                    <div className="mt-0.5 font-medium text-slate-900 dark:text-white">
                      {article.title}
                    </div>
                    <p className="mt-1 text-sm text-slate-500">{article.summary}</p>
                  </Link>
                </li>
              ))
            )}
          </ul>
        </section>
      )}

      <section className="rounded-xl border border-slate-200 bg-slate-50 p-6 dark:border-slate-700 dark:bg-slate-900/40">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Still need help?</h2>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          Our team can help with billing, invoices, and account questions.
        </p>
        <Link
          href="/help/contact"
          className="mt-4 inline-flex items-center rounded-lg bg-slate-800 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-700"
        >
          Contact Finza Support
        </Link>
      </section>
    </div>
  )
}
