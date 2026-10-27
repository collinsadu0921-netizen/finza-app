import { describe, expect, it } from "@jest/globals"
import {
  auditActorKind,
  auditActorLabel,
  formatAuditAction,
  formatAuditEntity,
  formatAuditSummary,
} from "@/lib/audit/formatAuditLog"

describe("Service audit display formatting", () => {
  it("uses a member display name over email", () => {
    const log = {
      user_id: "user-1",
      user: { display_name: "Ama Mensah", email: "ama@example.com" },
      action_type: "journal_entry.created",
      entity_type: "journal_entry",
    }
    expect(auditActorKind(log)).toBe("user")
    expect(auditActorLabel(log)).toBe("Ama Mensah")
  })

  it("falls back to email when no name exists", () => {
    const log = {
      user_id: "user-1",
      user: { name: null, email: "staging@test.com" },
      action_type: "journal_entry.created",
      entity_type: "journal_entry",
    }
    expect(auditActorLabel(log)).toBe("staging@test.com")
  })

  it("does not call a captured but unresolved actor System", () => {
    const log = {
      user_id: "missing-user",
      user: null,
      action_type: "journal_entry.created",
      entity_type: "journal_entry",
    }
    expect(auditActorKind(log)).toBe("unknown")
    expect(auditActorLabel(log)).toBe("Unknown actor")
  })

  it("labels confirmed system account creation as System", () => {
    const log = {
      user_id: null,
      action_type: "account.created",
      entity_type: "account",
      new_values: { code: "1000", name: "Cash", is_system: true },
    }
    expect(auditActorKind(log)).toBe("system")
    expect(auditActorLabel(log)).toBe("System")
    expect(formatAuditAction(log)).toBe("System account created")
    expect(formatAuditEntity(log)).toBe("Account · Cash (1000)")
    expect(formatAuditSummary(log)).toBe("Cash (1000)")
  })

  it("labels a null actor as Unknown when automation is not established", () => {
    const log = {
      user_id: null,
      action_type: "invoice.created",
      entity_type: "invoice",
      new_values: { invoice_number: "INV-001" },
    }
    expect(auditActorKind(log)).toBe("unknown")
    expect(auditActorLabel(log)).toBe("Unknown actor")
    expect(formatAuditAction(log)).toBe("Invoice created")
  })

  it("formats a manual journal posting with its reference and description", () => {
    const log = {
      user_id: "user-1",
      user: { email: "staging@test.com" },
      action_type: "journal_entry.created",
      entity_type: "journal_entry",
      description: null,
      new_values: {
        source_type: "service_manual",
        reference_type: "manual",
        reference: "VERIFY-585-B",
        description: "Staging verification MJ-B transfer 2026-10-25",
      },
    }
    expect(formatAuditAction(log)).toBe("Manual journal posted")
    expect(formatAuditEntity(log)).toBe("Manual journal · VERIFY-585-B")
    expect(formatAuditSummary(log)).toBe(
      "Staging verification MJ-B transfer 2026-10-25 · VERIFY-585-B"
    )
  })

  it("formats an existing reversal and keeps its reason", () => {
    const log = {
      user_id: "user-1",
      user: { email: "staging@test.com" },
      action_type: "reversal",
      entity_type: "journal_entry",
      description: "Staging verification reverse A generic",
      new_values: { reversal_je_id: "reversal-1" },
    }
    expect(formatAuditAction(log)).toBe("Journal entry reversed")
    expect(formatAuditSummary(log)).toBe("Staging verification reverse A generic")
  })

  it("formats a Service manual reversal atomically recorded by the trigger", () => {
    const log = {
      user_id: "user-1",
      user: { email: "staging@test.com" },
      action_type: "manual_journal.reversed",
      entity_type: "journal_entry",
      description: "Reversal reason for audit test",
      new_values: {
        original_journal_entry_id: "original-1",
        reversal_journal_entry_id: "reversal-1",
        source_type: "service_manual",
        reference: "AUDIT-REV-A",
      },
    }
    expect(formatAuditAction(log)).toBe("Manual journal reversed")
    expect(formatAuditEntity(log)).toBe("Manual journal · AUDIT-REV-A")
    expect(formatAuditSummary(log)).toBe("Reversal reason for audit test")
  })
})
