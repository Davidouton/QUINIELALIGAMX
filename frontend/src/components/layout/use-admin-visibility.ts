"use client";

import { useEffect, useState } from "react";

import { backendFetch } from "@/lib/api/backend";
import { NO_ACTIVE_SESSION_MESSAGE, getBrowserAccessToken } from "@/lib/supabase/session";
import type { Me } from "@/types/api";

const ADMIN_VISIBILITY_STORAGE_KEY = "qm-admin-visible";
const ADMIN_VISIBILITY_RETRY_COUNT = 8;
const ADMIN_VISIBILITY_RETRY_DELAY_MS = 400;
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
  cachedAdminVisibility = window.localStorage.getItem(ADMIN_VISIBILITY_STORAGE_KEY) === "true";
  return cachedAdminVisibility;
}

function writeCachedAdminVisibility(value: boolean) {
  cachedAdminVisibility = value;
  if (typeof window !== "undefined") {
    if (value) {
      window.localStorage.setItem(ADMIN_VISIBILITY_STORAGE_KEY, "true");
    } else {
      window.localStorage.removeItem(ADMIN_VISIBILITY_STORAGE_KEY);
    }
  }
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function fetchAdminVisibility() {
  if (pendingAdminVisibility) {
    return pendingAdminVisibility;
  }

  pendingAdminVisibility = (async () => {
    for (let attempt = 1; attempt <= ADMIN_VISIBILITY_RETRY_COUNT; attempt += 1) {
      try {
        const accessToken = await getBrowserAccessToken();
        const me = await backendFetch<Me>("/me", accessToken);
        const nextValue = isAdminRole(me.role_code);
        writeCachedAdminVisibility(nextValue);
        return nextValue;
      } catch (error) {
        if (
          error instanceof Error &&
          error.message === NO_ACTIVE_SESSION_MESSAGE &&
          attempt < ADMIN_VISIBILITY_RETRY_COUNT
        ) {
          await wait(ADMIN_VISIBILITY_RETRY_DELAY_MS);
          continue;
        }
        throw error;
      }
    }
    return readCachedAdminVisibility();
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
          setCanViewAdmin(readCachedAdminVisibility());
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
