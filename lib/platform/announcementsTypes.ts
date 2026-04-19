export type PlatformAnnouncementStatus = "draft" | "active" | "archived"

export type PlatformAnnouncementSeverity = "info" | "success" | "warning" | "critical"

export type PlatformAnnouncementPlacement = "global_banner" | "dashboard_card" | "modal"

export type PlatformAnnouncementAudienceScope =
  | "all_tenants"
  | "service_workspace_only"
  | "retail_workspace_only"
  | "accounting_workspace_only"

export type WorkspaceSurface = "accounting" | "service" | "retail" | "core"

export type PlatformAnnouncementRow = {
  id: string
  title: string
  body: string
  status: PlatformAnnouncementStatus
  severity: PlatformAnnouncementSeverity
  placement: PlatformAnnouncementPlacement
  audience_scope: PlatformAnnouncementAudienceScope
  dismissible: boolean
  start_at: string | null
  end_at: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}
