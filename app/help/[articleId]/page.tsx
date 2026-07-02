import { notFound } from "next/navigation"
import HelpArticleView from "@/components/support/HelpArticleView"
import { getHelpArticleById, HELP_ARTICLES } from "@/lib/support/helpArticles"

type PageProps = {
  params: Promise<{ articleId: string }>
}

export function generateStaticParams() {
  return HELP_ARTICLES.map((a) => ({ articleId: a.id }))
}

export default async function HelpArticlePage({ params }: PageProps) {
  const { articleId } = await params
  const article = getHelpArticleById(articleId)
  if (!article) notFound()

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:py-10">
        <HelpArticleView article={article} />
      </div>
    </div>
  )
}
