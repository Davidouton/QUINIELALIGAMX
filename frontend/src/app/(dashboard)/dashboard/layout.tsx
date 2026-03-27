import type { ReactNode } from "react";
import { redirect } from "next/navigation";

import { DashboardThemeBridge } from "@/components/layout/dashboard-theme-bridge";
import { DashboardSidebar } from "@/components/layout/dashboard-sidebar";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function DashboardLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    redirect("/login");
  }

  return (
    <div className="min-h-screen">
      <DashboardThemeBridge />
      <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 pb-28 pt-4 sm:px-6 sm:py-8 lg:flex-row lg:pb-8">
        <DashboardSidebar />
        <main className="min-w-0 flex-1 space-y-6">{children}</main>
      </div>
    </div>
  );
}
