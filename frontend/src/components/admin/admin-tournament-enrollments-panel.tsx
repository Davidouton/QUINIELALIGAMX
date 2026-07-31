"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { backendFetch } from "@/lib/api/backend";
import { isSurvivorAvailableForSeason } from "@/lib/dashboard-season";
import { getBrowserAccessToken } from "@/lib/supabase/session";
import type { AdminUser, AdminUserSeasonMembership, AdminUserSurvivorMembership, Season } from "@/types/api";

type EnrollmentStatus = "active" | "pending" | "inactive" | "rejected";
type StatusFilter = "all" | EnrollmentStatus;
type EnrollmentProduct = "quiniela" | "survivor";
type EnrollmentMembership = AdminUserSeasonMembership | AdminUserSurvivorMembership;

type EnrollmentRow = {
  user: AdminUser;
  membership: EnrollmentMembership | null;
  status: EnrollmentStatus;
};

function getEnrollmentStatus(membership: EnrollmentMembership | null): EnrollmentStatus {
  if (!membership) return "inactive";
  if (membership.is_active) return "active";
  if (membership.is_rejected) return "rejected";
  const previousActivation = "activated_at" in membership ? membership.activated_at : membership.joined_at;
  return previousActivation ? "inactive" : "pending";
}

function getMembershipActivationDate(membership: EnrollmentMembership | null) {
  if (!membership) return null;
  return "activated_at" in membership ? membership.activated_at : membership.joined_at;
}

const statusPresentation: Record<EnrollmentStatus, { label: string; className: string }> = {
  active: { label: "Inscrito", className: "text-mint" },
  pending: { label: "Pendiente", className: "text-gold" },
  inactive: { label: "No inscrito", className: "text-steel" },
  rejected: { label: "No aprobado", className: "text-coral" },
};

export function AdminTournamentEnrollmentsPanel() {
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [selectedSeasonId, setSelectedSeasonId] = useState("");
  const [selectedProduct, setSelectedProduct] = useState<EnrollmentProduct>("quiniela");
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [loading, setLoading] = useState(true);
  const [generatingForUserId, setGeneratingForUserId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

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
      users.map((user) => {
        const membership = selectedProduct === "survivor"
          ? user.survivor_memberships.find((row) => row.season_id === selectedSeasonId) ?? null
          : user.season_memberships.find((row) => row.season_id === selectedSeasonId) ?? null;
        return { user, membership, status: getEnrollmentStatus(membership) };
      }),
    [selectedProduct, selectedSeasonId, users],
  );

  const counts = useMemo(
    () => ({
      all: enrollmentRows.length,
      active: enrollmentRows.filter((row) => row.status === "active").length,
      pending: enrollmentRows.filter((row) => row.status === "pending").length,
      inactive: enrollmentRows.filter((row) => row.status === "inactive").length,
      rejected: enrollmentRows.filter((row) => row.status === "rejected").length,
      paid: enrollmentRows.filter((row) => row.membership?.is_paid).length,
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
  const survivorAvailable = isSurvivorAvailableForSeason(selectedSeason);

  useEffect(() => {
    if (!survivorAvailable && selectedProduct === "survivor") {
      setSelectedProduct("quiniela");
    }
  }, [selectedProduct, survivorAvailable]);

  async function handleGeneratePaymentRequest(user: AdminUser) {
    setGeneratingForUserId(user.id);
    setError(null);
    setMessage(null);
    try {
      const accessToken = await getBrowserAccessToken();
      await backendFetch("/payments/settlements/admin/enrollment-request", accessToken, {
        method: "POST",
        body: JSON.stringify({
          profile_id: user.id,
          scope_type: selectedProduct === "survivor" ? "survivor" : "season",
          scope_id: selectedSeasonId,
        }),
      });
      setMessage(`Cobro generado para ${user.display_name}. Ya aparece en su Hub de Pagos.`);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "No se pudo generar el cobro");
    } finally {
      setGeneratingForUserId(null);
    }
  }

  return (
    <div className="space-y-8">
      <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_220px_minmax(240px,360px)] lg:items-end">
        <div>
          <h2 className="text-lg font-semibold text-ink">Participantes del torneo</h2>
          <p className="mt-1 text-sm text-steel">Consulta rápidamente las inscripciones de Quiniela y Survivor.</p>
        </div>
        <label className="page-context-label">
          <span>Modalidad</span>
          <select value={selectedProduct} onChange={(event) => { setSelectedProduct(event.target.value as EnrollmentProduct); setStatusFilter("all"); }} className="page-context-select">
            <option value="quiniela">Quiniela</option>
            {survivorAvailable ? <option value="survivor">Survivor</option> : null}
          </select>
        </label>
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
      {message ? <p className="text-sm text-mint">{message}</p> : null}

      <section className="grid grid-cols-2 border-l border-t border-white/10 sm:grid-cols-3 xl:grid-cols-6">
        {[
          ["Usuarios", counts.all],
          ["Inscritos", counts.active],
          ["Pendientes", counts.pending],
          ["No inscritos", counts.inactive],
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
              ["inactive", "No inscritos", counts.inactive],
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
            {enrollmentRows.length ? "No hay resultados con estos filtros." : "Todavía no hay usuarios registrados."}
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
                  <th className="px-3 py-3 text-right">Acciones</th>
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
                    <td className="px-3 py-3 text-steel">{membership?.is_paid ? "Pagado" : "No pagado"}</td>
                    <td className="px-3 py-3 text-steel">{user.modality === "aval" ? `Aval${user.aval_display_name ? ` · ${user.aval_display_name}` : ""}` : "Pre-pago"}</td>
                    <td className="px-3 py-3 text-steel">{getMembershipActivationDate(membership) ? new Date(getMembershipActivationDate(membership)!).toLocaleString("es-MX") : "—"}</td>
                    <td className="px-3 py-3 text-right">
                      <div className="flex items-center justify-end gap-3">
                        {status === "pending" && user.modality !== "aval" ? (
                          <button
                            type="button"
                            onClick={() => void handleGeneratePaymentRequest(user)}
                            disabled={Boolean(generatingForUserId)}
                            className="font-semibold text-mint transition hover:text-ink disabled:opacity-50"
                          >
                            {generatingForUserId === user.id ? "Generando..." : "Generar cobro"}
                          </button>
                        ) : null}
                        <Link href={`/dashboard/admin/user-info/${user.id}`} className="font-semibold text-[#4f7df3] transition hover:text-ink">Ver usuario</Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      {selectedSeason ? <p className="text-xs text-steel">Mostrando {selectedProduct === "survivor" ? selectedSeason.survivor_name?.trim() || "Survivor" : "Quiniela"} · {selectedSeason.name} · {visibleRows.length} resultados visibles.</p> : null}
    </div>
  );
}
