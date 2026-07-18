"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

import { useAdminVisibility } from "@/components/layout/use-admin-visibility";
import { backendFetch, CATALOG_CACHE_TTL_MS } from "@/lib/api/backend";
import { resolveSeasonForContext } from "@/lib/dashboard-season";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { getBrowserAccessToken } from "@/lib/supabase/session";
import { useDashboardSeasonParam } from "@/lib/dashboard-season";
import { cn } from "@/lib/utils";
import type { Season } from "@/types/api";

const primaryLinks = [
  { href: "/dashboard/quiniela-plus", label: "Quiniela +", shortLabel: "Q+" },
  { href: "/dashboard/live", label: "Live", shortLabel: "Live" },
  { href: "/dashboard/survivor", label: "Survivor", shortLabel: "Sur" },
  { href: "/dashboard/world-cup", label: "Mundial", shortLabel: "WC" },
  { href: "/dashboard", label: "Dashboard" },
  { href: "/dashboard/vip", label: "VIP" },
  { href: "/dashboard/picks", label: "Picks Center" },
  { href: "/dashboard/leaderboard", label: "Ranking" },
  { href: "/dashboard/settings", label: "Settings" },
];

const competitionHubLinks = [
  { href: "/dashboard/enrollments", label: "Inscripciones", shortLabel: "Alta" },
  { href: "/dashboard/past-seasons", label: "Past Seasons", shortLabel: "Past" },
  { href: "/dashboard/prizes", label: "Premios", shortLabel: "Pre" },
  { href: "/dashboard/hall-of-fame", label: "Salon de la Fama" },
  { href: "/dashboard/rules", label: "Reglamento" },
];

const adminLink = { href: "/dashboard/admin", label: "Admin" };
const mobileHubLink = { href: "/dashboard/enrollments", label: "Hub" };

const primaryMobileLinks = [
  { href: "/dashboard/leaderboard", label: "Ranking" },
  { href: "/dashboard", label: "Inicio" },
  { href: "/dashboard/survivor", label: "Surv" },
  mobileHubLink,
  { href: "/dashboard/vip", label: "VIP" },
  { href: "/dashboard/picks", label: "Picks" },
];

const appVersionLabel = "v 1.07";

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

function isCompetitionHubRoute(pathname: string) {
  return competitionHubLinks.some((link) => link.href === pathname);
}

export function DashboardSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const { buildHrefWithSeason, competitionId, seasonId } = useDashboardSeasonParam();
  const canViewAdmin = useAdminVisibility();
  const [seasons, setSeasons] = useState<Season[]>([]);

  useEffect(() => {
    async function loadSeasons() {
      try {
        const accessToken = await getBrowserAccessToken();
        const rows = await backendFetch<Season[]>("/seasons", accessToken, { cacheTtlMs: CATALOG_CACHE_TTL_MS });
        setSeasons(Array.isArray(rows) ? rows : []);
      } catch {
        setSeasons([]);
      }
    }

    void loadSeasons();
  }, []);

  const activeSeason = useMemo(
    () => resolveSeasonForContext(seasons, seasonId, competitionId),
    [competitionId, seasonId, seasons],
  );
  const visiblePrimaryLinks = primaryLinks;
  const visibleCompetitionHubLinks = competitionHubLinks;
  const visibleMobilePrimaryLinks = primaryMobileLinks;
  const links = canViewAdmin
    ? [adminLink, ...visiblePrimaryLinks, ...visibleCompetitionHubLinks]
    : [...visiblePrimaryLinks, ...visibleCompetitionHubLinks];
  const mobilePrimaryLinksResolved = canViewAdmin ? [adminLink, ...visibleMobilePrimaryLinks] : visibleMobilePrimaryLinks;
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
              {canViewAdmin ? (
                <Link
                  href={buildHrefWithSeason(adminLink.href)}
                  prefetch={false}
                  className={cn(
                    "app-pill px-3 text-center",
                    pathname.startsWith(adminLink.href) && "app-pill-active text-ink",
                  )}
                >
                  Admin
                </Link>
              ) : null}
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
            <div className="mt-4 max-h-[calc(100dvh-12rem)] space-y-3 overflow-y-auto pb-28 pr-1">
              {canViewAdmin ? (
                <Link
                  href={buildHrefWithSeason(adminLink.href)}
                  prefetch={false}
                  onClick={() => setIsMobileMenuOpen(false)}
                  className={cn(
                    "app-pill-active flex h-11 items-center justify-center px-3 text-center",
                    pathname.startsWith(adminLink.href) && "text-ink",
                  )}
                >
                  Admin
                </Link>
              ) : null}
              <div className="grid grid-cols-2 gap-2">
                {visiblePrimaryLinks.map((link) => (
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
              <div className="pt-2">
                <p className="mb-2 px-1 text-[11px] uppercase tracking-[0.28em] text-steel">Hub de Competencia</p>
                <div className="grid grid-cols-2 gap-2">
                  {visibleCompetitionHubLinks.map((link) => (
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
            </div>
          ) : null}
        </div>

        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-night/95 px-3 pb-[calc(env(safe-area-inset-bottom,0px)+0.75rem)] pt-3 backdrop-blur-xl">
          <div className={cn("grid gap-1.5", canViewAdmin ? "grid-cols-8" : "grid-cols-7")}>
            {mobilePrimaryLinksResolved.map((link) => (
              <Link
                key={link.href}
                href={buildHrefWithSeason(link.href)}
                prefetch={false}
                className={cn(
                  "app-pill-ghost h-10 px-1 text-center text-[10px]",
                  ((link.href === mobileHubLink.href && isCompetitionHubRoute(pathname)) ||
                    pathname === link.href ||
                    (link.href === adminLink.href && pathname.startsWith(adminLink.href))) &&
                    "app-pill-active text-ink",
                )}
              >
                {link.label}
              </Link>
            ))}
          </div>
          <div className="mt-3 flex items-center justify-center gap-2 text-[10px] font-medium tracking-[0.16em] text-steel">
            <span>Powered by Outonpro</span>
            <span className="rounded-[10px] border border-white/[0.08] bg-white/[0.05] px-2 py-1 text-[9px] tracking-[0.14em] text-steel">
              {appVersionLabel}
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

          {canViewAdmin ? (
            <Link
              href={buildHrefWithSeason(adminLink.href)}
              prefetch={false}
              aria-label={adminLink.label}
              title={adminLink.label}
              className={cn(
                "mb-3 block rounded-[12px] border border-mint/20 bg-mint/10 py-3 text-sm font-semibold text-mint transition hover:border-mint/40 hover:bg-mint/15",
                "px-4 text-left",
                pathname.startsWith(adminLink.href) && "border-mint/50 bg-mint/15 text-ink",
              )}
            >
              Admin
            </Link>
          ) : null}

          <div className="space-y-3">
            {visiblePrimaryLinks.map((link) => (
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

          <div className="mt-6">
            <p className="mb-3 px-1 text-[11px] uppercase tracking-[0.32em] text-steel">Hub de Competencia</p>
            <div className="space-y-3">
              {visibleCompetitionHubLinks.map((link) => (
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
                {appVersionLabel}
              </span>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}
