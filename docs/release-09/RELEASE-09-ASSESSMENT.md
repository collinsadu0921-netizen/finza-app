# Release 09 — rich text and prepared-by sender

**Baseline:** `68e7e97955fc0c9f6e3b45b173b758a72f79a7ca`  
**Branch:** `feat/proposal-rich-text-sender-09`  
**Scope:** incremental proposal-editor enhancement only. No pricing/tax, accounting, payroll, retail or unrelated module changes.

## 1. Open-source editor assessment

Assessed against current official documentation and package metadata (checked 11 November 2026):

| Option | Licence | React fit | Integration / model | Current package weight |
|---|---|---|---|---|
| **Tiptap 3.33.1** | MIT core | React 17/18/19 peer support; documented Next.js SSR via `immediatelyRender: false` | Headless React editor built on ProseMirror. Produces JSON, supports schema-restricted marks/nodes, history, lists, links, underline and keyboard shortcuts with StarterKit. | `@tiptap/starter-kit` 344.1 kB min / 108.0 kB gzip; `@tiptap/react` 29.2 kB / 9.0 kB gzip (Bundlephobia) |
| **ProseMirror 1.25** | MIT | Framework-agnostic; React requires custom view integration | Maximum control, but requires assembling `prosemirror-view`, state, commands, history, keymaps, input rules, list schema and toolbar behaviour manually. | `prosemirror-model` 46.3 kB min / 14.5 kB gzip; core editor requires several more modules |
| **Lexical 0.53.0** | MIT | React 18+ peer support; extension/composer API | Strong React fit and lean core, but a separate node model, serialization, theme and plugin set (rich-text, list, link, history, clipboard) must be integrated. | `lexical` 218.4 kB min / 69.4 kB gzip before React/rich-text/list/link packages |

### Decision

**Tiptap with StarterKit** is the simplest reliable solution for Finza:

- It gives schema-controlled ProseMirror JSON rather than raw HTML.
- React 18 is supported by the current package.
- StarterKit already includes Bold, Italic, Underline, Link, Heading, BulletList, OrderedList, HardBreak, Undo/Redo and ListKeymap.
- Only three packages are added: `@tiptap/react`, `@tiptap/pm`, `@tiptap/starter-kit`.
- ProseMirror is not introduced as a second editor system; it is Tiptap's underlying document model.
- Lexical would add a second model and more integration surface without a functional advantage here.

## 2. Data format

`proposals.sections` remains the source of truth. Existing block types are unchanged and still render. A new optional block is added:

```ts
type ProposalRichTextDoc = {
  version: 1
  blocks: Array<
    | { type: "paragraph"; runs: RichTextRun[] }
    | { type: "heading"; level: 2 | 3; runs: RichTextRun[] }
    | { type: "bullet_list"; items: RichTextRun[][] }
    | { type: "ordered_list"; items: RichTextRun[][] }
  >
}

type RichTextRun =
  | { type: "text"; text: string; marks?: RichTextMark[] }
  | { type: "break" }

type RichTextMark =
  | { type: "bold" }
  | { type: "italic" }
  | { type: "underline" }
  | { type: "link"; href: string }
```

- Stored as a restricted AST, never unrestricted HTML.
- Legacy `paragraph`, `heading` and `bullet_list` blocks remain valid and are converted to rich text only when edited.
- Existing plain text is split into paragraphs on blank lines and line breaks on single newlines.
- Formatting is preserved through save/reload because the AST is stored in JSONB.
- Oversized rich-text blocks are split at block/paragraph boundaries for reader and PDF pagination.

## 3. Security model

- Zod validates every block, run, mark and link server-side before persistence.
- Only bold, italic, underline and link marks are accepted.
- Links must be absolute `http(s)` or `mailto`; `javascript:`, `data:`, relative paths, credentials and malformed URLs are rejected.
- No `dangerouslySetInnerHTML` is used in the React readers.
- PDF output is individually escaped; link labels and text are HTML-escaped.
- Stored rich text is sanitised before lenient rendering, so one malformed link cannot discard a whole proposal section list.
- Existing tenant RLS and proposal authorisation are unchanged.
- AI input flattens rich text to plain text; AI replacement of a formatted chapter emits an explicit warning, and unaffected chapters retain their formatting.

## 4. Sender snapshot

Additive migration `703_proposal_rich_text_sender.sql` adds nullable columns on `public.proposals`:

- `prepared_by_name`
- `prepared_by_title`
- `prepared_by_email`
- `prepared_by_phone`

The business remains the official issuer. The sender fields are a per-proposal snapshot, so later profile changes do not rewrite historical documents. The editor loads existing sender values; it only prefills the name from the authenticated user's profile when the proposal has no sender name. Email and phone are never prefilled from private account details.

## 5. Rendering paths

The same AST is consumed by:

- Tiptap editor.
- `RichTextContent` for the Minimal/Modern/Premium digital reader and public link.
- `ProposalDocumentView` fallback.
- `buildProposalHtmlForPdf` for staff and public PDFs.

Cover sender blocks are rendered from the snapshot in the reader and PDF, with template-specific styling and no reintroduction of edition/GHS cover labels.

## 6. Migration

- `703_proposal_rich_text_sender.sql` is additive, with length constraints and comments.
- Applied only to staging Supabase `adonhhtooawkeemdqqeo`, ledger row recorded.
- No production migration has been run.
- Emergency rollback file exists but is destructive (drops the snapshot columns); prefer a forward fix.

## 7. Known limitations

- Rich text supports one level of bullet/ordered lists; nested lists are flattened into same-level items.
- Images remain separate proposal media blocks, not inline rich-text embeds.
- A fixed accessible toolbar is used rather than a floating selection bubble.
- Sender preferences are not persisted to a separate profile preference; only the per-proposal snapshot is stored.
- AI replacement resets formatting only in the replaced chapter and shows a warning; it does not preserve inline marks inside AI-rewritten text.
- Production deployment is intentionally out of scope for this release.
