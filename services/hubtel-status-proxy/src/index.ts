import { createServer } from "./server"

const port = Number.parseInt(process.env.PORT ?? "3100", 10)

const server = createServer()
server.listen(port, "0.0.0.0", () => {
  console.log(`[hubtel-status-proxy] listening on 0.0.0.0:${port}`)
})
