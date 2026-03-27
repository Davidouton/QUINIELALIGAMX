import { AdminSubnav } from "@/components/admin/admin-subnav";
import { AdminHallOfFamePanel } from "@/components/admin/admin-hall-of-fame-panel";

export default function DashboardAdminHallOfFamePage() {
  return (
    <div className="space-y-6">
      <AdminSubnav />
      <AdminHallOfFamePanel />
    </div>
  );
}
