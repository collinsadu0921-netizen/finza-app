"use client"

import { forwardRef } from "react"
import { cn } from "@/lib/utils"

interface DateInputProps {
  value?: string
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void
  placeholder?: string
  className?: string
  disabled?: boolean
  min?: string
  max?: string
  id?: string
  name?: string
}

const DateInput = forwardRef<HTMLInputElement, DateInputProps>(
  ({ value, onChange, placeholder, className, disabled, min, max, id, name }, ref) => {
    return (
      <div className={cn("relative group", className)}>
        {/* Calendar icon */}
        <div className="pointer-events-none absolute inset-y-0 left-3 flex items-center">
          <svg
            className="h-4 w-4 text-gray-400 group-focus-within:text-blue-500 transition-colors"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.8}
          >
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </svg>
        </div>

        <input
          ref={ref}
          type="date"
          id={id}
          name={name}
          value={value}
          onChange={onChange}
          min={min}
          max={max}
          disabled={disabled}
          placeholder={placeholder}
          className={cn(
            "w-full pl-9 pr-3 py-2.5 text-sm rounded-lg border transition-all duration-150",
            "bg-white dark:bg-gray-800",
            "text-gray-900 dark:text-white",
            "border-gray-200 dark:border-gray-600",
            "hover:border-gray-300 dark:hover:border-gray-500",
            "focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500",
            "disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-gray-50 dark:disabled:bg-gray-900",
            "[color-scheme:light] dark:[color-scheme:dark]",
          )}
        />
      </div>
    )
  }
)

DateInput.displayName = "DateInput"

export default DateInput
