import ProtectedLayout from "@/components/ProtectedLayout"

export default function HelpLayout({ children }: { children: React.ReactNode }) {
  return <ProtectedLayout>{children}</ProtectedLayout>
}
