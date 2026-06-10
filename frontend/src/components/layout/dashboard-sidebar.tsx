"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

import { DashboardSeasonSwitcher } from "@/components/layout/dashboard-season-switcher";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { useDashboardSeasonParam } from "@/lib/dashboard-season";
import { cn } from "@/lib/utils";
import { useAdminVisibility } from "@/components/layout/use-admin-visibility";

const baseLinks = [
  { href: "/dashboard/world-cup", label: "Mundial", shortLabel: "WC" },
];

const primaryMobileLinks = [
  { href: "/dashboard/world-cup", label: "WC" },
];

function renderLinkLabel(label: string) {
  if (label !== "Quiniela +") {
    return label;
  }

  return (
    <>
      Quiniela <span className="font-bold text-ink">+</span>
    </>
  );
}

export function DashboardSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const canViewAdmin = useAdminVisibility();
  const { buildHrefWithSeason } = useDashboardSeasonParam();
  const links = [
    ...baseLinks,
    ...(canViewAdmin ? [{ href: "/dashboard/admin", label: "Admin" }] : []),
  ];
  const currentLink = links.find((link) => pathname === link.href) ?? links[0];

  async function handleSignOut() {
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <>
      <div className="lg:hidden">
        <div className="sticky top-3 z-30 px-1 py-2">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] uppercase tracking-[0.28em] text-steel">Panel</p>
              <p className="mt-1 truncate text-base font-semibold text-ink">{renderLinkLabel(currentLink.label)}</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setIsMobileMenuOpen((current) => !current)}
                className="app-pill px-3"
              >
                {isMobileMenuOpen ? "Cerrar" : "Menu"}
              </button>
              <button
                type="button"
                onClick={handleSignOut}
                className="app-pill px-3 hover:text-coral"
              >
                Salir
              </button>
            </div>
          </div>

          {isMobileMenuOpen ? (
            <div className="mt-4 space-y-3">
              <DashboardSeasonSwitcher />
              <div className="grid grid-cols-2 gap-2">
                {links.map((link) => (
                  <Link
                    key={link.href}
                    href={buildHrefWithSeason(link.href)}
                    prefetch={false}
                    onClick={() => setIsMobileMenuOpen(false)}
                    className={cn(
                      "app-pill-ghost h-10 px-3 text-center",
                      pathname === link.href && "app-pill-active text-ink",
                    )}
                  >
                    {renderLinkLabel(link.label)}
                  </Link>
                ))}
              </div>
            </div>
          ) : null}
        </div>

        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-night/95 px-3 pb-[calc(env(safe-area-inset-bottom,0px)+0.75rem)] pt-3 backdrop-blur-xl">
          <div className="grid grid-cols-1 gap-2">
            {primaryMobileLinks.map((link) => (
              <Link
                key={link.href}
                href={buildHrefWithSeason(link.href)}
                prefetch={false}
                className={cn(
                  "app-pill-ghost h-10 px-2 text-center text-[11px]",
                  pathname === link.href && "app-pill-active text-ink",
                )}
              >
                {link.label}
              </Link>
            ))}
          </div>
          <div className="mt-3 flex items-center justify-center gap-2 text-[10px] font-medium tracking-[0.16em] text-steel">
            <span>Powered by Outonpro</span>
              <span className="rounded-[10px] border border-white/[0.08] bg-white/[0.05] px-2 py-1 text-[9px] tracking-[0.14em] text-steel">
              Beta 1.3
            </span>
          </div>
        </div>
      </div>

      <aside
        className="sticky top-6 hidden h-[calc(100vh-3rem)] w-[280px] shrink-0 overflow-visible text-ink lg:block"
      >
        <div className="flex h-full w-[280px] flex-col px-4 py-5">
          <div className="mb-5 flex items-center justify-between gap-3">
            <p className="text-xs uppercase tracking-[0.35em] text-steel">Panel</p>
          </div>

          <div className="mb-5">
            <DashboardSeasonSwitcher />
          </div>

          <div className="space-y-3">
            {links.map((link) => (
              <Link
                key={link.href}
                href={buildHrefWithSeason(link.href)}
                prefetch={false}
                aria-label={link.label}
                title={link.label}
                className={cn(
                  "block rounded-[12px] border border-white/[0.04] bg-transparent py-3 text-sm transition hover:border-white/[0.08] hover:bg-white/[0.04]",
                  "px-4 text-left",
                  pathname === link.href && "border-white/[0.06] bg-white/[0.05]",
                )}
              >
                {renderLinkLabel(link.label)}
              </Link>
            ))}
          </div>

          <div className="mt-6 pt-2">
            <button
              type="button"
              onClick={handleSignOut}
              className={cn(
                "block w-full rounded-[12px] border border-white/[0.04] bg-white/[0.02] py-3 text-sm font-semibold text-ink transition hover:border-white/[0.08] hover:text-coral",
                "px-4 text-left",
              )}
            >
              Salir
            </button>
          </div>

          <div className="mt-auto px-1 pt-6">
            <div className="flex items-center gap-2 text-left text-[10px] font-medium tracking-[0.16em] text-steel">
              <span>Powered by Outonpro</span>
              <span className="rounded-[10px] border border-white/[0.08] bg-white/[0.05] px-2 py-1 text-[9px] tracking-[0.14em] text-steel">
                Beta 1.3
              </span>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}
