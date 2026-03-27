import { AdminOddsPanel } from "@/components/admin/admin-odds-panel";
import { AdminSubnav } from "@/components/admin/admin-subnav";

export default function AdminOddsPage() {
  return (
    <div className="space-y-6">
      <AdminSubnav />
      <AdminOddsPanel />
    </div>
  );
}
