import Link from "next/link";

import { ADMIN_LINKS } from "@/components/admin/admin-links";
import { AdminSubnav } from "@/components/admin/admin-subnav";

const groups = [
  {
    title: "Operación",
    paths: ["competitions", "seasons", "matchdays", "matches", "results", "live-score", "teams"],
  },
  {
    title: "Usuarios y juego",
    paths: ["users", "user-info", "final-ranking", "payments", "picks", "survivor", "vip", "prizes", "trophies"],
  },
  {
    title: "Estructuras y producto",
    paths: ["world-cup-groups", "world-cup-bracket", "quiniela-plus", "odds", "hall-of-fame"],
  },
  {
    title: "Sistema",
    paths: ["settings", "rules", "stats"],
  },
];

function linkSlug(href: string) {
  return href.split("/").filter(Boolean).at(-1) ?? "";
}

export default function DashboardAdminPage() {
  return (
    <div className="space-y-6">
      <AdminSubnav />

      <div className="space-y-10 pt-4">
        {groups.map((group) => {
          const links = group.paths
            .map((path) => ADMIN_LINKS.find((link) => linkSlug(link.href) === path))
            .filter((link): link is (typeof ADMIN_LINKS)[number] => Boolean(link));

          return (
            <section key={group.title}>
              <h2 className="text-sm font-semibold uppercase tracking-[0.22em] text-steel">{group.title}</h2>
              <div className="mt-5 grid border-l border-t border-white/10 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {links.map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    prefetch={false}
                    className="flex min-h-20 items-center border-b border-r border-white/10 px-5 py-4 text-sm font-semibold text-ink transition hover:border-[#4f7df3]/50 hover:text-[#4f7df3]"
                  >
                    {link.label}
                  </Link>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
