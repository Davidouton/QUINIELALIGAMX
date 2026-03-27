import { AdminSubnav } from "@/components/admin/admin-subnav";
import { AdminTeamsPanel } from "@/components/admin/admin-teams-panel";

export default function AdminTeamsPage() {
  return (
    <div className="space-y-6">
      <AdminSubnav />
      <AdminTeamsPanel />
    </div>
  );
}
