import http from "node:http"
import type { IncomingMessage, ServerResponse } from "node:http"
import {
  callHubtelTransactionStatus,
  safeLogLine,
  validateStatusCheckBody,
} from "./hubtel"

const JSON_CT = "application/json; charset=utf-8"

function readSecret(): string {
  return (process.env.HUBTEL_STATUS_PROXY_SECRET ?? "").trim()
}

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8").trim()
      if (!raw) {
        resolve({})
        return
      }
      try {
        resolve(JSON.parse(raw))
      } catch {
        reject(new Error("Invalid JSON"))
      }
    })
    req.on("error", reject)
  })
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload)
  res.writeHead(status, { "Content-Type": JSON_CT, "Content-Length": Buffer.byteLength(body) })
  res.end(body)
}

function sendRaw(res: ServerResponse, status: number, body: string, contentType = JSON_CT): void {
  res.writeHead(status, { "Content-Type": contentType, "Content-Length": Buffer.byteLength(body) })
  res.end(body)
}

function isAuthorized(req: IncomingMessage): boolean {
  const expected = readSecret()
  if (!expected) return false
  const provided = (req.headers["x-finza-internal-secret"] ?? "").toString().trim()
  return provided.length > 0 && provided === expected
}

export async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const method = req.method ?? "GET"
  const path = (req.url ?? "/").split("?")[0]

  if (method === "GET" && path === "/health") {
    sendJson(res, 200, { ok: true, service: "finza-hubtel-status-proxy" })
    return
  }

  if (path === "/hubtel/status-check") {
    if (method !== "POST") {
      sendJson(res, 405, { error: "Method not allowed" })
      return
    }
    if (!readSecret()) {
      sendJson(res, 500, { error: "Proxy secret is not configured" })
      return
    }
    if (!isAuthorized(req)) {
      sendJson(res, 401, { error: "Unauthorized" })
      return
    }

    let rawBody: unknown
    try {
      rawBody = await readJsonBody(req)
    } catch {
      sendJson(res, 400, { error: "Invalid JSON" })
      return
    }

    const validated = validateStatusCheckBody(rawBody)
    if (!validated.ok) {
      sendJson(res, 400, { error: validated.error })
      return
    }

    try {
      const hubtel = await callHubtelTransactionStatus(validated.body)
      console.log(
        safeLogLine({
          clientReference: validated.body.clientReference,
          checkoutId: validated.body.checkoutId ?? validated.body.providerTransactionId,
          httpStatus: hubtel.httpStatus,
          responseText: hubtel.responseText,
        })
      )
      sendRaw(res, hubtel.httpStatus, hubtel.responseText)
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Hubtel request failed"
      console.error(
        JSON.stringify({
          ts: new Date().toISOString(),
          clientReference: validated.body.clientReference,
          checkoutId: validated.body.checkoutId ?? validated.body.providerTransactionId,
          error: message,
        })
      )
      sendJson(res, 502, { error: "Hubtel status check failed", message })
    }
    return
  }

  sendJson(res, 404, { error: "Not found" })
}

export function createServer(): http.Server {
  return http.createServer((req, res) => {
    handleRequest(req, res).catch((err) => {
      console.error("[hubtel-status-proxy] unhandled", err)
      if (!res.headersSent) {
        sendJson(res, 500, { error: "Internal server error" })
      }
    })
  })
}
