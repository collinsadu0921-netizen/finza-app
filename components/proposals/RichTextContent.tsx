"use client"

import type { ReactNode } from "react"
import type {
  ProposalRichTextDoc,
  RichTextBlock,
  RichTextMark,
  RichTextRun,
} from "@/lib/proposals/richText"

function markKey(mark: RichTextMark, index: number): string {
  return mark.type === "link" ? `link-${index}-${mark.href}` : `${mark.type}-${index}`
}

function applyMarks(value: ReactNode, marks: RichTextMark[] | undefined): ReactNode {
  let node = value
  for (const [index, mark] of (marks ?? []).entries()) {
    if (mark.type === "bold") node = <strong key={markKey(mark, index)}>{node}</strong>
    else if (mark.type === "italic") node = <em key={markKey(mark, index)}>{node}</em>
    else if (mark.type === "underline") node = <u key={markKey(mark, index)}>{node}</u>
    else if (mark.type === "link") {
      node = (
        <a
          key={markKey(mark, index)}
          href={mark.href}
          target="_blank"
          rel="noopener noreferrer nofollow"
        >
          {node}
        </a>
      )
    }
  }
  return node
}

function runsHtml(runs: RichTextRun[], keyPrefix: string): ReactNode[] {
  return runs.map((run, index) => {
    const key = `${keyPrefix}-${index}`
    if (run.type === "break") return <br key={key} />
    return <span key={key}>{applyMarks(run.text, run.marks)}</span>
  })
}

function blockHtml(block: RichTextBlock, index: number): ReactNode {
  const key = `rich-block-${index}`
  if (block.type === "paragraph") {
    return (
      <p key={key} className="proposal-body-text">
        {runsHtml(block.runs, key)}
      </p>
    )
  }
  if (block.type === "heading") {
    const Tag = block.level === 3 ? "h4" : "h3"
    return (
      <Tag key={key} className={`proposal-section-heading proposal-rich-heading proposal-rich-heading--${block.level}`}>
        {runsHtml(block.runs, key)}
      </Tag>
    )
  }
  const Tag = block.type === "ordered_list" ? "ol" : "ul"
  return (
    <Tag
      key={key}
      className={
        block.type === "ordered_list"
          ? "proposal-bullet-list proposal-rich-list proposal-rich-list--ordered"
          : "proposal-bullet-list proposal-rich-list"
      }
    >
      {block.items.map((item, itemIndex) => (
        <li key={`${key}-item-${itemIndex}`}>{runsHtml(item, `${key}-item-${itemIndex}`)}</li>
      ))}
    </Tag>
  )
}

export function RichTextContent({
  doc,
  className,
}: {
  doc: ProposalRichTextDoc
  className?: string
}) {
  if (!doc || doc.blocks.length === 0) return null
  return <div className={`proposal-rich-text${className ? ` ${className}` : ""}`}>{doc.blocks.map(blockHtml)}</div>
}
