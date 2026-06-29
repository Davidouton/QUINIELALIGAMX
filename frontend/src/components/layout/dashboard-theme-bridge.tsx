"use client";

import { useEffect } from "react";

import { backendFetch, CATALOG_CACHE_TTL_MS } from "@/lib/api/backend";
import { getBrowserAccessToken } from "@/lib/supabase/session";
import { applyAppTheme, resetAppTheme } from "@/lib/theme/app-theme";
import type { Me, Team } from "@/types/api";

export function DashboardThemeBridge() {
  useEffect(() => {
    let isCancelled = false;

    async function loadTheme() {
      try {
        const accessToken = await getBrowserAccessToken();
        const [me, teams] = await Promise.all([
          backendFetch<Me>("/me", accessToken),
          backendFetch<Team[]>("/teams", accessToken, { cacheTtlMs: CATALOG_CACHE_TTL_MS }),
        ]);

        if (isCancelled) {
          return;
        }

        const favoriteTeam = teams.find((team) => team.id === me.favorite_team_id) ?? null;
        applyAppTheme(me.theme_preference, favoriteTeam);
      } catch {
        if (!isCancelled) {
          resetAppTheme();
        }
      }
    }

    void loadTheme();

    return () => {
      isCancelled = true;
    };
  }, []);

  return null;
}
