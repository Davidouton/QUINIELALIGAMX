"use client";

import { backendFetch } from "@/lib/api/backend";
import { getBrowserAccessToken } from "@/lib/supabase/session";

type AnalyticsMetadataValue = string | number | boolean | null;

export type AnalyticsEventInput = {
  category: string;
  event_name: string;
  route_path?: string | null;
  screen_name?: string | null;
  season_id?: string | null;
  matchday_id?: string | null;
  competition_id?: string | null;
  success?: boolean | null;
  duration_ms?: number | null;
  metadata?: Record<string, AnalyticsMetadataValue> | null;
};

const EVENT_DEDUPE_WINDOW_MS = 3000;
const recentEventMap = new Map<string, number>();

function buildEventKey(payload: AnalyticsEventInput) {
  return JSON.stringify({
    category: payload.category,
    event_name: payload.event_name,
    route_path: payload.route_path ?? null,
    screen_name: payload.screen_name ?? null,
    season_id: payload.season_id ?? null,
    matchday_id: payload.matchday_id ?? null,
    competition_id: payload.competition_id ?? null,
    success: payload.success ?? null,
    metadata: payload.metadata ?? null,
  });
}

function shouldSkipDuplicate(payload: AnalyticsEventInput) {
  const key = buildEventKey(payload);
  const now = Date.now();
  const lastSentAt = recentEventMap.get(key) ?? 0;
  if (now - lastSentAt < EVENT_DEDUPE_WINDOW_MS) {
    return true;
  }
  recentEventMap.set(key, now);
  if (recentEventMap.size > 200) {
    const cutoff = now - EVENT_DEDUPE_WINDOW_MS;
    for (const [entryKey, timestamp] of recentEventMap.entries()) {
      if (timestamp < cutoff) {
        recentEventMap.delete(entryKey);
      }
    }
  }
  return false;
}

export async function trackAnalyticsEvent(payload: AnalyticsEventInput) {
  if (typeof window === "undefined") {
    return;
  }
  if (shouldSkipDuplicate(payload)) {
    return;
  }

  try {
    const accessToken = await getBrowserAccessToken();
    await backendFetch<{ status: string }>("/analytics/events", accessToken, {
      method: "POST",
      timeoutMs: 5000,
      body: JSON.stringify({
        ...payload,
        route_path: payload.route_path ?? null,
        screen_name: payload.screen_name ?? null,
        season_id: payload.season_id ?? null,
        matchday_id: payload.matchday_id ?? null,
        competition_id: payload.competition_id ?? null,
        success: payload.success ?? null,
        duration_ms: payload.duration_ms ?? null,
        metadata: payload.metadata ?? null,
      }),
    });
  } catch {
    return;
  }
}

export function getDashboardScreenName(pathname: string) {
  const exactMap: Record<string, string> = {
    "/dashboard": "Dashboard",
    "/dashboard/picks": "Picks",
    "/dashboard/leaderboard": "Ranking",
    "/dashboard/vip": "VIP",
    "/dashboard/survivor": "Survivor",
    "/dashboard/prizes": "Premios",
    "/dashboard/quiniela-plus": "Quiniela Plus",
    "/dashboard/results": "Resultados",
    "/dashboard/world-cup": "Mundial",
    "/dashboard/rules": "Reglamento",
    "/dashboard/settings": "Settings",
    "/dashboard/admin": "Admin Resumen",
    "/dashboard/admin/users": "Admin Usuarios",
    "/dashboard/admin/results": "Admin Resultados",
    "/dashboard/admin/picks": "Admin Picks",
    "/dashboard/admin/stats": "Admin Stats",
  };

  if (exactMap[pathname]) {
    return exactMap[pathname];
  }
  if (pathname.startsWith("/dashboard/admin/")) {
    return `Admin ${pathname.slice("/dashboard/admin/".length).replaceAll("-", " ")}`;
  }
  if (pathname.startsWith("/dashboard/")) {
    return pathname.slice("/dashboard/".length).replaceAll("-", " ");
  }
  return pathname || "Pantalla";
}
