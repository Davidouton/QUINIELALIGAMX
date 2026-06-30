"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

const IDLE_TIMEOUT_MS = 5 * 60 * 1000;
const ACTIVITY_THROTTLE_MS = 1000;
const LAST_ACTIVITY_STORAGE_KEY = "dashboard-last-activity-at";

function readLastActivity() {
  if (typeof window === "undefined") {
    return Date.now();
  }

  const rawValue = window.localStorage.getItem(LAST_ACTIVITY_STORAGE_KEY);
  const parsedValue = Number(rawValue);
  return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : Date.now();
}

function persistLastActivity(timestamp: number) {
  window.localStorage.setItem(LAST_ACTIVITY_STORAGE_KEY, String(timestamp));
}

export function DashboardIdleSessionGuard() {
  const router = useRouter();
  const timeoutRef = useRef<number | null>(null);
  const isSigningOutRef = useRef(false);
  const lastLocalActivityRef = useRef(0);

  useEffect(() => {
    function clearIdleTimeout() {
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    }

    async function signOutForInactivity() {
      if (isSigningOutRef.current) {
        return;
      }

      isSigningOutRef.current = true;

      try {
        const supabase = createSupabaseBrowserClient();
        await supabase.auth.signOut();
      } finally {
        router.replace("/login");
        router.refresh();
      }
    }

    function scheduleIdleTimeout() {
      clearIdleTimeout();

      const elapsedMs = Date.now() - readLastActivity();
      const remainingMs = Math.max(0, IDLE_TIMEOUT_MS - elapsedMs);

      timeoutRef.current = window.setTimeout(() => {
        const latestElapsedMs = Date.now() - readLastActivity();
        if (latestElapsedMs >= IDLE_TIMEOUT_MS) {
          void signOutForInactivity();
          return;
        }

        scheduleIdleTimeout();
      }, remainingMs);
    }

    function registerActivity(force = false) {
      const now = Date.now();
      if (!force && now - lastLocalActivityRef.current < ACTIVITY_THROTTLE_MS) {
        return;
      }

      lastLocalActivityRef.current = now;
      persistLastActivity(now);
      scheduleIdleTimeout();
    }

    function handleStorage(event: StorageEvent) {
      if (event.key !== LAST_ACTIVITY_STORAGE_KEY) {
        return;
      }

      scheduleIdleTimeout();
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        registerActivity(true);
      }
    }

    function handleActivity() {
      registerActivity();
    }

    const activityEvents: Array<keyof WindowEventMap> = [
      "focus",
      "keydown",
      "pointerdown",
      "scroll",
      "touchstart",
    ];

    registerActivity(true);
    window.addEventListener("storage", handleStorage);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    for (const eventName of activityEvents) {
      window.addEventListener(eventName, handleActivity, { passive: true });
    }

    return () => {
      clearIdleTimeout();
      window.removeEventListener("storage", handleStorage);
      document.removeEventListener("visibilitychange", handleVisibilityChange);

      for (const eventName of activityEvents) {
        window.removeEventListener(eventName, handleActivity);
      }
    };
  }, [router]);

  return null;
}
