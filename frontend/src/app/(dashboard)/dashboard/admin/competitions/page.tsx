import { AdminCompetitionsPanel } from "@/components/admin/admin-competitions-panel";
import { AdminSubnav } from "@/components/admin/admin-subnav";

export default function DashboardAdminCompetitionsPage() {
  return (
    <div className="space-y-6">
      <AdminSubnav />
      <AdminCompetitionsPanel />
    </div>
  );
}
