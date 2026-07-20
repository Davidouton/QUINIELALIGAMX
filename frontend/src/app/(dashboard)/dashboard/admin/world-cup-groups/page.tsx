import { AdminSubnav } from "@/components/admin/admin-subnav";
import { AdminWorldCupGroupsPanel } from "@/components/admin/admin-world-cup-groups-panel";

export default function DashboardAdminWorldCupGroupsPage() {
  return (
    <div className="space-y-6">
      <AdminSubnav />
      <AdminWorldCupGroupsPanel />
    </div>
  );
}
