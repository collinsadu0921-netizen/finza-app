/** Pinned browser OCR stack. Inference does not run on Vercel. */

export const OCR_ENGINE = "paddleocr-js"
export const PADDLEOCR_JS_VERSION = "0.4.2"
export const ONNXRUNTIME_WEB_VERSION = "1.30.0"

export const PADDLE_DET_MODEL = "PP-OCRv5_mobile_det"
export const PADDLE_REC_MODEL = "PP-OCRv5_mobile_rec"

/** Same-origin copies of the official uncompressed ONNX ustar archives. */
export const PADDLE_DET_ASSET_URL = "/ocr/models/PP-OCRv5_mobile_det_onnx_infer.tar"
export const PADDLE_REC_ASSET_URL = "/ocr/models/PP-OCRv5_mobile_rec_onnx_infer.tar"

/** Directory of onnxruntime-web 1.30.0 WASM files. Must match the installed JS build. */
export const ORT_WASM_PATH = "/ocr/onnxruntime/"

/**
 * Self-contained PaddleOCR.js 0.4.2 worker (OpenCV + runtime).
 * Served as a static file so Next/Turbopack does not parse OpenCV.
 */
export const PADDLE_WORKER_URL = "/ocr/vendor/paddleocr/0.4.2/receipt-ocr-worker.js"

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024
export const MAX_PDF_BYTES = 12 * 1024 * 1024
export const MAX_PDF_PAGES = 3
export const MAX_WORKING_EDGE_PX = 1600
export const MAX_SOURCE_EDGE_PX = 8000
