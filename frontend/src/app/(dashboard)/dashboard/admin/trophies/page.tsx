import { AdminSubnav } from "@/components/admin/admin-subnav";
import { AdminTrophiesPanel } from "@/components/admin/admin-trophies-panel";

export default function DashboardAdminTrophiesPage() {
  return (
    <div className="space-y-6">
      <AdminSubnav />
      <AdminTrophiesPanel />
    </div>
  );
}
