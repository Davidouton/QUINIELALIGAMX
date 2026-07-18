import { AdminSubnav } from "@/components/admin/admin-subnav";

export default function DashboardAdminPage() {
  return (
    <div className="space-y-6">
      <section>
        <h1 className="text-xl font-semibold text-ink">Panel de Administracion</h1>
      </section>

      <AdminSubnav />
    </div>
  );
}
