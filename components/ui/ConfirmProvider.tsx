"use client"

import {
  createContext,
  useContext,
  useState,
  useCallback,
  ReactNode,
} from "react"
import Modal from "./Modal"

export interface ConfirmOptions {
  title: string
  description: string
  onConfirm: () => void | Promise<void>
  confirmLabel?: string
  cancelLabel?: string
}

export interface ConfirmWithInputOptions extends ConfirmOptions {
  expectedValue: string
  inputLabel?: string
}

interface ConfirmState extends ConfirmOptions {
  requireInput?: boolean
  expectedValue?: string
  inputLabel?: string
}

interface ConfirmContextType {
  openConfirm: (options: ConfirmOptions) => void
  confirmWithInput: (options: ConfirmWithInputOptions) => void
}

const ConfirmContext = createContext<ConfirmContextType | undefined>(undefined)

export function useConfirm() {
  const context = useContext(ConfirmContext)
  if (!context) {
    throw new Error("useConfirm must be used within ConfirmProvider")
  }
  return context
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ConfirmState | null>(null)
  const [inputValue, setInputValue] = useState("")
  const [confirmLoading, setConfirmLoading] = useState(false)

  const openConfirmImpl = useCallback((options: ConfirmOptions) => {
    setState({ ...options })
    setInputValue("")
  }, [])

  const openConfirmWithInput = useCallback(
    (options: ConfirmWithInputOptions) => {
      setState({
        ...options,
        requireInput: true,
        expectedValue: options.expectedValue,
        inputLabel: options.inputLabel ?? `Type "${options.expectedValue}" to confirm`,
      })
      setInputValue("")
    },
    []
  )

  const close = useCallback(() => {
    setState(null)
    setInputValue("")
  }, [])

  const handleConfirm = useCallback(async () => {
    if (!state) return
    if (state.requireInput && state.expectedValue !== undefined) {
      if (inputValue !== state.expectedValue) return
    }
    setConfirmLoading(true)
    try {
      const result = state.onConfirm()
      if (result && typeof (result as Promise<unknown>).then === "function") {
        await (result as Promise<void>)
      }
    } catch (e) {
      console.error("Confirm action failed:", e)
    } finally {
      setConfirmLoading(false)
      close()
    }
  }, [state, inputValue, close])

  const canConfirm = !state?.requireInput || inputValue === state?.expectedValue

  return (
    <ConfirmContext.Provider
      value={{
        openConfirm: openConfirmImpl,
        confirmWithInput: openConfirmWithInput,
      }}
    >
      {children}
      {state && (
        <Modal
          isOpen={true}
          onClose={close}
          title={state.title}
          size="md"
          footer={
            <>
              <button
                type="button"
                onClick={close}
                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-600"
              >
                {state.cancelLabel ?? "Cancel"}
              </button>
              <button
                type="button"
                onClick={() => void handleConfirm()}
                disabled={!canConfirm || confirmLoading}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {confirmLoading ? "..." : (state.confirmLabel ?? "Confirm")}
              </button>
            </>
          }
        >
          <div className="space-y-4">
            <p className="text-sm text-gray-600 dark:text-gray-400 whitespace-pre-line">
              {state.description}
            </p>
            {state.requireInput && state.expectedValue !== undefined && (
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  {state.inputLabel}
                </label>
                <input
                  type="text"
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  placeholder={state.expectedValue}
                  autoFocus
                />
              </div>
            )}
          </div>
        </Modal>
      )}
    </ConfirmContext.Provider>
  )
}
