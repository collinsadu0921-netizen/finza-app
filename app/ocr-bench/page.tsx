import { notFound } from "next/navigation"
import ReceiptOcrBench from "./bench"

export default function ReceiptOcrBenchPage() {
  if (process.env.NODE_ENV === "production") notFound()
  return <ReceiptOcrBench />
}
