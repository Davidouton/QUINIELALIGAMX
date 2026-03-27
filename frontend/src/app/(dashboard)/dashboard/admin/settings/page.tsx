import { AdminSettingsPanel } from "@/components/admin/admin-settings-panel";
import { AdminSubnav } from "@/components/admin/admin-subnav";

export default function AdminSettingsPage() {
  return (
    <div className="space-y-6">
      <AdminSubnav />
      <AdminSettingsPanel />
    </div>
  );
}
