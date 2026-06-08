"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

import { cn } from "@/lib/utils";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { useAdminVisibility } from "@/components/layout/use-admin-visibility";
import { useDashboardSeasonParam } from "@/lib/dashboard-season";

export function TopNav() {
  const pathname = usePathname();
  const router = useRouter();
  const canViewAdmin = useAdminVisibility();
  const { buildHrefWithSeason } = useDashboardSeasonParam();

  async function handleSignOut() {
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-night/70 backdrop-blur-xl">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
        <Link href="/" className="font-mono text-lg uppercase tracking-[0.3em] text-ink">
          QM Arena
        </Link>
        <nav className="flex items-center gap-3 text-sm text-steel">
          <Link
            href={buildHrefWithSeason("/dashboard")}
            prefetch={false}
            className={cn(
              "app-pill-ghost",
              pathname === "/dashboard" && "app-pill-active font-medium text-ink",
            )}
          >
            Dashboard
          </Link>
          <Link
            href={buildHrefWithSeason("/dashboard/picks")}
            prefetch={false}
            className={cn(
              "app-pill-ghost",
              pathname.startsWith("/dashboard/picks") && "app-pill-active font-medium text-ink",
            )}
          >
            Picks Center
          </Link>
          <Link
            href={buildHrefWithSeason("/dashboard/vip")}
            prefetch={false}
            className={cn(
              "app-pill-ghost",
              pathname.startsWith("/dashboard/vip") && "app-pill-active font-medium text-ink",
            )}
          >
            VIP
          </Link>
          <Link
            href={buildHrefWithSeason("/dashboard/leaderboard")}
            prefetch={false}
            className={cn(
              "app-pill-ghost",
              pathname.startsWith("/dashboard/leaderboard") &&
                "app-pill-active font-medium text-ink",
            )}
          >
            Leaderboard
          </Link>
          <Link
            href={buildHrefWithSeason("/dashboard/settings")}
            prefetch={false}
            className={cn(
              "app-pill-ghost",
              pathname.startsWith("/dashboard/settings") && "app-pill-active font-medium text-ink",
            )}
          >
            Settings
          </Link>
          {canViewAdmin ? (
            <Link
              href={buildHrefWithSeason("/dashboard/admin")}
              prefetch={false}
              className={cn(
                "app-pill-ghost",
                pathname.startsWith("/dashboard/admin") && "app-pill-active font-medium text-ink",
              )}
            >
              Admin
            </Link>
          ) : null}
          <button
            onClick={handleSignOut}
            className="app-pill text-ink hover:text-coral"
          >
            Salir
          </button>
        </nav>
      </div>
    </header>
  );
}
