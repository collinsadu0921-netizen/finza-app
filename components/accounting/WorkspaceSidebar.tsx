"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { supabase } from "@/lib/supabaseClient"

const MAIN_ITEMS = [
  { label: "Dashboard", href: "/accounting/dashboard" },
  { label: "Clients", href: "/accounting/clients" },
]

const WORK_ITEMS = [
  { label: "Tasks", href: "/accounting/tasks" },
  { label: "Requests", href: "/accounting/requests" },
  { label: "Filings", href: "/accounting/filings" },
  { label: "Documents", href: "/accounting/documents" },
]

type WorkspaceSidebarProps = {
  hasClientSelected: boolean
  hasFirm: boolean
}

type SidebarItemProps = {
  label: string
  href: string
  active: boolean
  disabled?: boolean
}

function isActive(pathname: string, href: string): boolean {
  if (pathname === href) return true
  return href !== "/accounting/dashboard" && pathname.startsWith(`${href}/`)
}

function SidebarItem({ label, href, active, disabled = false }: SidebarItemProps) {
  if (disabled) {
    return (
      <span className="block whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium text-gray-400 bg-gray-50 cursor-not-allowed">
        {label}
      </span>
    )
  }

  return (
    <Link
      href={href}
      className={`block whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
        active ? "bg-blue-100 text-blue-700" : "text-gray-600 hover:bg-gray-100"
      }`}
    >
      {label}
    </Link>
  )
}

export default function WorkspaceSidebar({ hasClientSelected, hasFirm }: WorkspaceSidebarProps) {
  const pathname = usePathname() ?? ""
  const router = useRouter()

  async function handleLogout() {
    await supabase.auth.signOut()
    router.push("/login")
  }

  function isDisabled(href: string): boolean {
    if (!hasFirm) return true
    if (hasClientSelected) return false
    return WORK_ITEMS.some((item) => item.href === href)
  }

  return (
    <aside className="w-full lg:w-64 lg:shrink-0">
      <nav
        aria-label="Accounting workspace navigation"
        className="rounded-xl border border-gray-200 bg-white p-3 lg:sticky lg:top-4"
      >
        <div className="px-2 py-2 mb-2">
          <p className="text-sm font-semibold text-gray-900">Finza</p>
        </div>

        <p className="px-2 text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Main</p>
        <ul className="flex lg:flex-col gap-1 overflow-x-auto mb-3">
          {MAIN_ITEMS.map((item) => {
            const active = isActive(pathname, item.href)
            return (
              <li key={item.href}>
                <SidebarItem label={item.label} href={item.href} active={active} disabled={isDisabled(item.href)} />
              </li>
            )
          })}
        </ul>

        <p className="px-2 text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Work</p>
        <ul className="flex lg:flex-col gap-1 overflow-x-auto mb-3">
          {WORK_ITEMS.map((item) => {
            const active = isActive(pathname, item.href)
            return (
              <li key={item.href}>
                <SidebarItem label={item.label} href={item.href} active={active} disabled={isDisabled(item.href)} />
              </li>
            )
          })}
        </ul>

        <div className="mt-3 pt-3 border-t border-gray-200 space-y-1">
          <Link
            href="/accounting/firm"
            className="block whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100"
          >
            Settings
          </Link>
          <button
            onClick={handleLogout}
            className="w-full text-left whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100"
          >
            Logout
          </button>
        </div>
      </nav>
    </aside>
  )
}
