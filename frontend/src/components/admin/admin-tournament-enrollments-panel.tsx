"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { backendFetch } from "@/lib/api/backend";
import { getBrowserAccessToken } from "@/lib/supabase/session";
import type { AdminUser, AdminUserSeasonMembership, Season } from "@/types/api";

type EnrollmentStatus = "active" | "pending" | "rejected";
type StatusFilter = "all" | EnrollmentStatus;

type EnrollmentRow = {
  user: AdminUser;
  membership: AdminUserSeasonMembership;
  status: EnrollmentStatus;
};

function getEnrollmentStatus(membership: AdminUserSeasonMembership): EnrollmentStatus {
  if (membership.is_active) return "active";
  if (membership.is_rejected) return "rejected";
  return "pending";
}

const statusPresentation: Record<EnrollmentStatus, { label: string; className: string }> = {
  active: { label: "Inscrito", className: "text-mint" },
  pending: { label: "Pendiente", className: "text-gold" },
  rejected: { label: "No aprobado", className: "text-coral" },
};

export function AdminTournamentEnrollmentsPanel() {
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [selectedSeasonId, setSelectedSeasonId] = useState("");
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadSeasons() {
      try {
        const accessToken = await getBrowserAccessToken();
        const rows = await backendFetch<Season[]>("/seasons", accessToken);
        const orderedRows = [...rows].sort((left, right) => {
          if (left.visibility_status !== right.visibility_status) {
            if (left.visibility_status === "live") return -1;
            if (right.visibility_status === "live") return 1;
          }
          if (left.is_active !== right.is_active) return left.is_active ? -1 : 1;
          return right.created_at.localeCompare(left.created_at);
        });
        setSeasons(orderedRows);
        setSelectedSeasonId(orderedRows[0]?.id ?? "");
      } catch (caughtError) {
        setError(caughtError instanceof Error ? caughtError.message : "No se pudieron cargar los torneos");
        setLoading(false);
      }
    }

    void loadSeasons();
  }, []);

  useEffect(() => {
    if (!selectedSeasonId) {
      setUsers([]);
      setLoading(false);
      return;
    }

    async function loadEnrollments() {
      setLoading(true);
      setError(null);
      try {
        const accessToken = await getBrowserAccessToken();
        const rows = await backendFetch<AdminUser[]>(`/admin/users?season_id=${selectedSeasonId}`, accessToken);
        setUsers(rows);
      } catch (caughtError) {
        setError(caughtError instanceof Error ? caughtError.message : "No se pudieron cargar los inscritos");
      } finally {
        setLoading(false);
      }
    }

    void loadEnrollments();
  }, [selectedSeasonId]);

  const enrollmentRows = useMemo<EnrollmentRow[]>(
    () =>
      users.flatMap((user) => {
        const membership = user.season_memberships.find((row) => row.season_id === selectedSeasonId);
        return membership ? [{ user, membership, status: getEnrollmentStatus(membership) }] : [];
      }),
    [selectedSeasonId, users],
  );

  const counts = useMemo(
    () => ({
      all: enrollmentRows.length,
      active: enrollmentRows.filter((row) => row.status === "active").length,
      pending: enrollmentRows.filter((row) => row.status === "pending").length,
      rejected: enrollmentRows.filter((row) => row.status === "rejected").length,
      paid: enrollmentRows.filter((row) => row.membership.is_paid).length,
    }),
    [enrollmentRows],
  );

  const visibleRows = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLocaleLowerCase("es-MX");
    return enrollmentRows
      .filter((row) => statusFilter === "all" || row.status === statusFilter)
      .filter((row) => {
        if (!normalizedSearch) return true;
        return [row.user.display_name, row.user.username, row.user.email]
          .filter(Boolean)
          .some((value) => value?.toLocaleLowerCase("es-MX").includes(normalizedSearch));
      })
      .sort((left, right) => left.user.display_name.localeCompare(right.user.display_name, "es-MX"));
  }, [enrollmentRows, searchTerm, statusFilter]);

  const selectedSeason = seasons.find((season) => season.id === selectedSeasonId) ?? null;

  return (
    <div className="space-y-8">
      <section className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(240px,360px)] sm:items-end">
        <div>
          <h2 className="text-lg font-semibold text-ink">Participantes del torneo</h2>
          <p className="mt-1 text-sm text-steel">Consulta rápidamente quién solicitó inscripción y su estado actual.</p>
        </div>
        <label className="page-context-label">
          <span>Torneo</span>
          <select value={selectedSeasonId} onChange={(event) => { setSelectedSeasonId(event.target.value); setStatusFilter("all"); }} className="page-context-select">
            {seasons.map((season) => (
              <option key={season.id} value={season.id}>
                {season.competition_name ? `${season.competition_name} · ` : ""}{season.name}
              </option>
            ))}
          </select>
        </label>
      </section>

      {error ? <p className="text-sm text-coral">{error}</p> : null}

      <section className="grid grid-cols-2 border-l border-t border-white/10 sm:grid-cols-5">
        {[
          ["Solicitudes", counts.all],
          ["Inscritos", counts.active],
          ["Pendientes", counts.pending],
          ["No aprobados", counts.rejected],
          ["Pagados", counts.paid],
        ].map(([label, value]) => (
          <div key={label} className="border-b border-r border-white/10 px-4 py-4">
            <p className="text-[11px] uppercase tracking-[0.18em] text-steel">{label}</p>
            <p className="mt-2 text-2xl font-semibold text-ink">{value}</p>
          </div>
        ))}
      </section>

      <section className="space-y-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap gap-2">
            {([
              ["all", "Todos", counts.all],
              ["active", "Inscritos", counts.active],
              ["pending", "Pendientes", counts.pending],
              ["rejected", "No aprobados", counts.rejected],
            ] as const).map(([value, label, count]) => (
              <button key={value} type="button" onClick={() => setStatusFilter(value)} className={statusFilter === value ? "app-pill-active h-10 px-4 text-sm" : "app-pill h-10 px-4 text-sm"}>
                {label} · {count}
              </button>
            ))}
          </div>
          <input value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="Buscar nombre, usuario o correo" className="field-control lg:max-w-sm" />
        </div>

        {loading ? <p className="py-6 text-sm text-steel">Cargando inscritos...</p> : null}
        {!loading && !visibleRows.length ? (
          <p className="border-y border-white/10 py-6 text-sm text-steel">
            {enrollmentRows.length ? "No hay resultados con estos filtros." : "Todavía no hay solicitudes para este torneo."}
          </p>
        ) : null}
        {!loading && visibleRows.length ? (
          <div className="android-scroll-x">
            <table className="min-w-[900px] w-full text-left text-sm text-ink">
              <thead className="app-table-head">
                <tr>
                  <th className="px-3 py-3">Participante</th>
                  <th className="px-3 py-3">Estado</th>
                  <th className="px-3 py-3">Pago</th>
                  <th className="px-3 py-3">Modalidad</th>
                  <th className="px-3 py-3">Alta</th>
                  <th className="px-3 py-3 text-right">Detalle</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map(({ user, membership, status }) => (
                  <tr key={user.id} className="app-table-row border-b last:border-b-0">
                    <td className="px-3 py-3">
                      <p className="font-semibold text-ink">{user.display_name}</p>
                      <p className="mt-1 text-xs text-steel">{user.username ? `@${user.username} · ` : ""}{user.email ?? "Sin correo"}</p>
                    </td>
                    <td className={`px-3 py-3 font-semibold ${statusPresentation[status].className}`}>{statusPresentation[status].label}</td>
                    <td className="px-3 py-3 text-steel">{membership.is_paid ? "Pagado" : "No pagado"}</td>
                    <td className="px-3 py-3 text-steel">{user.modality === "aval" ? `Aval${user.aval_display_name ? ` · ${user.aval_display_name}` : ""}` : "Pre-pago"}</td>
                    <td className="px-3 py-3 text-steel">{membership.activated_at ? new Date(membership.activated_at).toLocaleString("es-MX") : "—"}</td>
                    <td className="px-3 py-3 text-right">
                      <Link href={`/dashboard/admin/user-info/${user.id}`} className="font-semibold text-[#4f7df3] transition hover:text-ink">Ver usuario</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      {selectedSeason ? <p className="text-xs text-steel">Mostrando {selectedSeason.name} · {visibleRows.length} resultados visibles.</p> : null}
    </div>
  );
}
