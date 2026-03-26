const fs = require("fs")
const path = require("path")

const ROOT = process.cwd()
const ACCOUNTING_DIRS = ["app/accounting", "app/api/accounting", "lib/accounting"]
const ALLOWED_PREFIXES = [
  "@/accounting/",
  "@/shared/",
  "@/lib/accounting/",
  "@/types/accounting/",
  "@/components/accounting/",
]
const NEUTRAL_INFRA_ALLOWLIST = [
  "@/lib/supabaseClient",
  "@/lib/supabaseServer",
  "@/lib/auth/",
  "@/lib/apiGuards",
  "@/lib/auditLog",
  "@/lib/exportUtils",
  "@/lib/currency",
  "@/lib/currency/",
  "@/lib/userRoles",
  "@/types/supabase",
  "@/components/ui/",
  "@/components/ProtectedLayout",
  "@/components/AccountingBreadcrumbs",
  "@/components/AccountingClientContextGate",
  "@/components/EngagementStatusBadge",
  "@/components/AuthorityGuard",
  "@/components/RoleCapabilityMatrix",
  "@/components/controlTower/",
]
const FORBIDDEN_DOMAIN_PREFIXES = ["@/service/", "@/retail/"]
const FORBIDDEN_CONTEXT_CALLS = ["getCurrentBusiness(", "getLatestBusiness("]
const SCAN_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx"])

function walk(dir, files = []) {
  if (!fs.existsSync(dir)) return files
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      walk(fullPath, files)
      continue
    }
    if (SCAN_EXTENSIONS.has(path.extname(entry.name))) {
      files.push(fullPath)
    }
  }
  return files
}

function readImports(content) {
  const importRegex =
    /(?:import\s+(?:type\s+)?(?:[\w*\s{},]*\s+from\s+)?|export\s+[\w*\s{},]*\s+from\s+)["']([^"']+)["']/g
  const imports = []
  let match
  while ((match = importRegex.exec(content))) {
    imports.push(match[1])
  }
  return imports
}

function toRepoPath(fullPath) {
  return path.relative(ROOT, fullPath).replace(/\\/g, "/")
}

function isAllowedAccountingImport(specifier) {
  if (ALLOWED_PREFIXES.some((prefix) => specifier.startsWith(prefix))) {
    return true
  }
  return NEUTRAL_INFRA_ALLOWLIST.some(
    (prefix) => specifier === prefix || specifier.startsWith(prefix)
  )
}

const violations = []

for (const relDir of ACCOUNTING_DIRS) {
  const absDir = path.join(ROOT, relDir)
  const files = walk(absDir)

  for (const file of files) {
    const content = fs.readFileSync(file, "utf8")
    const imports = readImports(content)
    const repoPath = toRepoPath(file)

    for (const specifier of imports) {
      if (FORBIDDEN_DOMAIN_PREFIXES.some((prefix) => specifier.startsWith(prefix))) {
        violations.push(`${repoPath}: forbidden cross-domain import -> ${specifier}`)
      }

      if (specifier.startsWith("@/") && !isAllowedAccountingImport(specifier)) {
        violations.push(`${repoPath}: non-accounting import is not allowed -> ${specifier}`)
      }
    }

    if (repoPath.startsWith("app/api/accounting/") || repoPath.startsWith("lib/accounting/")) {
      for (const needle of FORBIDDEN_CONTEXT_CALLS) {
        if (content.includes(needle)) {
          violations.push(`${repoPath}: forbidden implicit context resolver usage -> ${needle}`)
        }
      }
    }
  }
}

if (violations.length > 0) {
  console.error("Boundary violations detected:")
  for (const violation of violations) {
    console.error(`- ${violation}`)
  }
  process.exit(1)
}

console.log("Boundary check passed: no accounting cross-domain violations found.")
