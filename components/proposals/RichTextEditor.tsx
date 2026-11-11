"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"
import { EditorContent, useEditor, useEditorState, type JSONContent } from "@tiptap/react"
import StarterKit from "@tiptap/starter-kit"
import {
  normalizeSafeHref,
  richTextDocFromProseMirror,
  richTextDocHasText,
  richTextDocToProseMirror,
  type ProposalRichTextDoc,
} from "@/lib/proposals/richText"

type ToolbarButtonProps = {
  label: string
  title: string
  active?: boolean
  disabled?: boolean
  onClick: () => void
  children: ReactNode
  className?: string
}

function ToolbarButton({
  label,
  title,
  active,
  disabled,
  onClick,
  children,
  className,
}: ToolbarButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      title={title}
      disabled={disabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className={`inline-flex h-8 min-w-8 items-center justify-center rounded-md border px-2 text-xs font-semibold transition ${
        active
          ? "border-slate-900 bg-slate-900 text-white"
          : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50"
      } disabled:cursor-not-allowed disabled:opacity-35 ${className ?? ""}`}
    >
      {children}
    </button>
  )
}

function sameDoc(a: ProposalRichTextDoc, b: ProposalRichTextDoc): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

export function RichTextEditor({
  value,
  onChange,
  disabled = false,
  ariaLabel = "Proposal content",
  minHeightClassName = "min-h-[128px]",
}: {
  value: ProposalRichTextDoc
  onChange: (doc: ProposalRichTextDoc) => void
  disabled?: boolean
  ariaLabel?: string
  minHeightClassName?: string
}) {
  const syncingRef = useRef(false)
  const [linkError, setLinkError] = useState("")

  const editor = useEditor({
    immediatelyRender: false,
    editable: !disabled,
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
        blockquote: false,
        codeBlock: false,
        horizontalRule: false,
        strike: false,
        link: {
          openOnClick: false,
          autolink: true,
          linkOnPaste: true,
          defaultProtocol: "https",
          isAllowedUri: (url, ctx) => ctx.defaultValidate(url) && normalizeSafeHref(url) !== null,
          HTMLAttributes: {
            target: "_blank",
            rel: "noopener noreferrer nofollow",
          },
        },
        underline: {},
      }),
    ],
    content: richTextDocToProseMirror(value) as JSONContent,
    editorProps: {
      attributes: {
        class: `proposal-rich-editor-content ${minHeightClassName}`,
        role: "textbox",
        "aria-multiline": "true",
        "aria-label": ariaLabel,
      },
    },
    onUpdate: ({ editor: current }) => {
      if (syncingRef.current) return
      const doc = richTextDocFromProseMirror(current.getJSON())
      onChange(doc)
    },
  })

  useEffect(() => {
    if (!editor) return
    editor.setEditable(!disabled)
  }, [disabled, editor])

  useEffect(() => {
    if (!editor) return
    const current = richTextDocFromProseMirror(editor.getJSON())
    if (sameDoc(current, value)) return
    syncingRef.current = true
    editor.commands.setContent(richTextDocToProseMirror(value) as JSONContent, { emitUpdate: false })
    syncingRef.current = false
  }, [editor, value])

  const toolbar = useEditorState({
    editor,
    selector: ({ editor: current }) =>
      current
        ? {
            bold: current.isActive("bold"),
            italic: current.isActive("italic"),
            underline: current.isActive("underline"),
            heading2: current.isActive("heading", { level: 2 }),
            heading3: current.isActive("heading", { level: 3 }),
            bulletList: current.isActive("bulletList"),
            orderedList: current.isActive("orderedList"),
            link: current.isActive("link"),
            canUndo: current.can().undo(),
            canRedo: current.can().redo(),
          }
        : {
            bold: false,
            italic: false,
            underline: false,
            heading2: false,
            heading3: false,
            bulletList: false,
            orderedList: false,
            link: false,
            canUndo: false,
            canRedo: false,
          },
  })

  if (!editor) {
    return <div className="rounded-lg border border-slate-200 bg-white px-3 py-3 text-sm text-slate-500">Loading editor…</div>
  }

  const toolbarState = toolbar ?? {
    bold: false,
    italic: false,
    underline: false,
    heading2: false,
    heading3: false,
    bulletList: false,
    orderedList: false,
    link: false,
    canUndo: false,
    canRedo: false,
  }

  function setLink() {
    if (!editor || disabled) return
    const current = (editor.getAttributes("link").href as string | undefined) || ""
    const raw = window.prompt("Link URL (https://… or mailto:…)", current)
    if (raw === null) return
    const value = raw.trim()
    if (!value) {
      editor.chain().focus().extendMarkRange("link").unsetLink().run()
      setLinkError("")
      return
    }
    const href = normalizeSafeHref(value)
    if (!href) {
      setLinkError("Only http(s) and mailto links are allowed.")
      return
    }
    setLinkError("")
    editor.chain().focus().extendMarkRange("link").setLink({ href }).run()
  }

  return (
    <div className={`proposal-rich-editor overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm ${disabled ? "opacity-70" : ""}`}>
      <div className="flex flex-wrap items-center gap-1 border-b border-slate-100 bg-slate-50/80 px-2 py-2" role="toolbar" aria-label={`${ariaLabel} formatting`}>
        <ToolbarButton label="Bold" title="Bold (Ctrl/Cmd+B)" active={toolbarState.bold} disabled={disabled} onClick={() => editor.chain().focus().toggleBold().run()}>
          B
        </ToolbarButton>
        <ToolbarButton label="Italic" title="Italic (Ctrl/Cmd+I)" active={toolbarState.italic} disabled={disabled} onClick={() => editor.chain().focus().toggleItalic().run()}>
          I
        </ToolbarButton>
        <ToolbarButton label="Underline" title="Underline (Ctrl/Cmd+U)" active={toolbarState.underline} disabled={disabled} onClick={() => editor.chain().focus().toggleUnderline().run()}>
          U
        </ToolbarButton>
        <span className="mx-1 h-5 w-px bg-slate-200" aria-hidden />
        <ToolbarButton label="Heading 2" title="Heading" active={toolbarState.heading2} disabled={disabled} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>
          H2
        </ToolbarButton>
        <ToolbarButton label="Heading 3" title="Subheading" active={toolbarState.heading3} disabled={disabled} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}>
          H3
        </ToolbarButton>
        <span className="mx-1 h-5 w-px bg-slate-200" aria-hidden />
        <ToolbarButton label="Bullet list" title="Bullet list" active={toolbarState.bulletList} disabled={disabled} onClick={() => editor.chain().focus().toggleBulletList().run()}>
          • List
        </ToolbarButton>
        <ToolbarButton label="Numbered list" title="Numbered list" active={toolbarState.orderedList} disabled={disabled} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
          1. List
        </ToolbarButton>
        <ToolbarButton label="Link" title="Add or edit link" active={toolbarState.link} disabled={disabled} onClick={setLink}>
          Link
        </ToolbarButton>
        <ToolbarButton
          label="Clear formatting"
          title="Remove formatting"
          disabled={disabled}
          onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()}
        >
          Clear
        </ToolbarButton>
        <span className="mx-1 h-5 w-px bg-slate-200" aria-hidden />
        <ToolbarButton label="Undo" title="Undo (Ctrl/Cmd+Z)" disabled={disabled || !toolbarState.canUndo} onClick={() => editor.chain().focus().undo().run()}>
          Undo
        </ToolbarButton>
        <ToolbarButton label="Redo" title="Redo (Ctrl/Cmd+Shift+Z)" disabled={disabled || !toolbarState.canRedo} onClick={() => editor.chain().focus().redo().run()}>
          Redo
        </ToolbarButton>
        <span className="ml-auto hidden text-[11px] text-slate-500 sm:inline">
          {richTextDocHasText(value) ? "Select text, then format." : "Start typing, then format selected text."}
        </span>
      </div>
      {linkError ? <p className="border-b border-amber-100 bg-amber-50 px-3 py-1.5 text-xs text-amber-900">{linkError}</p> : null}
      <EditorContent editor={editor} className="proposal-rich-editor-content-wrap px-3 py-3" />
    </div>
  )
}
