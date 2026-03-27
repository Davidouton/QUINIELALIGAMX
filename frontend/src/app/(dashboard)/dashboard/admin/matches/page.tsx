import { AdminMatchesPanel } from "@/components/admin/admin-matches-panel";
import { AdminSubnav } from "@/components/admin/admin-subnav";

export default function AdminMatchesPage() {
  return (
    <div className="space-y-6">
      <AdminSubnav />
      <AdminMatchesPanel />
    </div>
  );
}
