import { Fragment } from "react"
import { parseInlineFormatting } from "@/lib/proposals/inlineFormatting"

export function InlineFormattedText({ text }: { text: string }) {
  return (
    <>
      {parseInlineFormatting(text).map((segment, index) =>
        segment.bold ? (
          <strong key={index}>{segment.text}</strong>
        ) : (
          <Fragment key={index}>{segment.text}</Fragment>
        )
      )}
    </>
  )
}
