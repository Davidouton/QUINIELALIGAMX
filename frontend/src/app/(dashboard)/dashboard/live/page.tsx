import { DashboardRuntimeBoundary } from "@/components/dashboard/dashboard-runtime-boundary";
import { LivePageContent } from "@/components/live/live-page-content";

export default function DashboardLivePage() {
  return (
    <DashboardRuntimeBoundary title="Live">
      <LivePageContent />
    </DashboardRuntimeBoundary>
  );
}
