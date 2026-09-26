# OpenAI receipt extraction (staging comparison)

PaddleOCR still runs in the browser. This path is an additional staging test.

## What is sent

Extract with AI sends the receipt image or PDF from the Finza server to the OpenAI API. The browser does not call OpenAI. `OPENAI_API_KEY` is a server environment variable and is not a `NEXT_PUBLIC_*` value.

The call uses the Responses API with Structured Outputs. `store` is `false`, so Finza does not ask OpenAI to retain the response. No other OCR provider is used on this path. PaddleOCR, its worker, and its models stay on the Finza origin and are not sent to OpenAI.

## What is not sent to the model

Paddle text is not included. The model sees the original file. Finza logs model name, duration, file type, file size, token counts, and success or failure. It does not log the image, the receipt transcript, the supplier, or the amount.

## What the result does

The form can show supplier, date, amount, and currency as editable suggestions marked From receipt. Creating the expense is still a separate action. The extractor does not create an expense, a supplier, or a ledger entry, and it does not change VAT calculation.

The buttons appear only when `NEXT_PUBLIC_RECEIPT_AI_ENABLED=true`. The route runs only when `RECEIPT_AI_EXTRACT_ENABLED=true`. The model name comes from `OPENAI_RECEIPT_MODEL` (initial value `gpt-6-luna`).

Those variables, plus `OPENAI_API_KEY`, are set on the preview environment for `feat/staging-openai-receipt` only. They are not production variables.
