import { AdminLiveScorePanel } from "@/components/admin/admin-live-score-panel";
import { AdminSubnav } from "@/components/admin/admin-subnav";

export default function AdminLiveScorePage() {
  return <div className="space-y-6"><AdminSubnav /><AdminLiveScorePanel /></div>;
}
