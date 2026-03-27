import { AdminRulesPanel } from "@/components/admin/admin-rules-panel";
import { AdminSubnav } from "@/components/admin/admin-subnav";

export default function AdminRulesPage() {
  return (
    <div className="space-y-6">
      <AdminSubnav />
      <AdminRulesPanel />
    </div>
  );
}
