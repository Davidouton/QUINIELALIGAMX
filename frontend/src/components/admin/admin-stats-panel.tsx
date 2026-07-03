"use client";

import { useEffect, useMemo, useState } from "react";

import { backendFetch } from "@/lib/api/backend";
import { getBrowserAccessToken } from "@/lib/supabase/session";
import type { AdminAnalyticsStats } from "@/types/api";

const dayOptions = [1, 7, 30];

function formatDateTime(value: string) {
  try {
    return new Intl.DateTimeFormat("es-MX", {
      dateStyle: "short",
      timeStyle: "short",
      timeZone: "America/Mexico_City",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function formatLoadMs(value: number | null) {
  if (value === null || Number.isNaN(value)) {
    return "-";
  }
  if (value >= 1000) {
    return `${(value / 1000).toFixed(2)} s`;
  }
  return `${Math.round(value)} ms`;
}

function formatPercent(part: number, total: number) {
  if (total <= 0) {
    return "0%";
  }
  return `${Math.round((part / total) * 100)}%`;
}

export function AdminStatsPanel() {
  const [days, setDays] = useState(7);
  const [stats, setStats] = useState<AdminAnalyticsStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadStats() {
      setLoading(true);
      setError(null);
      try {
        const accessToken = await getBrowserAccessToken();
        const response = await backendFetch<AdminAnalyticsStats>(`/admin/stats?days=${days}`, accessToken, {
          cacheTtlMs: 15000,
        });
        setStats(response);
      } catch (caughtError) {
        setError(caughtError instanceof Error ? caughtError.message : "No se pudieron cargar los stats");
      } finally {
        setLoading(false);
      }
    }

    void loadStats();
  }, [days]);

  const maxDailyViews = useMemo(
    () => Math.max(...(stats?.daily.map((row) => row.screen_views) ?? [0]), 1),
    [stats],
  );

  if (loading) {
    return <p className="text-sm text-ink/60">Cargando stats...</p>;
  }

  if (error) {
    return <p className="text-sm text-coral">{error}</p>;
  }

  if (!stats) {
    return <p className="text-sm text-steel">Todavia no hay datos de uso.</p>;
  }

  return (
    <div className="space-y-6">
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[10px] uppercase tracking-[0.22em] text-steel">Producto</p>
          <h1 className="mt-2 text-2xl font-semibold text-ink">Stats</h1>
          <p className="mt-2 text-sm text-steel">
            Uso real del panel y de las pantallas clave para decidir que pulir, acelerar y empujar.
          </p>
        </div>
        <div className="space-y-2">
          <p className="text-[10px] uppercase tracking-[0.18em] text-steel">Ventana</p>
          <div className="flex gap-2">
            {dayOptions.map((option) => {
              const isActive = option === days;
              return (
                <button
                  key={option}
                  type="button"
                  onClick={() => setDays(option)}
                  className={
                    isActive
                      ? "app-pill-active px-3 py-2 text-xs uppercase tracking-[0.16em] text-ink"
                      : "app-pill-ghost px-3 py-2 text-xs uppercase tracking-[0.16em]"
                  }
                >
                  {option}d
                </button>
              );
            })}
          </div>
          <p className="text-[11px] text-steel">Actualizado: {formatDateTime(stats.generated_at)}</p>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <div className="rounded-[18px] border border-white/[0.06] bg-white/[0.03] px-4 py-4">
          <p className="text-[10px] uppercase tracking-[0.22em] text-steel">Usuarios unicos</p>
          <p className="mt-3 text-2xl font-semibold text-ink">{stats.kpis.unique_users}</p>
        </div>
        <div className="rounded-[18px] border border-white/[0.06] bg-white/[0.03] px-4 py-4">
          <p className="text-[10px] uppercase tracking-[0.22em] text-steel">Views</p>
          <p className="mt-3 text-2xl font-semibold text-ink">{stats.kpis.screen_views}</p>
        </div>
        <div className="rounded-[18px] border border-white/[0.06] bg-white/[0.03] px-4 py-4">
          <p className="text-[10px] uppercase tracking-[0.22em] text-steel">Acciones</p>
          <p className="mt-3 text-2xl font-semibold text-ink">{stats.kpis.action_events}</p>
        </div>
        <div className="rounded-[18px] border border-white/[0.06] bg-white/[0.03] px-4 py-4">
          <p className="text-[10px] uppercase tracking-[0.22em] text-steel">Fallos</p>
          <p className="mt-3 text-2xl font-semibold text-coral">{stats.kpis.failure_events}</p>
        </div>
        <div className="rounded-[18px] border border-white/[0.06] bg-white/[0.03] px-4 py-4">
          <p className="text-[10px] uppercase tracking-[0.22em] text-steel">Carga prom.</p>
          <p className="mt-3 text-2xl font-semibold text-ink">{formatLoadMs(stats.kpis.avg_screen_load_ms)}</p>
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <div className="rounded-[22px] border border-white/[0.06] bg-white/[0.03] px-4 py-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[10px] uppercase tracking-[0.22em] text-steel">Pantallas</p>
              <h2 className="mt-2 text-lg font-semibold text-ink">Que es lo mas visto</h2>
            </div>
          </div>
          <div className="mt-4 space-y-3">
            {stats.screens.map((screen) => (
              <div key={`${screen.screen_name}-${screen.route_path ?? "na"}`} className="rounded-[16px] border border-white/[0.05] bg-night/20 px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-ink">{screen.screen_name}</p>
                    <p className="mt-1 text-[11px] text-steel">{screen.route_path ?? "Sin ruta"}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold text-ink">{screen.views} views</p>
                    <p className="mt-1 text-[11px] text-steel">{screen.unique_users} usuarios</p>
                  </div>
                </div>
                <div className="mt-3 h-2 rounded-full bg-white/[0.05]">
                  <div
                    className="h-2 rounded-full bg-mint/70"
                    style={{ width: formatPercent(screen.views, stats.kpis.screen_views) }}
                  />
                </div>
                <div className="mt-3 flex flex-wrap gap-4 text-[11px] text-steel">
                  <span>Carga: {formatLoadMs(screen.avg_load_ms)}</span>
                  <span>Fallos: {screen.failures}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-6">
          <div className="rounded-[22px] border border-white/[0.06] bg-white/[0.03] px-4 py-4">
            <p className="text-[10px] uppercase tracking-[0.22em] text-steel">Eventos</p>
            <h2 className="mt-2 text-lg font-semibold text-ink">Acciones mas frecuentes</h2>
            <div className="mt-4 space-y-3">
              {stats.top_events.map((event) => (
                <div key={`${event.category}-${event.event_name}`} className="flex items-center justify-between gap-3 border-b border-white/[0.05] pb-3 last:border-b-0 last:pb-0">
                  <div>
                    <p className="text-sm font-semibold text-ink">{event.event_name}</p>
                    <p className="mt-1 text-[11px] uppercase tracking-[0.12em] text-steel">{event.category}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold text-ink">{event.count}</p>
                    <p className="mt-1 text-[11px] text-steel">{event.unique_users} usuarios</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-[22px] border border-white/[0.06] bg-white/[0.03] px-4 py-4">
            <p className="text-[10px] uppercase tracking-[0.22em] text-steel">Tendencia</p>
            <h2 className="mt-2 text-lg font-semibold text-ink">Views por dia</h2>
            <div className="mt-4 space-y-3">
              {stats.daily.map((day) => (
                <div key={day.day}>
                  <div className="mb-1 flex items-center justify-between gap-3 text-[11px] text-steel">
                    <span>{day.day}</span>
                    <span>
                      {day.screen_views} views · {day.unique_users} usuarios
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-white/[0.05]">
                    <div
                      className="h-2 rounded-full bg-sky-300/75"
                      style={{ width: `${Math.max((day.screen_views / maxDailyViews) * 100, day.screen_views > 0 ? 4 : 0)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-[22px] border border-white/[0.06] bg-white/[0.03] px-4 py-4">
        <p className="text-[10px] uppercase tracking-[0.22em] text-steel">Reciente</p>
        <h2 className="mt-2 text-lg font-semibold text-ink">Ultimos eventos</h2>
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="text-[10px] uppercase tracking-[0.18em] text-steel">
              <tr>
                <th className="pb-3 pr-4">Hora</th>
                <th className="pb-3 pr-4">Usuario</th>
                <th className="pb-3 pr-4">Evento</th>
                <th className="pb-3 pr-4">Pantalla</th>
                <th className="pb-3 pr-4">Duracion</th>
                <th className="pb-3 pr-0">Estado</th>
              </tr>
            </thead>
            <tbody>
              {stats.recent_events.map((event) => (
                <tr key={event.id} className="border-t border-white/[0.05]">
                  <td className="py-3 pr-4 text-[12px] text-steel">{formatDateTime(event.created_at)}</td>
                  <td className="py-3 pr-4 text-[12px] text-ink">{event.display_name ?? "Sistema"}</td>
                  <td className="py-3 pr-4 text-[12px] text-ink">{event.event_name}</td>
                  <td className="py-3 pr-4 text-[12px] text-steel">{event.screen_name ?? event.route_path ?? "-"}</td>
                  <td className="py-3 pr-4 text-[12px] text-steel">{formatLoadMs(event.duration_ms)}</td>
                  <td className="py-3 pr-0 text-[12px]">
                    <span className={event.success === false ? "text-coral" : "text-mint"}>
                      {event.success === false ? "Fallo" : "OK"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
