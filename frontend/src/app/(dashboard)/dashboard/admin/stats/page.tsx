import { AdminStatsPanel } from "@/components/admin/admin-stats-panel";
import { AdminSubnav } from "@/components/admin/admin-subnav";

export default function AdminStatsPage() {
  return (
    <div className="space-y-6">
      <AdminSubnav />
      <AdminStatsPanel />
    </div>
  );
}
