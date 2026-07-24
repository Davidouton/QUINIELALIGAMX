import { AdminNflSpreadsPanel } from "@/components/admin/admin-nfl-spreads-panel";
import { AdminSubnav } from "@/components/admin/admin-subnav";

export default function AdminNflLinesPage() {
  return (
    <div className="space-y-6">
      <AdminSubnav />
      <AdminNflSpreadsPanel />
    </div>
  );
}
