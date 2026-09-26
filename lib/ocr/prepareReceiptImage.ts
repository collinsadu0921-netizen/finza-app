"use client"

import { MAX_SOURCE_EDGE_PX, MAX_WORKING_EDGE_PX } from "@/lib/ocr/constants"

export type WorkingImage = {
  blob: Blob
  width: number
  height: number
}

export async function prepareWorkingImage(file: Blob): Promise<WorkingImage> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" })
  try {
    if (bitmap.width > MAX_SOURCE_EDGE_PX || bitmap.height > MAX_SOURCE_EDGE_PX) {
      throw Object.assign(new Error("Image is too large"), { code: "OCR_IMAGE_TOO_LARGE", stage: "preprocess" })
    }
    const edge = Math.max(bitmap.width, bitmap.height)
    const scale = edge > MAX_WORKING_EDGE_PX ? MAX_WORKING_EDGE_PX / edge : 1
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))
    if (scale === 1) {
      return { blob: file, width: bitmap.width, height: bitmap.height }
    }
    const canvas = document.createElement("canvas")
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext("2d")
    if (!ctx) {
      throw Object.assign(new Error("Could not prepare the receipt image"), { code: "OCR_PREPROCESS_FAILED", stage: "preprocess" })
    }
    ctx.drawImage(bitmap, 0, 0, width, height)
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (out) => (out ? resolve(out) : reject(Object.assign(new Error("Could not prepare the receipt image"), { code: "OCR_PREPROCESS_FAILED", stage: "preprocess" }))),
        "image/jpeg",
        0.9
      )
    })
    return { blob, width, height }
  } finally {
    bitmap.close()
  }
}
