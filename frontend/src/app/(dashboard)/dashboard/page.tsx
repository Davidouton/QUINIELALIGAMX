import { DashboardHome } from "@/components/dashboard/dashboard-home";
import { DashboardRuntimeBoundary } from "@/components/dashboard/dashboard-runtime-boundary";

export default function DashboardPage() {
  return (
    <DashboardRuntimeBoundary title="Dashboard">
      <DashboardHome />
    </DashboardRuntimeBoundary>
  );
}
