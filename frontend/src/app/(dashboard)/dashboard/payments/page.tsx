import Link from "next/link";
import { PaymentsPageContent } from "@/components/payments/payments-page-content";

export default function DashboardPaymentsPage() {
  return (
    <div className="space-y-6">
      <Link href="/dashboard/payments/apertura-2026-creditos" className="secondary-button inline-flex w-fit">Créditos ficticios · Apertura 2026</Link>
      <PaymentsPageContent />
    </div>
  );
}
