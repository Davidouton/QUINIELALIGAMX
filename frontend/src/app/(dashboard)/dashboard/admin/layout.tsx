"use client";

import type { ReactNode } from "react";

import { useAdminVisibility } from "@/components/layout/use-admin-visibility";

export default function AdminLayout({ children }: Readonly<{ children: ReactNode }>) {
  const canViewAdmin = useAdminVisibility();

  if (!canViewAdmin) {
    return (
      <section>
        <p className="text-sm text-coral">
          Tu usuario no tiene permisos de admin.
        </p>
      </section>
    );
  }

  return children;
}
