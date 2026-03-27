"use client";

import { useEffect, useState } from "react";

import { backendFetch } from "@/lib/api/backend";
import { NO_ACTIVE_SESSION_MESSAGE, getBrowserAccessToken } from "@/lib/supabase/session";
import type { Me } from "@/types/api";

function isAdminRole(roleCode: string | null | undefined) {
  return roleCode === "admin" || roleCode === "master_admin";
}

export function useAdminVisibility() {
  const [canViewAdmin, setCanViewAdmin] = useState(false);

  useEffect(() => {
    let isCancelled = false;

    async function loadRole() {
      try {
        const accessToken = await getBrowserAccessToken();
        const me = await backendFetch<Me>("/me", accessToken);

        if (!isCancelled) {
          setCanViewAdmin(isAdminRole(me.role_code));
        }
      } catch (error) {
        if (isCancelled) {
          return;
        }

        if (error instanceof Error && error.message === NO_ACTIVE_SESSION_MESSAGE) {
          setCanViewAdmin(false);
          return;
        }

        setCanViewAdmin(false);
      }
    }

    void loadRole();

    return () => {
      isCancelled = true;
    };
  }, []);

  return canViewAdmin;
}
