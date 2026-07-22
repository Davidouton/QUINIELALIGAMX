import { AdminPaymentsPanel } from "@/components/admin/admin-payments-panel";
import { AdminSubnav } from "@/components/admin/admin-subnav";

export default function DashboardAdminPaymentsPage() {
  return (
    <div className="space-y-6">
      <AdminSubnav />
      <AdminPaymentsPanel />
    </div>
  );
}
