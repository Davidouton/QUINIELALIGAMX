import { AdminSubnav } from "@/components/admin/admin-subnav";
import { AdminVipPanel } from "@/components/admin/admin-vip-panel";

export default function AdminVipPage() {
  return (
    <div className="space-y-6">
      <AdminSubnav />
      <AdminVipPanel />
    </div>
  );
}
