import { AdminCompetitionsPanel } from "@/components/admin/admin-competitions-panel";
import { AdminSubnav } from "@/components/admin/admin-subnav";

export default function DashboardAdminCompetitionsPage() {
  return (
    <div className="space-y-6">
      <section>
        <h1 className="text-xl font-semibold text-ink">Competencias</h1>
      </section>

      <AdminSubnav />
      <AdminCompetitionsPanel />
    </div>
  );
}
