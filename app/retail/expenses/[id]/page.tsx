import RetailExpenseDetailPage from "@/components/retail/expenses/RetailExpenseDetailPage"

export default async function RetailExpenseDetailRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <RetailExpenseDetailPage expenseId={id} />
}
