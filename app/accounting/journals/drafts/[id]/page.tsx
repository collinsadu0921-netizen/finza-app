"use client"

import { useState, useEffect } from "react"
import ProtectedLayout from "@/components/ProtectedLayout"
import LoadingScreen from "@/components/ui/LoadingScreen"
import PageHeader from "@/components/ui/PageHeader"
import Button from "@/components/ui/Button"
import Modal from "@/components/ui/Modal"
import EmptyState from "@/components/ui/EmptyState"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabaseClient"
import { getActiveEngagement, isEngagementEffective } from "@/lib/firmEngagements"
import { checkFirmOnboardingForAction } from "@/lib/firmOnboarding"
import { useToast } from "@/components/ui/ToastProvider"
import {
  useAccountingBusiness,
  CLIENT_NOT_SELECTED_DESCRIPTION,
} from "@/lib/accounting/useAccountingBusiness"
import { buildAccountingRoute } from "@/lib/accounting/routes"

type DraftStatus = "draft" | "submitted" | "approved" | "rejected"

type AccountingPeriod = {
  id: string
  period_start: string
  period_end: string
  status: "open" | "soft_closed" | "locked"
}

type UserInfo = {
  id: string
  email: string | null
  raw_user_meta_data: {
    full_name?: string
  } | null
}

type DraftLine = {
  account_id: string
  debit: number
  credit: number
  memo?: string
  account?: {
    id: string
    code: string
    name: string
    type: string
  } | null
}

type ManualJournalDraft = {
  id: string
  accounting_firm_id: string
  client_business_id: string
  period_id: string
  status: DraftStatus
  entry_date: string
  description: string
  lines: DraftLine[]
  total_debit: number
  total_credit: number
  created_by: string
  submitted_by: string | null
  approved_by: string | null
  rejected_by: string | null
  created_at: string
  submitted_at: string | null
  approved_at: string | null
  rejected_at: string | null
  rejection_reason: string | null
  journal_entry_id: string | null
  posted_at: string | null
  posted_by: string | null
  created_by_user: UserInfo | null
  submitted_by_user: UserInfo | null
  approved_by_user: UserInfo | null
  rejected_by_user: UserInfo | null
  period: AccountingPeriod | null
}

type AuthorityCheck = {
  canSubmit: boolean
  canApprove: boolean
  canReject: boolean
  canPost: boolean
  submitReason?: string
  approveReason?: string
  rejectReason?: string
  postReason?: string
}

export default function DraftReviewPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const router = useRouter()
  const toast = useToast()
  const { businessId: clientBusinessId, loading: contextLoading, error: contextError } = useAccountingBusiness()
  const [draftId, setDraftId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [firmId, setFirmId] = useState<string | null>(null)
  const [firmName, setFirmName] = useState<string | null>(null)
  const [clientBusinessName, setClientBusinessName] = useState<string | null>(null)
  const [draft, setDraft] = useState<ManualJournalDraft | null>(null)
  const [firmRole, setFirmRole] = useState<string | null>(null)
  const [engagementAccess, setEngagementAccess] = useState<string | null>(null)
  const [authority, setAuthority] = useState<AuthorityCheck>({
    canSubmit: false,
    canApprove: false,
    canReject: false,
    canPost: false,
  })
  const [error, setError] = useState("")
  const [blocked, setBlocked] = useState(false)
  const [blockedReason, setBlockedReason] = useState("")
  const [processing, setProcessing] = useState(false)
  const [showRejectModal, setShowRejectModal] = useState(false)
  const [rejectionReason, setRejectionReason] = useState("")
  const [showPostModal, setShowPostModal] = useState(false)
  const [postConfirmationChecked, setPostConfirmationChecked] = useState(false)
  const [postError, setPostError] = useState<string | null>(null)
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)

  useEffect(() => {
    const loadParams = async () => {
      const resolvedParams = await params
      setDraftId(resolvedParams.id)
    }
    loadParams()
  }, [params])

  useEffect(() => {
    if (draftId && clientBusinessId) {
      initializePage()
    } else if (draftId && !contextLoading && !clientBusinessId) {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftId, clientBusinessId])

  useEffect(() => {
    if (draft && firmRole && engagementAccess) {
      checkAuthority()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, firmRole, engagementAccess])

  const initializePage = async () => {
    if (!draftId || !clientBusinessId) return

    try {
      setLoading(true)
      setError("")
      setBlocked(false)
      setBlockedReason("")

      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) {
        setError("Not authenticated")
        setLoading(false)
        return
      }

      setCurrentUserId(user.id)

      const onboardingCheck = await checkFirmOnboardingForAction(
        supabase,
        user.id,
        clientBusinessId
      )

      if (!onboardingCheck.isComplete || !onboardingCheck.firmId) {
        setBlocked(true)
        setBlockedReason("Firm onboarding required or no firm found.")
        setLoading(false)
        return
      }

      setFirmId(onboardingCheck.firmId)

      // Get firm name
      const { data: firm } = await supabase
        .from("accounting_firms")
        .select("legal_name")
        .eq("id", onboardingCheck.firmId)
        .single()

      if (firm) {
        setFirmName(firm.legal_name)
      }

      // Get user's firm role
      const { data: firmUser } = await supabase
        .from("accounting_firm_users")
        .select("role")
        .eq("firm_id", onboardingCheck.firmId)
        .eq("user_id", user.id)
        .maybeSingle()

      setFirmRole(firmUser?.role || null)

      const engagement = await getActiveEngagement(
        supabase,
        onboardingCheck.firmId,
        clientBusinessId
      )

      if (!engagement) {
        setBlocked(true)
        setBlockedReason("An active engagement is required to view manual journal drafts.")
        setLoading(false)
        return
      }

      if (!isEngagementEffective(engagement)) {
        setBlocked(true)
        const today = new Date().toISOString().split("T")[0]
        if (engagement.effective_from > today) {
          setBlockedReason(`Engagement is not yet effective. Effective date: ${engagement.effective_from}`)
        } else if (engagement.effective_to && engagement.effective_to < today) {
          setBlockedReason(`Engagement has expired. Expired on: ${engagement.effective_to}`)
        } else {
          setBlockedReason("Engagement is not effective.")
        }
        setLoading(false)
        return
      }

      setEngagementAccess(engagement.access_level)

      // Load draft
      await loadDraft()

      setLoading(false)
    } catch (err: any) {
      setError(err.message || "Failed to initialize page")
      setLoading(false)
    }
  }

  const loadDraft = async () => {
    if (!draftId) return

    try {
      const url =
        clientBusinessId
          ? `/api/accounting/journals/drafts/${draftId}?business_id=${clientBusinessId}`
          : `/api/accounting/journals/drafts/${draftId}`
      const response = await fetch(url)
      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.message || "Failed to load draft")
      }

      const data = await response.json()
      setDraft(data.draft)
      if (data.draft?.client_business_id) {
        const { data: biz } = await supabase
          .from("businesses")
          .select("name")
          .eq("id", data.draft.client_business_id)
          .single()
        setClientBusinessName(biz?.name ?? null)
      } else {
        setClientBusinessName(null)
      }
    } catch (err: any) {
      setError(err.message || "Failed to load draft")
    }
  }

  const checkAuthority = async () => {
    if (!draft || !firmRole || !engagementAccess) return

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) return

    const newAuthority: AuthorityCheck = {
      canSubmit: false,
      canApprove: false,
      canReject: false,
      canPost: false,
    }

    // Submit: status = draft, creator, write access, junior+, period open
    if (draft.status === "draft") {
      const isCreator = draft.created_by === user.id
      const hasWriteAccess = engagementAccess === "write" || engagementAccess === "approve"
      const hasJuniorRole = firmRole === "junior" || firmRole === "senior" || firmRole === "partner"
      const periodOpen = draft.period?.status === "open" || draft.period?.status === "soft_closed"

      if (isCreator && hasWriteAccess && hasJuniorRole && periodOpen) {
        newAuthority.canSubmit = true
      } else {
        if (!isCreator) newAuthority.submitReason = "Only the draft creator can submit."
        else if (!hasWriteAccess) newAuthority.submitReason = "Write access required."
        else if (!hasJuniorRole) newAuthority.submitReason = "Junior role or higher required."
        else if (!periodOpen) newAuthority.submitReason = "Period must be open."
      }
    }

    // Approve/Reject: status = submitted, approve access, senior+
    if (draft.status === "submitted") {
      const hasApproveAccess = engagementAccess === "approve"
      const hasSeniorRole = firmRole === "senior" || firmRole === "partner"

      if (hasApproveAccess && hasSeniorRole) {
        newAuthority.canApprove = true
        newAuthority.canReject = true
      } else {
        if (!hasApproveAccess) {
          newAuthority.approveReason = "Approve access required."
          newAuthority.rejectReason = "Approve access required."
        } else if (!hasSeniorRole) {
          newAuthority.approveReason = "Senior role or higher required."
          newAuthority.rejectReason = "Senior role or higher required."
        }
      }
    }

    // Post: status = approved, approve access, partner, period open
    if (draft.status === "approved" && !draft.journal_entry_id) {
      const hasApproveAccess = engagementAccess === "approve"
      const isPartner = firmRole === "partner"
      const periodOpen = draft.period?.status === "open" || draft.period?.status === "soft_closed"

      if (hasApproveAccess && isPartner && periodOpen) {
        newAuthority.canPost = true
      } else {
        if (!hasApproveAccess) newAuthority.postReason = "Approve access required."
        else if (!isPartner) newAuthority.postReason = "Partner role required."
        else if (!periodOpen) newAuthority.postReason = "Period must be open."
      }
    }

    setAuthority(newAuthority)
  }

  const handleSubmit = async () => {
    if (!draftId || processing) return

    setProcessing(true)
    try {
      const submitUrl =
        clientBusinessId
          ? `/api/accounting/journals/drafts/${draftId}/submit?business_id=${clientBusinessId}`
          : `/api/accounting/journals/drafts/${draftId}/submit`
      const response = await fetch(submitUrl, {
        method: "POST",
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.message || "Failed to submit draft")
      }

      toast.showToast("Draft submitted successfully", "success")
      await loadDraft()
    } catch (err: any) {
      toast.showToast(err.message || "Failed to submit draft", "error")
    } finally {
      setProcessing(false)
    }
  }

  const handleApprove = async () => {
    if (!draftId || processing) return

    setProcessing(true)
    try {
      const approveUrl =
        clientBusinessId
          ? `/api/accounting/journals/drafts/${draftId}/approve?business_id=${clientBusinessId}`
          : `/api/accounting/journals/drafts/${draftId}/approve`
      const response = await fetch(approveUrl, {
        method: "POST",
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.message || "Failed to approve draft")
      }

      toast.showToast("Draft approved successfully", "success")
      await loadDraft()
    } catch (err: any) {
      toast.showToast(err.message || "Failed to approve draft", "error")
    } finally {
      setProcessing(false)
    }
  }

  const handleReject = async () => {
    if (!draftId || processing || !rejectionReason.trim()) return

    setProcessing(true)
    try {
      const rejectUrl =
        clientBusinessId
          ? `/api/accounting/journals/drafts/${draftId}/reject?business_id=${clientBusinessId}`
          : `/api/accounting/journals/drafts/${draftId}/reject`
      const response = await fetch(rejectUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rejection_reason: rejectionReason.trim() }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.message || "Failed to reject draft")
      }

      toast.showToast("Draft rejected", "success")
      setShowRejectModal(false)
      setRejectionReason("")
      await loadDraft()
    } catch (err: any) {
      toast.showToast(err.message || "Failed to reject draft", "error")
    } finally {
      setProcessing(false)
    }
  }

  const handlePost = async () => {
    if (!draftId || processing || !postConfirmationChecked) return

    setProcessing(true)
    setPostError(null)

    try {
      // Activity logging: Log post attempt
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (user) {
        try {
          await supabase.from("accounting_firm_activity_logs").insert({
            firm_id: firmId,
            user_id: user.id,
            action: "draft_post_attempt",
            entity_type: "manual_journal_draft",
            entity_id: draftId,
            metadata: {
              draft_id: draftId,
            },
          })
        } catch (logError) {
          // Log error but don't block posting
          console.error("Failed to log activity:", logError)
        }
      }

      const postUrl =
        clientBusinessId
          ? `/api/accounting/journals/drafts/${draftId}/post?business_id=${clientBusinessId}`
          : `/api/accounting/journals/drafts/${draftId}/post`
      const response = await fetch(postUrl, {
        method: "POST",
      })

      if (!response.ok) {
        const errorData = await response.json()
        const reasonCode = errorData.reasonCode || "UNKNOWN_ERROR"
        const errorMessage = mapPostErrorToMessage(reasonCode, errorData.message)
        setPostError(errorMessage)
        setProcessing(false)
        return
      }

      const data = await response.json()

      // Success: Close modal and redirect to ledger entry
      setShowPostModal(false)
      setPostConfirmationChecked(false)
      setPostError(null)

      toast.showToast("Journal posted to ledger successfully.", "success")

      // Redirect to ledger entry view
      // The API should return journal_entry_id in the response
      const journalEntryId = data.journal_entry_id || data.draft?.journal_entry_id
      
      if (journalEntryId) {
        router.push(clientBusinessId ? `${buildAccountingRoute("/accounting/ledger", clientBusinessId)}&entry_id=${journalEntryId}` : "/accounting")
      } else {
        // If no journal_entry_id returned, reload draft to get it
        await loadDraft()
        // Re-fetch draft to get updated journal_entry_id
        const updatedDraftUrl =
          clientBusinessId
            ? `/api/accounting/journals/drafts/${draftId}?business_id=${clientBusinessId}`
            : `/api/accounting/journals/drafts/${draftId}`
        const updatedDraftResponse = await fetch(updatedDraftUrl)
        if (updatedDraftResponse.ok) {
          const updatedData = await updatedDraftResponse.json()
          if (updatedData.draft?.journal_entry_id) {
            router.push(clientBusinessId ? `${buildAccountingRoute("/accounting/ledger", clientBusinessId)}&entry_id=${updatedData.draft.journal_entry_id}` : "/accounting")
          } else {
            // Fallback: just reload the page
            router.refresh()
          }
        } else {
          router.refresh()
        }
      }
    } catch (err: any) {
      setPostError(err.message || "Failed to post draft to ledger")
      setProcessing(false)
    }
  }

  const mapPostErrorToMessage = (reasonCode: string, defaultMessage: string): string => {
    const errorMap: Record<string, string> = {
      PERIOD_CLOSED: "The accounting period is closed. Posting is not allowed.",
      INSUFFICIENT_FIRM_ROLE: "Partner approval is required to post to the ledger.",
      ENGAGEMENT_NOT_EFFECTIVE: "The firm's engagement is not yet effective for this date.",
      ALREADY_POSTED: "This draft has already been posted.",
      NO_ENGAGEMENT: "An active engagement is required to post to the ledger.",
      INVALID_STATUS_TRANSITION: "This draft cannot be posted in its current status.",
    }

    return errorMap[reasonCode] || defaultMessage || "Failed to post draft to ledger."
  }

  const getStatusBadge = (status: DraftStatus) => {
    const styles = {
      draft: "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-600",
      submitted: "bg-blue-100 text-blue-800 dark:bg-blue-900/20 dark:text-blue-400 border border-blue-300 dark:border-blue-700",
      approved: "bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-400 border border-green-300 dark:border-green-700",
      rejected: "bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-400 border border-red-300 dark:border-red-700",
    }
    const labels = {
      draft: "Draft",
      submitted: "Submitted",
      approved: "Approved",
      rejected: "Rejected",
    }
    return (
      <span className={`px-3 py-1 rounded text-sm font-semibold ${styles[status]}`}>
        {labels[status]}
      </span>
    )
  }

  const getAccessBadge = (access: string | null) => {
    if (!access) return null
    const styles = {
      read: "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300",
      write: "bg-blue-100 text-blue-800 dark:bg-blue-900/20 dark:text-blue-400",
      approve: "bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-400",
    }
    return (
      <span className={`px-3 py-1 rounded text-sm font-semibold ${styles[access as keyof typeof styles]}`}>
        {access.charAt(0).toUpperCase() + access.slice(1)}
      </span>
    )
  }

  const getRoleBadge = (role: string | null) => {
    if (!role) return null
    const styles = {
      readonly: "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300",
      junior: "bg-blue-100 text-blue-800 dark:bg-blue-900/20 dark:text-blue-400",
      senior: "bg-purple-100 text-purple-800 dark:bg-purple-900/20 dark:text-purple-400",
      partner: "bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-400",
    }
    return (
      <span className={`px-3 py-1 rounded text-sm font-semibold ${styles[role as keyof typeof styles]}`}>
        {role.charAt(0).toUpperCase() + role.slice(1)}
      </span>
    )
  }

  const formatDate = (dateString: string | null) => {
    if (!dateString) return "—"
    return new Date(dateString).toLocaleDateString()
  }

  const formatDateTime = (dateString: string | null) => {
    if (!dateString) return "—"
    return new Date(dateString).toLocaleString()
  }

  const getUserDisplayName = (user: UserInfo | null) => {
    if (!user) return "—"
    if (user.raw_user_meta_data?.full_name) {
      return user.raw_user_meta_data.full_name
    }
    return user.email || "—"
  }

  const formatPeriod = (period: AccountingPeriod | null) => {
    if (!period) return "—"
    const start = new Date(period.period_start)
    return `${start.toLocaleDateString("en-US", { month: "short", year: "numeric" })}`
  }

  if (contextLoading || loading) {
    return (
      <ProtectedLayout>
        <LoadingScreen />
      </ProtectedLayout>
    )
  }

  if (contextError) {
    return (
      <ProtectedLayout>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <PageHeader title="Manual Journal Draft" />
          <EmptyState title="Client not selected" description={CLIENT_NOT_SELECTED_DESCRIPTION} />
        </div>
      </ProtectedLayout>
    )
  }

  if (blocked || !draft) {
    return (
      <ProtectedLayout>
        <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            <PageHeader title="Manual Journal Draft" />
            <div className="bg-yellow-50 dark:bg-yellow-900/20 border-l-4 border-yellow-400 text-yellow-700 dark:text-yellow-400 px-4 py-3 rounded">
              {blockedReason || "Draft not found"}
            </div>
          </div>
        </div>
      </ProtectedLayout>
    )
  }

  const isLocked = draft.status === "approved" || draft.status === "rejected"
  const isBalanced = Math.abs(draft.total_debit - draft.total_credit) < 0.01

  return (
    <ProtectedLayout>
      <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <PageHeader
            title="Manual Journal Draft"
            subtitle={
              <div className="flex flex-wrap gap-4 mt-2">
                {getStatusBadge(draft.status)}
                {engagementAccess && getAccessBadge(engagementAccess)}
                {firmRole && getRoleBadge(firmRole)}
              </div>
            }
            actions={
              <div className="flex gap-2">
                {draft.status === "draft" && draft.created_by === currentUserId && (
                  <Button
                    variant="outline"
                    onClick={() => router.push(clientBusinessId ? `/accounting/journals/drafts/${draft.id}/edit?business_id=${clientBusinessId}` : `/accounting/journals/drafts/${draft.id}/edit`)}
                  >
                    Edit
                  </Button>
                )}
                <Button
                  variant="outline"
                  onClick={() => router.push(clientBusinessId ? `/accounting/journals?business_id=${clientBusinessId}` : "/accounting/journals")}
                >
                  Back to List
                </Button>
              </div>
            }
          />

          {/* Context Badges */}
          <div className="flex flex-wrap gap-3 mb-6">
            {firmName && (
              <span className="px-3 py-1 bg-blue-100 dark:bg-blue-900/20 text-blue-800 dark:text-blue-400 rounded-full text-sm font-medium">
                Firm: {firmName}
              </span>
            )}
            {clientBusinessId && (
              <span className="px-3 py-1 bg-green-100 dark:bg-green-900/20 text-green-800 dark:text-green-400 rounded-full text-sm font-medium">
                Client: {clientBusinessId.slice(0, 8)}…
              </span>
            )}
            {draft.period && (
              <span className="px-3 py-1 bg-purple-100 dark:bg-purple-900/20 text-purple-800 dark:text-purple-400 rounded-full text-sm font-medium">
                Period: {formatPeriod(draft.period)}
              </span>
            )}
            <span className="px-3 py-1 bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-300 rounded-full text-sm font-medium">
              Entry Date: {formatDate(draft.entry_date)}
            </span>
          </div>

          {error && (
            <div className="bg-red-50 dark:bg-red-900/20 border-l-4 border-red-400 text-red-700 dark:text-red-400 px-4 py-3 rounded mb-6">
              {error}
            </div>
          )}

          {/* Draft Summary */}
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6 mb-6">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
              Draft Summary
            </h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">
                  Description
                </label>
                <p className="text-gray-900 dark:text-white">{draft.description}</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">
                  Period
                </label>
                <p className="text-gray-900 dark:text-white">
                  {formatPeriod(draft.period)} ({draft.period?.status || "—"})
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">
                  Entry Date
                </label>
                <p className="text-gray-900 dark:text-white">{formatDate(draft.entry_date)}</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">
                  Status
                </label>
                <div className="flex items-center gap-2">
                  {getStatusBadge(draft.status)}
                  {isLocked && (
                    <span className="text-gray-400 dark:text-gray-500" title="Locked">
                      🔒
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Totals */}
            <div className="border-t border-gray-200 dark:border-gray-700 pt-4 mt-4">
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">
                    Total Debit
                  </label>
                  <p className="text-lg font-semibold text-gray-900 dark:text-white">
                    ₵{draft.total_debit.toFixed(2)}
                  </p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">
                    Total Credit
                  </label>
                  <p className="text-lg font-semibold text-gray-900 dark:text-white">
                    ₵{draft.total_credit.toFixed(2)}
                  </p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">
                    Balance
                  </label>
                  <div className={`text-lg font-semibold ${
                    isBalanced
                      ? "text-green-600 dark:text-green-400"
                      : "text-red-600 dark:text-red-400"
                  }`}>
                    {isBalanced ? "✓ Balanced" : `⚠ Imbalanced (₵${Math.abs(draft.total_debit - draft.total_credit).toFixed(2)})`}
                  </div>
                </div>
              </div>
            </div>

            {/* Approved State Note */}
            {draft.status === "approved" && !draft.journal_entry_id && (
              <div className="mt-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded-lg p-4">
                <p className="text-sm text-blue-700 dark:text-blue-400">
                  <strong>Note:</strong> This draft is approved but not yet posted to the ledger.
                </p>
              </div>
            )}
          </div>

          {/* Line Items Table */}
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6 mb-6">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
              Journal Lines
            </h2>

            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                <thead className="bg-gray-50 dark:bg-gray-900">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Account
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Debit
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Credit
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Memo
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                  {draft.lines.map((line, idx) => (
                    <tr key={idx} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                      <td className="px-6 py-4 text-sm text-gray-900 dark:text-white">
                        {line.account ? (
                          <div>
                            <div className="font-medium">
                              {line.account.code} - {line.account.name}
                            </div>
                            <div className="text-xs text-gray-500 dark:text-gray-400">
                              {line.account.type}
                            </div>
                          </div>
                        ) : (
                          <span className="text-gray-400">Account not found</span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-sm text-right text-gray-900 dark:text-white">
                        {line.debit > 0 ? `₵${line.debit.toFixed(2)}` : "—"}
                      </td>
                      <td className="px-6 py-4 text-sm text-right text-gray-900 dark:text-white">
                        {line.credit > 0 ? `₵${line.credit.toFixed(2)}` : "—"}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-400">
                        {line.memo || "—"}
                      </td>
                    </tr>
                  ))}
                  <tr className="bg-gray-50 dark:bg-gray-900 font-semibold">
                    <td className="px-6 py-4 text-sm text-gray-900 dark:text-white">Total</td>
                    <td className="px-6 py-4 text-sm text-right text-gray-900 dark:text-white">
                      ₵{draft.total_debit.toFixed(2)}
                    </td>
                    <td className="px-6 py-4 text-sm text-right text-gray-900 dark:text-white">
                      ₵{draft.total_credit.toFixed(2)}
                    </td>
                    <td className="px-6 py-4"></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* Metadata Panel */}
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6 mb-6">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
              Metadata
            </h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">
                  Created By
                </label>
                <p className="text-gray-900 dark:text-white">
                  {getUserDisplayName(draft.created_by_user)}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {formatDateTime(draft.created_at)}
                </p>
              </div>

              {draft.submitted_at && (
                <div>
                  <label className="block text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">
                    Submitted By
                  </label>
                  <p className="text-gray-900 dark:text-white">
                    {getUserDisplayName(draft.submitted_by_user)}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {formatDateTime(draft.submitted_at)}
                  </p>
                </div>
              )}

              {draft.approved_at && (
                <div>
                  <label className="block text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">
                    Approved By
                  </label>
                  <p className="text-gray-900 dark:text-white">
                    {getUserDisplayName(draft.approved_by_user)}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {formatDateTime(draft.approved_at)}
                  </p>
                </div>
              )}

              {draft.rejected_at && (
                <div>
                  <label className="block text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">
                    Rejected By
                  </label>
                  <p className="text-gray-900 dark:text-white">
                    {getUserDisplayName(draft.rejected_by_user)}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {formatDateTime(draft.rejected_at)}
                  </p>
                  {draft.rejection_reason && (
                    <div className="mt-2 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded">
                      <p className="text-sm font-medium text-red-700 dark:text-red-400 mb-1">
                        Rejection Reason:
                      </p>
                      <p className="text-sm text-red-600 dark:text-red-400">
                        {draft.rejection_reason}
                      </p>
                    </div>
                  )}
                </div>
              )}

              {draft.posted_at && (
                <div>
                  <label className="block text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">
                    Posted By
                  </label>
                  <p className="text-gray-900 dark:text-white">
                    {draft.posted_by ? "User" : "—"}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {formatDateTime(draft.posted_at)}
                  </p>
                  {draft.journal_entry_id && (
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      Journal Entry ID: {draft.journal_entry_id}
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Action Bar */}
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6">
            <div className="flex flex-wrap gap-3 justify-end">
              {draft.status === "draft" && (
                <div className="relative group">
                  <Button
                    variant="primary"
                    onClick={handleSubmit}
                    disabled={!authority.canSubmit || processing}
                    isLoading={processing}
                  >
                    Submit for Review
                  </Button>
                  {!authority.canSubmit && authority.submitReason && (
                    <div className="absolute bottom-full right-0 mb-2 hidden group-hover:block z-10">
                      <div className="bg-gray-900 text-white text-xs rounded py-2 px-3 whitespace-nowrap shadow-lg">
                        {authority.submitReason}
                        <div className="absolute top-full right-4 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-gray-900"></div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {draft.status === "submitted" && (
                <>
                  <div className="relative group">
                    <Button
                      variant="primary"
                      onClick={handleApprove}
                      disabled={!authority.canApprove || processing}
                      isLoading={processing}
                    >
                      Approve
                    </Button>
                    {!authority.canApprove && authority.approveReason && (
                      <div className="absolute bottom-full right-0 mb-2 hidden group-hover:block z-10">
                        <div className="bg-gray-900 text-white text-xs rounded py-2 px-3 whitespace-nowrap shadow-lg">
                          {authority.approveReason}
                          <div className="absolute top-full right-4 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-gray-900"></div>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="relative group">
                    <Button
                      variant="danger"
                      onClick={() => setShowRejectModal(true)}
                      disabled={!authority.canReject || processing}
                    >
                      Reject
                    </Button>
                    {!authority.canReject && authority.rejectReason && (
                      <div className="absolute bottom-full right-0 mb-2 hidden group-hover:block z-10">
                        <div className="bg-gray-900 text-white text-xs rounded py-2 px-3 whitespace-nowrap shadow-lg">
                          {authority.rejectReason}
                          <div className="absolute top-full right-4 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-gray-900"></div>
                        </div>
                      </div>
                    )}
                  </div>
                </>
              )}

              {draft.status === "approved" && !draft.journal_entry_id && (
                <div className="relative group">
                  <Button
                    variant="primary"
                    onClick={() => setShowPostModal(true)}
                    disabled={!authority.canPost || processing}
                  >
                    Post to Ledger
                  </Button>
                  {!authority.canPost && authority.postReason && (
                    <div className="absolute bottom-full right-0 mb-2 hidden group-hover:block z-10">
                      <div className="bg-gray-900 text-white text-xs rounded py-2 px-3 whitespace-nowrap shadow-lg">
                        {authority.postReason}
                        <div className="absolute top-full right-4 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-gray-900"></div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Rejection Modal */}
          <Modal
            isOpen={showRejectModal}
            onClose={() => {
              setShowRejectModal(false)
              setRejectionReason("")
            }}
            title="Reject Draft"
            size="md"
            footer={
              <div className="flex gap-2 justify-end">
                <Button
                  variant="outline"
                  onClick={() => {
                    setShowRejectModal(false)
                    setRejectionReason("")
                  }}
                  disabled={processing}
                >
                  Cancel
                </Button>
                <Button
                  variant="danger"
                  onClick={handleReject}
                  disabled={!rejectionReason.trim() || processing}
                  isLoading={processing}
                >
                  Confirm Reject
                </Button>
              </div>
            }
          >
            <div className="space-y-4">
              <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-700 rounded-lg p-4">
                <p className="text-sm text-yellow-700 dark:text-yellow-400">
                  <strong>Note:</strong> Rejection requires a reason. This draft will become immutable.
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Rejection Reason <span className="text-red-500">*</span>
                </label>
                <textarea
                  value={rejectionReason}
                  onChange={(e) => setRejectionReason(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                  rows={4}
                  placeholder="Explain why this draft is being rejected..."
                  required
                />
              </div>
            </div>
          </Modal>

          {/* Posting Confirmation Modal */}
          <Modal
            isOpen={showPostModal}
            onClose={() => {
              if (!processing) {
                setShowPostModal(false)
                setPostConfirmationChecked(false)
                setPostError(null)
              }
            }}
            title="Post Manual Journal to Ledger"
            size="lg"
            closeOnOverlayClick={!processing}
            footer={
              <div className="flex gap-2 justify-end">
                <Button
                  variant="outline"
                  onClick={() => {
                    setShowPostModal(false)
                    setPostConfirmationChecked(false)
                    setPostError(null)
                  }}
                  disabled={processing}
                >
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  onClick={handlePost}
                  disabled={!postConfirmationChecked || processing}
                  isLoading={processing}
                >
                  Confirm & Post
                </Button>
              </div>
            }
          >
            <div className="space-y-6">
              {/* Prominent Warning */}
              <div className="bg-red-50 dark:bg-red-900/20 border-l-4 border-red-500 dark:border-red-400 rounded-lg p-4">
                <div className="flex items-start">
                  <span className="text-2xl mr-3">⚠️</span>
                  <p className="text-base font-semibold text-red-800 dark:text-red-300">
                    This action will write to the accounting ledger and cannot be undone.
                  </p>
                </div>
              </div>

              {/* Summary Panel */}
              {draft && (
                <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-6">
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                    Draft Summary
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">
                        Client
                      </label>
                      <p className="text-sm text-gray-900 dark:text-white">
                        {clientBusinessName || "—"}
                      </p>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">
                        Period
                      </label>
                      <p className="text-sm text-gray-900 dark:text-white">
                        {formatPeriod(draft.period)} ({draft.period?.status || "—"})
                      </p>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">
                        Entry Date
                      </label>
                      <p className="text-sm text-gray-900 dark:text-white">
                        {formatDate(draft.entry_date)}
                      </p>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">
                        Number of Lines
                      </label>
                      <p className="text-sm text-gray-900 dark:text-white">
                        {draft.lines.length}
                      </p>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">
                        Total Debit
                      </label>
                      <p className="text-sm font-semibold text-gray-900 dark:text-white">
                        ₵{draft.total_debit.toFixed(2)}
                      </p>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">
                        Total Credit
                      </label>
                      <p className="text-sm font-semibold text-gray-900 dark:text-white">
                        ₵{draft.total_credit.toFixed(2)}
                      </p>
                    </div>
                    <div className="md:col-span-2">
                      <label className="block text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">
                        Balance
                      </label>
                      <div className={`text-sm font-semibold ${
                        Math.abs(draft.total_debit - draft.total_credit) < 0.01
                          ? "text-green-600 dark:text-green-400"
                          : "text-red-600 dark:text-red-400"
                      }`}>
                        {Math.abs(draft.total_debit - draft.total_credit) < 0.01
                          ? "✓ Balanced (₵0.00)"
                          : `⚠ Imbalanced (₵${Math.abs(draft.total_debit - draft.total_credit).toFixed(2)})`}
                      </div>
                    </div>
                    <div className="md:col-span-2">
                      <label className="block text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">
                        Description
                      </label>
                      <p className="text-sm text-gray-900 dark:text-white">
                        {draft.description}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Confirmation Checkbox */}
              <div className="bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
                <label className="flex items-start cursor-pointer">
                  <input
                    type="checkbox"
                    checked={postConfirmationChecked}
                    onChange={(e) => {
                      setPostConfirmationChecked(e.target.checked)
                      setPostError(null)
                    }}
                    className="mt-1 mr-3 w-5 h-5 text-blue-600 border-gray-300 rounded focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600"
                    disabled={processing}
                  />
                  <span className="text-sm text-gray-700 dark:text-gray-300">
                    I confirm that this journal entry is correct and ready to be posted to the ledger.
                  </span>
                </label>
              </div>

              {/* Error Display */}
              {postError && (
                <div className="bg-red-50 dark:bg-red-900/20 border-l-4 border-red-500 dark:border-red-400 rounded-lg p-4">
                  <p className="text-sm text-red-800 dark:text-red-300">
                    {postError}
                  </p>
                </div>
              )}
            </div>
          </Modal>
        </div>
      </div>
    </ProtectedLayout>
  )
}
