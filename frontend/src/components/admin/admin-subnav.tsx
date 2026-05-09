"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

const links = [
  { href: "/dashboard/admin", label: "Resumen" },
  { href: "/dashboard/admin/settings", label: "Configuracion" },
  { href: "/dashboard/admin/competitions", label: "Competencias" },
  { href: "/dashboard/admin/world-cup-groups", label: "WC Grupos" },
  { href: "/dashboard/admin/world-cup-bracket", label: "WC Bracket" },
  { href: "/dashboard/admin/quiniela-plus", label: "Quiniela +" },
  { href: "/dashboard/admin/prizes", label: "Premios" },
  { href: "/dashboard/admin/users", label: "Usuarios" },
  { href: "/dashboard/admin/picks", label: "Picks" },
  { href: "/dashboard/admin/vip", label: "VIP" },
  { href: "/dashboard/admin/user-info", label: "Info usuarios" },
  { href: "/dashboard/admin/seasons", label: "Temporadas" },
  { href: "/dashboard/admin/matchdays", label: "Jornadas" },
  { href: "/dashboard/admin/odds", label: "Probabilidades" },
  { href: "/dashboard/admin/matches", label: "Partidos" },
  { href: "/dashboard/admin/results", label: "Resultados" },
  { href: "/dashboard/admin/hall-of-fame", label: "Salon de la Fama" },
  { href: "/dashboard/admin/trophies", label: "Trofeos" },
  { href: "/dashboard/admin/rules", label: "Editar regl." },
  { href: "/dashboard/admin/teams", label: "Equipos" },
];

export function AdminSubnav() {
  const pathname = usePathname();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const currentLink = links.find((link) => pathname === link.href) ?? links[0];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 md:hidden">
        <p className="text-sm font-semibold uppercase tracking-[0.22em] text-steel">{currentLink.label}</p>
        <button
          type="button"
          onClick={() => setIsMenuOpen((current) => !current)}
          className="app-pill px-3 uppercase tracking-[0.18em] text-steel hover:text-ink"
        >
          {isMenuOpen ? "Cerrar" : "Menu"}
        </button>
      </div>

      <div className="hidden flex-wrap gap-2 md:flex">
        {links.map((link) => {
          const isActive = pathname === link.href;
          return (
            <Link
              key={link.href}
              href={link.href}
              prefetch={false}
              className={cn(
                "app-pill-ghost px-3 uppercase tracking-[0.18em]",
                isActive && "app-pill-active text-ink",
              )}
            >
              {link.label}
            </Link>
          );
        })}
      </div>

      {isMenuOpen ? (
        <div className="grid grid-cols-2 gap-2 md:hidden">
          {links.map((link) => {
            const isActive = pathname === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                prefetch={false}
                onClick={() => setIsMenuOpen(false)}
                className={cn(
                  "app-pill-ghost h-10 px-3 text-center uppercase tracking-[0.16em]",
                  isActive && "app-pill-active text-ink",
                )}
              >
                {link.label}
              </Link>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
