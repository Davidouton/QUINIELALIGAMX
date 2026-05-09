import { AdminQuinielaPlusPanel } from "@/components/admin/admin-quiniela-plus-panel";
import { AdminSubnav } from "@/components/admin/admin-subnav";

export default function AdminQuinielaPlusPage() {
  return (
    <div className="space-y-6">
      <AdminSubnav />
      <AdminQuinielaPlusPanel />
    </div>
  );
}
