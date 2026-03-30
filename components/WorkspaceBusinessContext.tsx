"use client"

import { createContext, useContext, type ReactNode } from "react"
import type { User } from "@supabase/supabase-js"

/** Business row from getCurrentBusiness — extended fields allowed for dashboard display */
export type WorkspaceBusiness = {
  id: string
  default_currency?: string | null
  trading_name?: string | null
  legal_name?: string | null
  name?: string | null
  [key: string]: unknown
} | null

export type WorkspaceSessionUser = Pick<User, "id" | "email" | "user_metadata"> | null

type WorkspaceBusinessContextValue = {
  business: WorkspaceBusiness
  sessionUser: WorkspaceSessionUser
}

const WorkspaceBusinessContext = createContext<WorkspaceBusinessContextValue | null>(null)

export function WorkspaceBusinessProvider({
  value,
  children,
}: {
  value: WorkspaceBusinessContextValue
  children: ReactNode
}) {
  return (
    <WorkspaceBusinessContext.Provider value={value}>
      {children}
    </WorkspaceBusinessContext.Provider>
  )
}

/**
 * Current workspace business + session user, populated by ProtectedLayout after access checks.
 * Returns nulls when used outside the provider (e.g. tests).
 */
export function useWorkspaceBusiness(): WorkspaceBusinessContextValue {
  const ctx = useContext(WorkspaceBusinessContext)
  if (!ctx) {
    return { business: null, sessionUser: null }
  }
  return ctx
}
