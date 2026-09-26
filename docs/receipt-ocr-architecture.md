# Receipt extraction

Create Expense and Create Bill use one button, Extract from receipt. It calls `POST /api/receipt-extract-ai`. That route reads the uploaded JPG, PNG, WEBP, or PDF with OpenAI and returns editable fields. It does not create the expense or bill.

The browser PaddleOCR worker, ONNX models, and local scanner are not part of this path. See `docs/receipt-ai-extraction.md`.

`POST /api/receipt-ocr` does not run image inference. It returns JSON `{ ok: false, error, code, stage }` (including `OCR_CLIENT_REQUIRED`) when a caller still asks the server to OCR an image. Persisted-document text parsing in `lib/receipt/receiptOcr.ts` remains for that existing server flow.
