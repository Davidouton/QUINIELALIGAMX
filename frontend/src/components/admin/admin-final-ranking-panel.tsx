"use client";

import { useEffect, useMemo, useState } from "react";

import { backendFetch } from "@/lib/api/backend";
import { getBrowserAccessToken } from "@/lib/supabase/session";
import type { AdminUser, LeaderboardEntry, Season } from "@/types/api";

type FinalRankingRow = LeaderboardEntry & {
  user: AdminUser | null;
};

function getModalityLabel(modality: string | null | undefined) {
  return modality === "aval" ? "Aval" : "Pre-pago";
}

function escapeCsv(value: string | number | null | undefined) {
  const text = String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

function slugify(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function AdminFinalRankingPanel() {
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [selectedSeasonId, setSelectedSeasonId] = useState("");
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadSeasons() {
      try {
        const accessToken = await getBrowserAccessToken();
        const rows = await backendFetch<Season[]>("/seasons", accessToken);
        setSeasons(rows);
        setSelectedSeasonId(rows.find((season) => season.is_active)?.id ?? rows[0]?.id ?? "");
      } catch (caughtError) {
        setError(caughtError instanceof Error ? caughtError.message : "No se pudieron cargar los torneos");
        setLoading(false);
      }
    }

    void loadSeasons();
  }, []);

  useEffect(() => {
    if (!selectedSeasonId) {
      return;
    }

    async function loadRanking() {
      setLoading(true);
      setError(null);
      try {
        const accessToken = await getBrowserAccessToken();
        const [rankingRows, userRows] = await Promise.all([
          backendFetch<LeaderboardEntry[]>(`/leaderboard/overall?season_id=${selectedSeasonId}`, accessToken),
          backendFetch<AdminUser[]>(`/admin/users?season_id=${selectedSeasonId}`, accessToken),
        ]);
        setLeaderboard(rankingRows);
        setUsers(userRows);
      } catch (caughtError) {
        setError(caughtError instanceof Error ? caughtError.message : "No se pudo cargar el ranking final");
      } finally {
        setLoading(false);
      }
    }

    void loadRanking();
  }, [selectedSeasonId]);

  const selectedSeason = seasons.find((season) => season.id === selectedSeasonId) ?? null;
  const rows = useMemo<FinalRankingRow[]>(() => {
    const usersById = new Map(users.map((user) => [user.id, user]));
    return leaderboard.map((entry) => ({ ...entry, user: usersById.get(entry.profile_id) ?? null }));
  }, [leaderboard, users]);

  function downloadRanking() {
    if (!selectedSeason) {
      return;
    }

    const headers = [
      "posicion",
      "jugador",
      "puntos",
      "resultados_correctos",
      "marcadores_exactos",
      "tipo_membresia",
      "aval",
      "telefono",
      "banco",
      "numero_cuenta",
    ];
    const csvRows = rows.map((row) => [
      row.rank_position,
      row.display_name,
      row.total_points,
      row.correct_results,
      row.exact_scores,
      getModalityLabel(row.user?.modality),
      row.user?.aval_display_name ?? "",
      row.user?.contact_phone ?? "",
      row.user?.bank_name ?? "",
      row.user?.deposit_account ?? "",
    ]);
    const csv = [headers, ...csvRows].map((row) => row.map(escapeCsv).join(",")).join("\r\n");
    const blob = new Blob([`\ufeff${csv}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `ranking-final-${slugify(selectedSeason.name) || "torneo"}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-5">
      <section className="flex flex-col gap-4 border-b border-white/[0.08] pb-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-ink">Ranking final</h1>
          <p className="mt-1 text-sm text-steel">Posiciones y datos necesarios para cierre y pago del torneo.</p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <label className="block min-w-[280px] space-y-2 text-sm">
            <span className="text-steel">Torneo</span>
            <select
              value={selectedSeasonId}
              onChange={(event) => setSelectedSeasonId(event.target.value)}
              className="field-control"
            >
              {seasons.map((season) => (
                <option key={season.id} value={season.id}>
                  {season.name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={downloadRanking}
            disabled={loading || rows.length === 0}
            className="app-pill h-11 px-4 disabled:opacity-50"
          >
            Descargar CSV
          </button>
        </div>
      </section>

      {loading ? <p className="text-sm text-steel">Cargando ranking...</p> : null}
      {error ? <p className="text-sm text-coral">{error}</p> : null}

      {!loading && !error ? (
        <section className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs uppercase tracking-[0.18em] text-steel">{selectedSeason?.name ?? "Torneo"}</p>
            <p className="text-sm text-steel">{rows.length} participantes</p>
          </div>
          <div className="no-scrollbar overflow-x-auto touch-pan-x">
            <table className="min-w-[1160px] w-full table-fixed text-left text-[11px] text-ink">
              <colgroup>
                <col className="w-[80px]" />
                <col className="w-[200px]" />
                <col className="w-[90px]" />
                <col className="w-[130px]" />
                <col className="w-[170px]" />
                <col className="w-[170px]" />
                <col className="w-[140px]" />
                <col className="w-[170px]" />
              </colgroup>
              <thead className="app-table-head">
                <tr>
                  <th className="px-3 py-3">Pos.</th>
                  <th className="px-3 py-3">Jugador</th>
                  <th className="px-3 py-3">Puntos</th>
                  <th className="px-3 py-3">Membresía</th>
                  <th className="px-3 py-3">Aval</th>
                  <th className="px-3 py-3">Teléfono</th>
                  <th className="px-3 py-3">Banco</th>
                  <th className="px-3 py-3">Número de cuenta</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.profile_id} className="app-table-row border-b last:border-b-0">
                    <td className="px-3 py-3 font-semibold text-ink">#{row.rank_position}</td>
                    <td className="px-3 py-3 font-medium text-ink">{row.display_name}</td>
                    <td className="px-3 py-3 font-semibold text-ink">{row.total_points}</td>
                    <td className="px-3 py-3 text-steel">{getModalityLabel(row.user?.modality)}</td>
                    <td className="px-3 py-3 text-steel">{row.user?.aval_display_name ?? "-"}</td>
                    <td className="px-3 py-3 text-steel">{row.user?.contact_phone ?? "-"}</td>
                    <td className="px-3 py-3 text-steel">{row.user?.bank_name ?? "-"}</td>
                    <td className="px-3 py-3 text-steel">{row.user?.deposit_account ?? "-"}</td>
                  </tr>
                ))}
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-3 py-8 text-sm text-steel">
                      Este torneo todavía no tiene posiciones calculadas.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}
