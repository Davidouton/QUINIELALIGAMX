"use client";

import { useEffect, useState } from "react";

import { backendFetch } from "@/lib/api/backend";
import {
  NO_ACTIVE_SESSION_MESSAGE,
  getBrowserAccessToken,
  getStoredAccessToken,
} from "@/lib/supabase/session";
import type { Me } from "@/types/api";

const ADMIN_VISIBILITY_STORAGE_PREFIX = "qm-admin-visible:";
const ADMIN_VISIBILITY_RETRY_COUNT = 8;
const ADMIN_VISIBILITY_RETRY_DELAY_MS = 400;
let cachedAdminVisibility: boolean | null = null;
let cachedAdminVisibilityProfileId: string | null = null;
let pendingAdminVisibility: Promise<boolean> | null = null;

function isAdminRole(roleCode: string | null | undefined) {
  return roleCode === "admin" || roleCode === "master_admin";
}

function decodeJwtSubject(token: string | null) {
  if (!token) {
    return null;
  }

  try {
    const payload = token.split(".")[1];
    if (!payload) {
      return null;
    }

    const normalizedPayload = payload.replace(/-/g, "+").replace(/_/g, "/");
    const paddedPayload = normalizedPayload.padEnd(
      normalizedPayload.length + ((4 - (normalizedPayload.length % 4)) % 4),
      "=",
    );
    const parsed = JSON.parse(window.atob(paddedPayload)) as { sub?: string };
    return parsed.sub ?? null;
  } catch {
    return null;
  }
}

function storageKeyForProfile(profileId: string | null | undefined) {
  return profileId ? `${ADMIN_VISIBILITY_STORAGE_PREFIX}${profileId}` : null;
}

function readCachedAdminVisibility() {
  const currentProfileId = typeof window === "undefined" ? null : decodeJwtSubject(getStoredAccessToken());
  if (cachedAdminVisibility !== null && cachedAdminVisibilityProfileId === currentProfileId) {
    return cachedAdminVisibility;
  }
  if (typeof window === "undefined") {
    return false;
  }
  const storageKey = storageKeyForProfile(currentProfileId);
  cachedAdminVisibilityProfileId = currentProfileId;
  cachedAdminVisibility = storageKey ? window.localStorage.getItem(storageKey) === "true" : false;
  return cachedAdminVisibility;
}

function writeCachedAdminVisibility(value: boolean, profileId: string | null | undefined) {
  cachedAdminVisibility = value;
  cachedAdminVisibilityProfileId = profileId ?? null;
  if (typeof window !== "undefined") {
    const storageKey = storageKeyForProfile(profileId);
    if (!storageKey) {
      return;
    }
    if (value) {
      window.localStorage.setItem(storageKey, "true");
    } else {
      window.localStorage.removeItem(storageKey);
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
        writeCachedAdminVisibility(nextValue, me.id);
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
