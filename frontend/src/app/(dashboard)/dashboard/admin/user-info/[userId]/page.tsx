import { AdminSubnav } from "@/components/admin/admin-subnav";
import { AdminUserDetailPanel } from "@/components/admin/admin-user-detail-panel";

export default async function AdminUserDetailPage({ params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;
  return (
    <div className="space-y-6">
      <AdminSubnav />
      <AdminUserDetailPanel userId={userId} />
    </div>
  );
}
