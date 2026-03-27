import { AdminMatchdaysPanel } from "@/components/admin/admin-matchdays-panel";
import { AdminSubnav } from "@/components/admin/admin-subnav";

export default function AdminMatchdaysPage() {
  return (
    <div className="space-y-6">
      <AdminSubnav />
      <AdminMatchdaysPanel />
    </div>
  );
}
