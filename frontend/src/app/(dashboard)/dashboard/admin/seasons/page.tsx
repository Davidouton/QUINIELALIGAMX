import { AdminSeasonsPanel } from "@/components/admin/admin-seasons-panel";
import { AdminSubnav } from "@/components/admin/admin-subnav";

export default function AdminSeasonsPage() {
  return (
    <div className="space-y-6">
      <AdminSubnav />
      <AdminSeasonsPanel />
    </div>
  );
}
