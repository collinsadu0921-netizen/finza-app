import { describe, expect, it, jest } from "@jest/globals"
import type { SupabaseClient } from "@supabase/supabase-js"
import { fetchCoverImageDataUri, fetchStoredCoverImageDataUri } from "../coverImageData"

function adminWithDownload(result: { data: unknown; error: unknown }): SupabaseClient {
  return {
    storage: {
      from: jest.fn(() => ({
        download: jest.fn(async () => result),
      })),
    },
  } as unknown as SupabaseClient
}

describe("coverImageData", () => {
  it("only accepts absolute HTTP image URLs for remote fetches", async () => {
    await expect(fetchCoverImageDataUri("/api/proposals/public/token/assets/id")).resolves.toBeUndefined()
    await expect(fetchCoverImageDataUri("javascript:alert(1)")).resolves.toBeUndefined()
    await expect(fetchCoverImageDataUri(null)).resolves.toBeUndefined()
  })

  it("loads an authorised stored image row as a data URI", async () => {
    const admin = adminWithDownload({
      data: { arrayBuffer: async () => Uint8Array.from([1, 2, 3]).buffer },
      error: null,
    })
    await expect(
      fetchStoredCoverImageDataUri(admin, {
        storage_path: "business/proposal/asset.jpg",
        mime_type: "image/jpeg",
      })
    ).resolves.toBe("data:image/jpeg;base64,AQID")
  })

  it("rejects missing paths, non-image MIME types and storage errors", async () => {
    const admin = adminWithDownload({ data: null, error: { message: "not found" } })
    await expect(fetchStoredCoverImageDataUri(admin, { storage_path: "", mime_type: "image/png" })).resolves.toBeUndefined()
    await expect(
      fetchStoredCoverImageDataUri(admin, { storage_path: "business/proposal/a.pdf", mime_type: "application/pdf" })
    ).resolves.toBeUndefined()
    await expect(
      fetchStoredCoverImageDataUri(admin, { storage_path: "business/proposal/a.jpg", mime_type: "image/jpeg" })
    ).resolves.toBeUndefined()
  })
})
