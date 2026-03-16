/**
 * Image Processing Utility for Product Images
 * BATCH 2: Image Storage & Validation
 * 
 * Ensures images are:
 * - Safe (jpg, png, webp only)
 * - Small (max 200KB)
 * - Square (1:1 aspect ratio)
 */

const ALLOWED_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp']
const MAX_SIZE = 200 * 1024 // 200KB
const TARGET_SIZE = 800 // 800x800px square image

export interface ProcessedImage {
  blob: Blob
  url: string
  type: string
}

/**
 * Validates image file type
 */
export function validateImageType(file: File): { valid: boolean; error?: string } {
  if (!ALLOWED_TYPES.includes(file.type.toLowerCase())) {
    return {
      valid: false,
      error: 'Only JPG, PNG, and WebP images are allowed'
    }
  }
  return { valid: true }
}

/**
 * Validates image file size (before processing)
 */
export function validateImageSize(file: File): { valid: boolean; error?: string } {
  // Allow up to 5MB input, we'll compress it down
  const maxInputSize = 5 * 1024 * 1024 // 5MB
  if (file.size > maxInputSize) {
    return {
      valid: false,
      error: 'Image file is too large. Please use an image smaller than 5MB'
    }
  }
  return { valid: true }
}

/**
 * Processes image: crops to square, resizes, and compresses
 */
export function processProductImage(file: File): Promise<ProcessedImage> {
  return new Promise((resolve, reject) => {
    // Validate type
    const typeValidation = validateImageType(file)
    if (!typeValidation.valid) {
      reject(new Error(typeValidation.error))
      return
    }

    // Validate size
    const sizeValidation = validateImageSize(file)
    if (!sizeValidation.valid) {
      reject(new Error(sizeValidation.error))
      return
    }

    const reader = new FileReader()
    
    reader.onload = (e) => {
      const img = new Image()
      
      img.onload = () => {
        try {
          // Calculate square crop dimensions (center crop)
          const size = Math.min(img.width, img.height)
          const x = (img.width - size) / 2
          const y = (img.height - size) / 2

          // Create canvas for square crop
          const canvas = document.createElement('canvas')
          canvas.width = TARGET_SIZE
          canvas.height = TARGET_SIZE
          const ctx = canvas.getContext('2d')

          if (!ctx) {
            reject(new Error('Failed to create canvas context'))
            return
          }

          // Draw cropped and resized image
          ctx.drawImage(
            img,
            x, y, size, size, // Source: square crop from center
            0, 0, TARGET_SIZE, TARGET_SIZE // Destination: 800x800 canvas
          )

          // Determine output format (prefer webp for better compression, fallback to original)
          const outputType = file.type.includes('webp') ? 'image/webp' : 
                            file.type.includes('png') ? 'image/png' : 
                            'image/jpeg'
          
          // Convert to blob with compression, trying progressively lower quality
          const tryCompress = (quality: number, attempt: number): void => {
            canvas.toBlob(
              (blob) => {
                if (!blob) {
                  reject(new Error('Failed to process image'))
                  return
                }

                // Check if compressed size is under limit
                if (blob.size > MAX_SIZE && attempt < 3) {
                  // Try again with lower quality (0.85 -> 0.7 -> 0.5)
                  const nextQuality = quality - 0.15
                  tryCompress(nextQuality, attempt + 1)
                } else if (blob.size > MAX_SIZE) {
                  // Final attempt: reduce canvas size if still too large
                  const smallerCanvas = document.createElement('canvas')
                  smallerCanvas.width = 600
                  smallerCanvas.height = 600
                  const smallerCtx = smallerCanvas.getContext('2d')
                  
                  if (!smallerCtx) {
                    reject(new Error('Image is too large even after compression. Please use a smaller image.'))
                    return
                  }
                  
                  smallerCtx.drawImage(
                    img,
                    x, y, size, size,
                    0, 0, 600, 600
                  )
                  
                  smallerCanvas.toBlob(
                    (finalBlob) => {
                      if (!finalBlob || finalBlob.size > MAX_SIZE) {
                        reject(new Error('Image is too large even after compression. Please use a smaller image.'))
                        return
                      }
                      
                      const url = URL.createObjectURL(finalBlob)
                      resolve({
                        blob: finalBlob,
                        url,
                        type: outputType
                      })
                    },
                    outputType,
                    0.5
                  )
                } else {
                  const url = URL.createObjectURL(blob)
                  resolve({
                    blob,
                    url,
                    type: outputType
                  })
                }
              },
              outputType,
              quality
            )
          }
          
          // Start with 85% quality
          tryCompress(0.85, 1)
        } catch (error: any) {
          reject(new Error(error.message || 'Failed to process image'))
        }
      }

      img.onerror = () => {
        reject(new Error('Invalid image file'))
      }

      if (e.target?.result) {
        img.src = e.target.result as string
      } else {
        reject(new Error('Failed to read image file'))
      }
    }

    reader.onerror = () => {
      reject(new Error('Failed to read image file'))
    }

    reader.readAsDataURL(file)
  })
}












