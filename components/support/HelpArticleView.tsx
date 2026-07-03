"use client"

import Link from "next/link"
import type { HelpArticle } from "@/lib/support/helpArticles"

export default function HelpArticleView({ article }: { article: HelpArticle }) {
  return (
    <article className="space-y-6">
      <div>
        <Link href="/help" className="text-sm text-blue-600 hover:underline dark:text-blue-400">
          ← Help & Support
        </Link>
        <p className="mt-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
          {article.category}
        </p>
        <h1 className="mt-1 text-2xl font-bold text-slate-900 dark:text-white">{article.title}</h1>
        <p className="mt-2 text-slate-600 dark:text-slate-400">{article.summary}</p>
        {article.planNote ? (
          <p className="mt-2 rounded-lg border border-amber-200/80 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800/60 dark:bg-amber-950/30 dark:text-amber-200">
            {article.planNote}
          </p>
        ) : null}
      </div>

      <ol className="list-decimal space-y-3 pl-5 text-sm leading-relaxed text-slate-700 dark:text-slate-300">
        {article.steps.map((step, i) => (
          <li key={i}>{step}</li>
        ))}
      </ol>

      {article.relatedLinks && article.relatedLinks.length > 0 ? (
        <div>
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Related links</h2>
          <ul className="mt-2 space-y-1">
            {article.relatedLinks.map((link) => (
              <li key={link.href}>
                <Link href={link.href} className="text-sm text-blue-600 hover:underline dark:text-blue-400">
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="rounded-xl border border-slate-200 bg-slate-50 p-5 dark:border-slate-700 dark:bg-slate-900/40">
        <p className="text-sm text-slate-600 dark:text-slate-400">Still stuck on this topic?</p>
        <Link
          href="/help/contact"
          className="mt-2 inline-block text-sm font-semibold text-blue-600 hover:underline dark:text-blue-400"
        >
          Contact Finza Support →
        </Link>
      </div>
    </article>
  )
}
