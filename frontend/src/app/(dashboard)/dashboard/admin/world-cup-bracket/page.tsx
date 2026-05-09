import { AdminSubnav } from "@/components/admin/admin-subnav";
import { AdminWorldCupBracketPanel } from "@/components/admin/admin-world-cup-bracket-panel";

export default function DashboardAdminWorldCupBracketPage() {
  return (
    <div className="space-y-6">
      <section>
        <h1 className="text-xl font-semibold text-ink">Mundial · Bracket</h1>
      </section>

      <AdminSubnav />
      <AdminWorldCupBracketPanel />
    </div>
  );
}
