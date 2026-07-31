import { AdminSubnav } from "@/components/admin/admin-subnav";
import { AdminTournamentEnrollmentsPanel } from "@/components/admin/admin-tournament-enrollments-panel";

export default function AdminEnrollmentsPage() {
  return (
    <div className="space-y-6">
      <AdminSubnav />
      <AdminTournamentEnrollmentsPanel />
    </div>
  );
}
