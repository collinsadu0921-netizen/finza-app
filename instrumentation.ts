export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { registerServerActiveBusinessResolver } = await import("./lib/business.server")
    registerServerActiveBusinessResolver()
  }
}
