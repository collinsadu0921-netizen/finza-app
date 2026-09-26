# Receipt OCR

## What failed

Create Expense → Extract from receipt uploaded the file, then `POST /api/receipt-ocr` ran Tesseract.js inside the Vercel Node function (`maxDuration = 60`, `runtime = nodejs`).

Tesseract.js 7 spawns a `worker_threads` worker, loads WASM from `tesseract.js-core`, and downloads `eng.traineddata` from jsDelivr (`@tesseract.js-data/eng/4.0.0_best_int`) on first use. The route's `try/catch` returns JSON. The browser instead received an HTML error page (`An error occurred` / `<!DOCTYPE>`), which only happens when the Vercel isolate is killed before the handler returns. Locally the same engine read a clean receipt in about 2.5s, so the failure is the serverless worker/WASM path, not the receipt image and not a parser miss.

`RECEIPT_OCR_USE_STUB=true` skips Tesseract and returns fixed sample text. It is a developer bypass, not a product fix.

## What runs now

Open-source PaddleOCR.js (`@paddleocr/paddleocr-js@0.4.2`, Apache-2.0) with PP-OCRv5 mobile detection and recognition. The Next app does not import that package. It starts a same-origin module worker at `public/ocr/vendor/paddleocr/0.4.2/receipt-ocr-worker.js`, which is the package's unmodified worker bundle (OpenCV and the OCR runtime are inside that file). Inference runs in that worker (WASM, SIMD, one thread). The receipt image is not sent to a third-party OCR API. Upload to Finza storage is unchanged and still happens so the expense can keep its receipt.

The deterministic parser in `lib/receipt/receiptOcr.ts` turns lines into supplier, date, total, and currency. It does not create an expense. The user reviews the form and clicks Create Expense.

PDFs are rendered in the browser with PDF.js (first 3 pages, hard stop at 15) and those page images are scanned. The server no longer rasterizes PDFs with node-canvas or Tesseract.

## Models

Hosted by Finza from the official Paddle OCR ONNX archives (uncompressed ustar, `inference.onnx` + `inference.yml`).

| Model | File | SHA-256 |
| --- | --- | --- |
| PP-OCRv5_mobile_det | `public/ocr/models/PP-OCRv5_mobile_det_onnx_infer.tar` | `781056046c9ed77a15c94681605db6a0f62317c2e9cce6931c71da2478d4bc30` |
| PP-OCRv5_mobile_rec | `public/ocr/models/PP-OCRv5_mobile_rec_onnx_infer.tar` | `f7e792bc836f36e7ef895ad47c426d75b0b75b1650caa6d63fe9418441ffba8c` |

Source archives: `https://paddle-model-ecology.bj.bcebos.com/paddlex/official_inference_model/paddle3.0.0/`.

ONNX Runtime Web `1.30.0` loads the JSEP WASM build even when the backend is `wasm`. Those files are pinned under `public/ocr/onnxruntime/` (not the SDK's jsDelivr fallback, which is an older runtime).

| File | SHA-256 |
| --- | --- |
| `ort-wasm-simd-threaded.jsep.wasm` | `3ad23231b5bd6d9dda55a7f84606315e0bf35b6750c28ee993c987c54cacab0f` |
| `ort-wasm-simd-threaded.jsep.mjs` | `709853412fd1ffc34247af1e73569227b5b79629c5ca3f59cc39cf7e500e4947` |
| `ort-wasm-simd-threaded.wasm` | `3398c10d07d229bd91b364548e130e0e51a8e5704b88c7c083ebbeb78842dee2` |
| `ort-wasm-simd-threaded.mjs` | `e13f7f94fc51b4ca72b12faeb1ee95f4ace6dfbc8939bc718aabdc0a27c4299b` |

`numThreads` is 1 so the page does not need cross-origin isolation. The worker is a static file, so the Next compiler does not parse the OpenCV bundle inside it.

## Synthetic corpus (Chromium, local webpack dev)

Clean receipts: supplier, date, and total matched the fixture on the Ghana shop, GHS total, GH₵/GHC total, VAT, subtotal-vs-total, cash/change, tilted, PNG, JPEG, phone-camera, long receipt, and single-page PDF. The low-contrast sample kept the correct date and total; the supplier came back without spaces (`KOFISHOPLTD`) at low confidence.

First scan on this machine: about 10s to load the model, then about 2s of detection plus recognition (about 18s wall clock, including asset download). The next scan of the same receipt was about 1.7s (detection ~0.4s, recognition ~1.3s). A phone-camera-sized image was about 6.4s warm. A 34-line receipt was about 7.8s warm.

## Parser note

PP-OCRv5 often reads the printed cedi sign as `GHC`. The parser treats `GHC` as GHS and still reads the amount. It does not invent GHS when nothing is printed and no business currency was passed.

PaddleOCR and these models are Apache-2.0. ONNX Runtime Web is MIT. See `public/ocr/NOTICE.txt`.

Staging can also call `POST /api/receipt-extract-ai` for an OpenAI vision comparison. That path is off unless `RECEIPT_AI_EXTRACT_ENABLED` and `NEXT_PUBLIC_RECEIPT_AI_ENABLED` are set. It does not replace Paddle. See `docs/receipt-ai-extraction.md`.

## Failure behavior

If the scanner cannot start or cannot read the file, the form stays editable and shows: "Couldn't read this receipt automatically. You can still enter the expense manually." `POST /api/receipt-ocr` no longer runs OCR. It returns JSON `{ ok: false, error, code, stage }` (including `OCR_CLIENT_REQUIRED`) instead of an HTML platform page.

## Build

`npm run build` is `next build` (Turbopack), the same command as current main. Importing `@paddleocr/paddleocr-js` makes Turbopack parse `@techstark/opencv-js` `dist/opencv.js`, which is a single line of about 10.3MB, and `RegExp.exec` overflows the stack. The static worker keeps that file out of the Next module graph.

## Rollback

Revert the browser scanner and restore `tesseract.js` plus `lib/receipt/tesseractReceiptOcr.ts` only if a serverless runtime can host the worker without killing the isolate. Do not fix this by raising the Vercel timeout alone.
