"use client"

type ErrorAlertProps = {
  message: string
  onDismiss?: () => void
  type?: "error" | "warning" | "info"
}

export default function ErrorAlert({ message, onDismiss, type = "error" }: ErrorAlertProps) {
  const bgColors = {
    error: "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800",
    warning: "bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800",
    info: "bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800",
  }

  const textColors = {
    error: "text-red-700 dark:text-red-400",
    warning: "text-yellow-700 dark:text-yellow-400",
    info: "text-blue-700 dark:text-blue-400",
  }

  return (
    <div className={`${bgColors[type]} border ${textColors[type]} px-4 py-3 rounded-lg mb-4 flex items-start justify-between`}>
      <div className="flex-1">
        <p className="font-medium">{message}</p>
      </div>
      {onDismiss && (
        <button
          onClick={onDismiss}
          className={`ml-4 ${textColors[type]} hover:opacity-75`}
          aria-label="Dismiss"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  )
}







