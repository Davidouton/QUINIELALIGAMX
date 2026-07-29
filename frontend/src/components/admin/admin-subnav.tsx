"use client";

import { usePathname, useRouter } from "next/navigation";

import { ADMIN_LINKS, ADMIN_NAV_GROUPS } from "@/components/admin/admin-links";

export function AdminSubnav() {
  const pathname = usePathname();
  const router = useRouter();
  const currentLink = ADMIN_LINKS.find((link) => pathname === link.href) ?? ADMIN_LINKS[0];
  const currentGroup = ADMIN_NAV_GROUPS.find((group) => group.links.some((link) => link.href === currentLink.href)) ?? ADMIN_NAV_GROUPS[0];

  return (
    <div className="space-y-5">
      <header className="page-header">
        <h1 className="page-title">{currentLink.label}</h1>
      </header>
      <div className="grid max-w-3xl gap-4 sm:grid-cols-2">
        <label className="page-context-label">
          <span>Área administrativa</span>
          <select
            value={currentGroup.id}
            onChange={(event) => {
              const group = ADMIN_NAV_GROUPS.find((row) => row.id === event.target.value);
              if (group) router.push(group.links[0].href);
            }}
            className="page-context-select"
          >
            {ADMIN_NAV_GROUPS.map((group) => <option key={group.id} value={group.id}>{group.label}</option>)}
          </select>
        </label>
        <label className="page-context-label">
          <span>Pantalla</span>
          <select value={currentLink.href} onChange={(event) => router.push(event.target.value)} className="page-context-select">
            {currentGroup.links.map((link) => <option key={link.href} value={link.href}>{link.label}</option>)}
          </select>
        </label>
      </div>
    </div>
  );
}
