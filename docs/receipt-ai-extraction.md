# Receipt extraction

Extract from receipt is the only extractor. It sends the receipt image or PDF from the Finza server to the OpenAI API. The browser does not call OpenAI. `OPENAI_API_KEY` is a server environment variable and is not a `NEXT_PUBLIC_*` value.

The call uses the Responses API with Structured Outputs. `store` is `false`. The model name comes from `OPENAI_RECEIPT_MODEL` and defaults to `gpt-6-luna`. Accepted files are JPG, PNG, WEBP, and PDF.

Finza logs model name, duration, file type, file size, token counts, and success or failure. It does not log the image, the receipt transcript, the supplier, or the amount.

The form shows supplier, date, and amount as editable suggestions marked From receipt. Creating the expense or bill is still a separate action. The extractor does not create an expense, a supplier, or a ledger entry, and it does not change VAT calculation.
