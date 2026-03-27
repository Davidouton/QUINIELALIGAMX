import { AdminSubnav } from "@/components/admin/admin-subnav";
import { AdminUserInfoPanel } from "@/components/admin/admin-user-info-panel";

export default function AdminUserInfoPage() {
  return (
    <div className="space-y-6">
      <AdminSubnav />
      <AdminUserInfoPanel />
    </div>
  );
}
