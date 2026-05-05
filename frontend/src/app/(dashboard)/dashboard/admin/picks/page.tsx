import { AdminPicksPanel } from "@/components/admin/admin-picks-panel";
import { AdminSubnav } from "@/components/admin/admin-subnav";

export default function AdminPicksPage() {
  return (
    <div className="space-y-6">
      <AdminSubnav />
      <AdminPicksPanel />
    </div>
  );
}
