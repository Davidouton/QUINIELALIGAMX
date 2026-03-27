import { AdminResultsPanel } from "@/components/admin/admin-results-panel";
import { AdminSubnav } from "@/components/admin/admin-subnav";

export default function AdminResultsPage() {
  return (
    <div className="space-y-6">
      <AdminSubnav />
      <AdminResultsPanel />
    </div>
  );
}
