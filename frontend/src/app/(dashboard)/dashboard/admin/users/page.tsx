import { AdminSubnav } from "@/components/admin/admin-subnav";
import { AdminUsersPanel } from "@/components/admin/admin-users-panel";

export default function AdminUsersPage() {
  return (
    <div className="space-y-6">
      <AdminSubnav />
      <AdminUsersPanel />
    </div>
  );
}
