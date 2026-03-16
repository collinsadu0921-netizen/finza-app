"use client"

type LoadingSpinnerProps = {
  size?: "sm" | "md" | "lg"
  text?: string
  fullScreen?: boolean
}

export default function LoadingSpinner({ size = "md", text, fullScreen = false }: LoadingSpinnerProps) {
  const sizeClasses = {
    sm: "w-4 h-4",
    md: "w-8 h-8",
    lg: "w-12 h-12",
  }

  const containerClass = fullScreen
    ? "fixed inset-0 flex items-center justify-center bg-white dark:bg-gray-900 bg-opacity-75 dark:bg-opacity-75 z-50"
    : "flex items-center justify-center p-4"

  return (
    <div className={containerClass}>
      <div className="flex flex-col items-center gap-2">
        <div
          className={`${sizeClasses[size]} border-4 border-gray-200 dark:border-gray-700 border-t-blue-600 dark:border-t-blue-400 rounded-full animate-spin`}
        />
        {text && <p className="text-sm text-gray-600 dark:text-gray-400">{text}</p>}
      </div>
    </div>
  )
}







