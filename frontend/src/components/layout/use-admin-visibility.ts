"use client";

import { useEffect, useState } from "react";

import { backendFetch } from "@/lib/api/backend";
import { NO_ACTIVE_SESSION_MESSAGE, getBrowserAccessToken } from "@/lib/supabase/session";
import type { Me } from "@/types/api";

const ADMIN_VISIBILITY_STORAGE_KEY = "qm-admin-visible";
let cachedAdminVisibility: boolean | null = null;
let pendingAdminVisibility: Promise<boolean> | null = null;

function isAdminRole(roleCode: string | null | undefined) {
  return roleCode === "admin" || roleCode === "master_admin";
}

function readCachedAdminVisibility() {
  if (cachedAdminVisibility !== null) {
    return cachedAdminVisibility;
  }
  if (typeof window === "undefined") {
    return false;
  }
  cachedAdminVisibility = window.sessionStorage.getItem(ADMIN_VISIBILITY_STORAGE_KEY) === "true";
  return cachedAdminVisibility;
}

function writeCachedAdminVisibility(value: boolean) {
  cachedAdminVisibility = value;
  if (typeof window !== "undefined") {
    window.sessionStorage.setItem(ADMIN_VISIBILITY_STORAGE_KEY, value ? "true" : "false");
  }
}

async function fetchAdminVisibility() {
  if (pendingAdminVisibility) {
    return pendingAdminVisibility;
  }

  pendingAdminVisibility = (async () => {
    const accessToken = await getBrowserAccessToken();
    const me = await backendFetch<Me>("/me", accessToken);
    const nextValue = isAdminRole(me.role_code);
    writeCachedAdminVisibility(nextValue);
    return nextValue;
  })();

  try {
    return await pendingAdminVisibility;
  } finally {
    pendingAdminVisibility = null;
  }
}

export function useAdminVisibility() {
  const [canViewAdmin, setCanViewAdmin] = useState(readCachedAdminVisibility);

  useEffect(() => {
    let isCancelled = false;

    async function loadRole() {
      try {
        const nextValue = await fetchAdminVisibility();
        if (!isCancelled) {
          setCanViewAdmin(nextValue);
        }
      } catch (error) {
        if (isCancelled) {
          return;
        }

        if (error instanceof Error && error.message === NO_ACTIVE_SESSION_MESSAGE) {
          writeCachedAdminVisibility(false);
          setCanViewAdmin(false);
          return;
        }
      }
    }

    void loadRole();

    return () => {
      isCancelled = true;
    };
  }, []);

  return canViewAdmin;
}
