import { AdminFinalRankingPanel } from "@/components/admin/admin-final-ranking-panel";
import { AdminSubnav } from "@/components/admin/admin-subnav";
import { AdminVipFinalRankingPanel } from "@/components/admin/admin-vip-final-ranking-panel";

export default function AdminFinalRankingPage() {
  return (
    <div className="space-y-6">
      <AdminSubnav />
      <AdminFinalRankingPanel />
      <AdminVipFinalRankingPanel />
    </div>
  );
}
