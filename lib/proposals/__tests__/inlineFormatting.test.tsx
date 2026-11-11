import { describe, expect, it } from "@jest/globals"
import { renderToStaticMarkup } from "react-dom/server"
import {
  inlineFormattingToHtml,
  parseInlineFormatting,
  toggleBoldSelection,
} from "../inlineFormatting"
import { InlineFormattedText } from "@/components/proposals/InlineFormattedText"

describe("proposal inline bold formatting", () => {
  it("parses bold segments and leaves unmatched markers literal", () => {
    expect(parseInlineFormatting("A **bold** word")).toEqual([
      { text: "A ", bold: false },
      { text: "bold", bold: true },
      { text: " word", bold: false },
    ])
    expect(parseInlineFormatting("**first** and **second**")).toEqual([
      { text: "first", bold: true },
      { text: " and ", bold: false },
      { text: "second", bold: true },
    ])
    expect(parseInlineFormatting("**unclosed")).toEqual([{ text: "**unclosed", bold: false }])
    expect(parseInlineFormatting("")).toEqual([])
  })

  it("escapes HTML before promoting paired markers", () => {
    expect(inlineFormattingToHtml("**<script>alert('x')</script>**")).toBe(
      "<strong>&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt;</strong>"
    )
    expect(inlineFormattingToHtml("safe & sound")).toBe("safe &amp; sound")
  })

  it("renders bold spans in React without injecting HTML", () => {
    const html = renderToStaticMarkup(
      <p>
        <InlineFormattedText text={"A **bold** and <script>alert(1)</script> word"} />
      </p>
    )
    expect(html).toContain("<strong>bold</strong>")
    expect(html).toContain("&lt;script&gt;")
    expect(html).not.toContain("<script>")
  })

  it("wraps and unwraps a precise selection", () => {
    expect(toggleBoldSelection("Hello world", 0, 5)).toEqual({
      value: "**Hello** world",
      selectionStart: 2,
      selectionEnd: 7,
    })
    expect(toggleBoldSelection("**Hello** world", 2, 7)).toEqual({
      value: "Hello world",
      selectionStart: 0,
      selectionEnd: 5,
    })
    expect(toggleBoldSelection("Hello **world**", 8, 13)).toEqual({
      value: "Hello world",
      selectionStart: 6,
      selectionEnd: 11,
    })
  })

  it("inserts an empty bold marker pair for a collapsed cursor", () => {
    expect(toggleBoldSelection("Hello", 5, 5)).toEqual({
      value: "Hello****",
      selectionStart: 7,
      selectionEnd: 7,
    })
  })

  it("formats each selected bullet line independently", () => {
    const result = toggleBoldSelection("First\nSecond\nThird", 0, 18, { perLine: true })
    expect(result.value).toBe("**First**\n**Second**\n**Third**")
    expect(result.selectionStart).toBe(0)
    expect(result.selectionEnd).toBe(result.value.length)

    const unwrapped = toggleBoldSelection(result.value, result.selectionStart, result.selectionEnd, {
      perLine: true,
    })
    expect(unwrapped.value).toBe("First\nSecond\nThird")
  })
})
