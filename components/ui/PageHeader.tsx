import { ReactNode } from "react"

interface PageHeaderProps {
  title: string
  subtitle?: string | ReactNode
  actions?: ReactNode
}

export default function PageHeader({ title, subtitle, actions }: PageHeaderProps) {
  return (
    <div className="mb-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-1">{title}</h1>
          {subtitle != null && (
            <div className="text-gray-600 dark:text-gray-400 text-sm">{subtitle}</div>
          )}
        </div>
        {actions && (
          <div className="flex items-center gap-3 flex-wrap">
            {actions}
          </div>
        )}
      </div>
    </div>
  )
}

