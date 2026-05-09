import { AdminSubnav } from "@/components/admin/admin-subnav";
import { AdminWorldCupGroupsPanel } from "@/components/admin/admin-world-cup-groups-panel";

export default function DashboardAdminWorldCupGroupsPage() {
  return (
    <div className="space-y-6">
      <section>
        <h1 className="text-xl font-semibold text-ink">Mundial · Grupos</h1>
      </section>

      <AdminSubnav />
      <AdminWorldCupGroupsPanel />
    </div>
  );
}
