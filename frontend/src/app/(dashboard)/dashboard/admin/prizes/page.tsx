import { AdminPrizesPanel } from "@/components/admin/admin-prizes-panel";
import { AdminSubnav } from "@/components/admin/admin-subnav";

export default function AdminPrizesPage() {
  return (
    <div className="space-y-6">
      <AdminSubnav />
      <AdminPrizesPanel />
    </div>
  );
}
