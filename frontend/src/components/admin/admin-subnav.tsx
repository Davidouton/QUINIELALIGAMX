"use client";

import { usePathname, useRouter } from "next/navigation";

import { ADMIN_LINKS } from "@/components/admin/admin-links";

export function AdminSubnav() {
  const pathname = usePathname();
  const router = useRouter();
  const currentLink = ADMIN_LINKS.find((link) => pathname === link.href) ?? ADMIN_LINKS[0];

  return (
    <div className="space-y-5">
      <header className="page-header">
        <h1 className="page-title">{currentLink.label}</h1>
      </header>
      <label className="page-context-label max-w-md">
        <span>Sección administrativa</span>
        <select
          value={currentLink.href}
          onChange={(event) => router.push(event.target.value)}
          className="page-context-select"
        >
          {ADMIN_LINKS.map((link) => (
            <option key={link.href} value={link.href}>{link.label}</option>
          ))}
        </select>
      </label>
    </div>
  );
}
