import Link from "next/link";
import { AdminPaymentsPanel } from "@/components/admin/admin-payments-panel";
import { AdminSubnav } from "@/components/admin/admin-subnav";

export default function DashboardAdminPaymentsPage() {
  return (
    <div className="space-y-6">
      <AdminSubnav />
      <Link href="/dashboard/admin/payments/apertura-2026-creditos" className="secondary-button inline-flex w-fit">Créditos ficticios · Apertura 2026</Link>
      <AdminPaymentsPanel />
    </div>
  );
}
