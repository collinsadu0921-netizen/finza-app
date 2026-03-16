"use client"

import { createContext, useContext, useState, useCallback, ReactNode } from "react"
import Toast from "./Toast"
import { useExportMode } from "@/lib/hooks/useExportMode"

type ToastType = "success" | "error" | "info" | "warning"

interface ToastMessage {
  id: string
  message: string
  type: ToastType
}

interface ToastContextType {
  showToast: (message: string, type: ToastType) => void
}

const ToastContext = createContext<ToastContextType | undefined>(undefined)

export function useToast() {
  const context = useContext(ToastContext)
  if (!context) {
    throw new Error("useToast must be used within ToastProvider")
  }
  return context
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastMessage[]>([])
  const isExportMode = useExportMode()

  const showToast = useCallback((message: string, type: ToastType) => {
    const id = Math.random().toString(36).substring(7)
    setToasts((prev) => [...prev, { id, message, type }])
  }, [])

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id))
  }, [])

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {!isExportMode && (
      <div className="fixed top-4 right-4 z-50 space-y-2 flex flex-col items-end export-hide print-hide">
        {toasts.map((toast) => (
          <Toast
            key={toast.id}
            message={toast.message}
            type={toast.type}
            isVisible={true}
            onClose={() => removeToast(toast.id)}
          />
        ))}
      </div>
      )}
    </ToastContext.Provider>
  )
}

