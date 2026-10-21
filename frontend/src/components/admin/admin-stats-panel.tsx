"use client";

import { useEffect, useMemo, useState } from "react";

import { backendFetch } from "@/lib/api/backend";
import {
  formatMexicoCityDateTime,
  shiftMexicoCityInputValue,
  toMexicoCityInputValue,
} from "@/lib/datetime/mexico-city";
import { getBrowserAccessToken } from "@/lib/supabase/session";
import type { AdminAnalyticsStats, AdminUser } from "@/types/api";

const dayOptions = [1, 7, 30, 90];
const pageSizeOptions = [25, 50, 100, 200];

type AppliedRange = {
  startAt: string;
  endAt: string;
  quickDays: number | null;
  requestedEndAt: string | null;
};

function quickRange(days: number): AppliedRange {
  const end = new Date();
  return {
    startAt: new Date(end.getTime() - days * 24 * 60 * 60 * 1000).toISOString(),
    endAt: end.toISOString(),
    quickDays: days,
    requestedEndAt: null,
  };
}

function formatDateTime(value: string) {
  return formatMexicoCityDateTime(value);
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
  const [range, setRange] = useState<AppliedRange | null>(null);
  const [fromInput, setFromInput] = useState("");
  const [toInput, setToInput] = useState("");
  const [rangeError, setRangeError] = useState<string | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [selectedProfileId, setSelectedProfileId] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [stats, setStats] = useState<AdminAnalyticsStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const initialRange = quickRange(7);
    setRange(initialRange);
    setFromInput(toMexicoCityInputValue(initialRange.startAt));
    setToInput(toMexicoCityInputValue(initialRange.endAt));
  }, []);

  useEffect(() => {
    let active = true;
    async function loadUsers() {
      setUsersError(null);
      try {
        const accessToken = await getBrowserAccessToken();
        if (!active) return;
        const response = await backendFetch<AdminUser[]>("/admin/users", accessToken);
        if (active) setUsers(response);
      } catch (caughtError) {
        if (active) {
          setUsersError(caughtError instanceof Error ? caughtError.message : "No se pudo cargar la lista de usuarios.");
        }
      }
    }
    void loadUsers();
    return () => { active = false; };
  }, [refreshVersion]);

  useEffect(() => {
    if (!range) return;
    let active = true;
    const controller = new AbortController();
    async function loadStats() {
      setLoading(true);
      setError(null);
      try {
        const accessToken = await getBrowserAccessToken();
        if (!active || !range) return;
        const params = new URLSearchParams({
          start_at: range.startAt,
          end_at: range.endAt,
          page: String(page),
          page_size: String(pageSize),
        });
        if (selectedProfileId) {
          params.set("profile_id", selectedProfileId);
        }
        const response = await backendFetch<AdminAnalyticsStats>(
          `/admin/stats?${params.toString()}`, accessToken, { signal: controller.signal },
        );
        if (active) setStats(response);
      } catch (caughtError) {
        if (active) {
          setError(caughtError instanceof Error ? caughtError.message : "No se pudieron cargar los movimientos.");
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    void loadStats();
    return () => {
      active = false;
      controller.abort();
    };
  }, [range, selectedProfileId, page, pageSize, refreshVersion]);

  function applyQuickRange(days: number) {
    const next = quickRange(days);
    setRange(next);
    setFromInput(toMexicoCityInputValue(next.startAt));
    setToInput(toMexicoCityInputValue(next.endAt));
    setRangeError(null);
    setPage(1);
  }

  function applyCustomRange() {
    const endExclusive = shiftMexicoCityInputValue(toInput, 1);
    const now = new Date();
    const nowInput = toMexicoCityInputValue(now.toISOString());
    if (!fromInput || !toInput || !endExclusive) {
      setRangeError("Elige una fecha y hora en Desde y Hasta.");
      return;
    }
    if (fromInput > toInput) {
      setRangeError("Desde debe ser anterior o igual a Hasta.");
      return;
    }
    if (fromInput > nowInput) {
      setRangeError("Desde no puede estar en el futuro.");
      return;
    }
    setRange({
      startAt: fromInput,
      endAt: endExclusive > nowInput ? now.toISOString() : endExclusive,
      quickDays: null,
      requestedEndAt: endExclusive,
    });
    setRangeError(null);
    setPage(1);
  }

  function selectProfile(profileId: string) {
    setSelectedProfileId(profileId);
    setPage(1);
  }

  function refresh() {
    if (range?.quickDays) {
      applyQuickRange(range.quickDays);
    } else if (range?.requestedEndAt) {
      const now = new Date();
      const nowInput = toMexicoCityInputValue(now.toISOString());
      const endAt = range.requestedEndAt > nowInput ? now.toISOString() : range.requestedEndAt;
      setRange({ ...range, endAt });
      if (endAt !== range.endAt) setPage(1);
    }
    setRefreshVersion((version) => version + 1);
  }

  const maxDailyViews = useMemo(
    () => Math.max(...(stats?.daily.map((row) => row.screen_views) ?? [0]), 1),
    [stats],
  );

  return (
    <div className="space-y-6">
      <section className="space-y-4 rounded-[22px] border border-white/[0.06] bg-white/[0.03] px-4 py-4" aria-label="Filtros de movimientos">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-[10px] uppercase tracking-[0.18em] text-steel">Periodo de actividad</p>
          <div className="flex flex-wrap gap-2">
            {dayOptions.map((option) => {
              const isActive = option === range?.quickDays;
              return (
                <button
                  key={option}
                  type="button"
                  aria-pressed={isActive}
                  onClick={() => applyQuickRange(option)}
                  className={
                    isActive
                      ? "app-pill-active px-3 py-2 text-xs uppercase tracking-[0.16em] text-ink"
                      : "app-pill-ghost px-3 py-2 text-xs uppercase tracking-[0.16em]"
                  }
                >
                  {option === 1 ? "Últimas 24 h" : `${option} días`}
                </button>
              );
            })}
          </div>
        </div>
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(event) => { event.preventDefault(); applyCustomRange(); }}
        >
          <label className="block space-y-1.5">
            <span className="text-[10px] uppercase tracking-[0.18em] text-steel">Desde · CDMX</span>
            <input
              type="datetime-local"
              value={fromInput}
              onChange={(event) => setFromInput(event.target.value)}
              required
              step={60}
              className="field-control text-sm"
            />
          </label>
          <label className="block space-y-1.5">
            <span className="text-[10px] uppercase tracking-[0.18em] text-steel">Hasta · CDMX</span>
            <input
              type="datetime-local"
              value={toInput}
              onChange={(event) => setToInput(event.target.value)}
              required
              step={60}
              className="field-control text-sm"
            />
          </label>
          <button type="submit" className="app-pill-active px-4 py-2 text-xs uppercase tracking-[0.16em] text-ink">
            Aplicar
          </button>
        </form>
        <p className="text-[11px] text-steel">Al aplicar, se incluye el minuto final. Si Hasta está en el futuro, se consulta hasta ahora.</p>
        {rangeError ? <p role="alert" className="text-sm text-coral">{rangeError}</p> : null}
        <div className="flex flex-wrap items-end justify-between gap-3">
          <label className="block space-y-1.5">
            <span className="text-[10px] uppercase tracking-[0.18em] text-steel">Usuario</span>
            <select
              value={selectedProfileId}
              onChange={(event) => selectProfile(event.target.value)}
              className="field-control min-w-[220px] text-sm"
            >
              <option value="">Todos los usuarios</option>
              {users.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.display_name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={refresh}
            disabled={loading}
            className="app-pill-ghost px-4 py-2 text-xs uppercase tracking-[0.16em] disabled:cursor-wait disabled:opacity-50"
          >
            Actualizar
          </button>
        </div>
        {usersError ? <p role="alert" className="text-sm text-coral">Usuarios: {usersError}</p> : null}
        {stats ? (
          <div className="space-y-1 text-[11px] text-steel">
            <p>Consulta mostrada: {stats.selected_profile_display_name ?? "todos los usuarios"}</p>
            <p>Periodo consultado: {formatDateTime(stats.window_start)} – {formatDateTime(new Date(new Date(stats.window_end).getTime() - 1).toISOString())} · CDMX</p>
            <p>Actualizado: {formatDateTime(stats.generated_at)}. Los indicadores corresponden a todo el periodo.</p>
          </div>
        ) : null}
      </section>

      <div className="min-h-6">
        {loading ? <p role="status" className="text-sm text-ink/60">{stats ? "Actualizando movimientos; abajo se conserva la consulta anterior." : "Cargando movimientos..."}</p> : null}
        {error ? <p role="alert" className="text-sm text-coral">{error}{stats ? " Los datos de abajo corresponden a la consulta anterior." : ""}</p> : null}
      </div>
      {!loading && !error && !stats ? <p className="text-sm text-steel">Todavía no hay datos de uso.</p> : null}
      {stats ? (
      <fieldset
        disabled={loading || Boolean(error)}
        aria-busy={loading}
        className={`min-w-0 space-y-6 border-0 p-0 transition-opacity ${loading || error ? "opacity-50" : ""}`}
      >
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

      <section className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
        <div className="rounded-[22px] border border-white/[0.06] bg-white/[0.03] px-4 py-4">
          <p className="text-[10px] uppercase tracking-[0.22em] text-steel">Usuarios</p>
          <h2 className="mt-2 text-lg font-semibold text-ink">Quien entra mas</h2>
          <div className="mt-4 space-y-3">
            {stats.users.length > 0 ? (
              stats.users.map((user) => (
                <button
                  key={user.profile_id}
                  type="button"
                  onClick={() => selectProfile(selectedProfileId === user.profile_id ? "" : user.profile_id)}
                  className="block w-full rounded-[16px] border border-white/[0.05] bg-night/20 px-4 py-3 text-left transition hover:border-white/[0.1] hover:bg-night/30"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-ink">{user.display_name}</p>
                      <p className="mt-1 text-[11px] text-steel">
                        Ultima actividad: {user.last_seen_at ? formatDateTime(user.last_seen_at) : "-"}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold text-ink">{user.screen_views} entradas</p>
                      <p className="mt-1 text-[11px] text-steel">{user.action_events} acciones</p>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-4 text-[11px] text-steel">
                    <span>Fallos: {user.failure_events}</span>
                    <span>Carga: {formatLoadMs(user.avg_load_ms)}</span>
                  </div>
                </button>
              ))
            ) : (
              <p className="text-sm text-steel">Todavia no hay actividad de usuarios en esta ventana.</p>
            )}
          </div>
        </div>

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
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
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
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-[10px] uppercase tracking-[0.22em] text-steel">Movimientos</p>
            <h2 className="mt-2 text-lg font-semibold text-ink">Historial del periodo</h2>
            <p className="mt-1 text-[11px] text-steel">{stats.events_total.toLocaleString("es-MX")} movimientos · Más recientes primero</p>
          </div>
          <label className="block space-y-1.5">
            <span className="text-[10px] uppercase tracking-[0.18em] text-steel">Por página</span>
            <select
              value={pageSize}
              onChange={(event) => {
                setPageSize(Number(event.target.value));
                setPage(1);
              }}
              className="field-control text-sm"
            >
              {pageSizeOptions.map((size) => <option key={size} value={size}>{size}</option>)}
            </select>
          </label>
        </div>
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
              {stats.recent_events.length === 0 ? (
                <tr className="border-t border-white/[0.05]">
                  <td colSpan={6} className="py-8 text-center text-sm text-steel">
                    No hay movimientos para este usuario y periodo.
                  </td>
                </tr>
              ) : null}
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
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.05] pt-4">
          <p className="text-[11px] text-steel">
            {stats.events_total > 0
              ? `Mostrando ${(stats.events_page - 1) * stats.events_page_size + 1}–${Math.min((stats.events_page - 1) * stats.events_page_size + stats.recent_events.length, stats.events_total)} de ${stats.events_total.toLocaleString("es-MX")}`
              : "0 movimientos"}
          </p>
          <nav aria-label="Páginas del historial" className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setPage(stats.events_page - 1)}
              disabled={stats.events_page <= 1 || stats.events_total_pages === 0}
              className="app-pill-ghost px-3 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-40"
            >
              Anterior
            </button>
            <span className="text-xs text-steel">
              {stats.events_total_pages > 0 ? `${stats.events_page} / ${stats.events_total_pages}` : "Sin páginas"}
            </span>
            <button
              type="button"
              onClick={() => setPage(stats.events_page + 1)}
              disabled={stats.events_page >= stats.events_total_pages}
              className="app-pill-ghost px-3 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-40"
            >
              Siguiente
            </button>
          </nav>
        </div>
      </section>
      </fieldset>
      ) : null}
    </div>
  );
}
