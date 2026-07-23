"use client";

import { useEffect, useMemo, useState } from "react";

import { backendFetch } from "@/lib/api/backend";
import { getBrowserAccessToken } from "@/lib/supabase/session";
import type { AdminUser, AdminVipCompetition, VipLeaderboardEntry, VipMembership } from "@/types/api";

type VipRankingRow = VipLeaderboardEntry & {
  user: AdminUser | null;
  membership: VipMembership | null;
};

function formatMoney(value: number) {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    maximumFractionDigits: 2,
  }).format(value);
}

function formatNetPayment(value: number) {
  if (value > 0) return `Recibe ${formatMoney(value)}`;
  if (value < 0) return `Paga ${formatMoney(Math.abs(value))}`;
  return formatMoney(0);
}

function getModalityLabel(modality: string | null | undefined) {
  return modality === "aval" ? "Aval" : "Pre-pago";
}

function escapeCsv(value: string | number | null | undefined) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

function slugify(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function AdminVipFinalRankingPanel() {
  const [vips, setVips] = useState<AdminVipCompetition[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [selectedVipId, setSelectedVipId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const accessToken = await getBrowserAccessToken();
        const [vipRows, userRows] = await Promise.all([
          backendFetch<AdminVipCompetition[]>("/admin/vip?include_leaderboard=true", accessToken),
          backendFetch<AdminUser[]>("/admin/users", accessToken),
        ]);
        setVips(vipRows);
        setUsers(userRows);
        setSelectedVipId(vipRows.find((vip) => vip.is_active)?.id ?? vipRows[0]?.id ?? "");
      } catch (caughtError) {
        setError(caughtError instanceof Error ? caughtError.message : "No se pudieron cargar los rankings VIP");
      } finally {
        setLoading(false);
      }
    }

    void load();
  }, []);

  const selectedVip = vips.find((vip) => vip.id === selectedVipId) ?? null;
  const rows = useMemo<VipRankingRow[]>(() => {
    if (!selectedVip) return [];
    const usersById = new Map(users.map((user) => [user.id, user]));
    const membershipsByProfileId = new Map(selectedVip.memberships.map((membership) => [membership.profile_id, membership]));
    return selectedVip.leaderboard.map((entry) => ({
      ...entry,
      user: usersById.get(entry.profile_id) ?? null,
      membership: membershipsByProfileId.get(entry.profile_id) ?? null,
    }));
  }, [selectedVip, users]);

  function getPrize(rankPosition: number) {
    if (!selectedVip) return 0;
    let positionPrize = 0;
    if (rankPosition === 1) positionPrize = selectedVip.first_place_amount;
    else if (rankPosition === 2) positionPrize = selectedVip.second_place_amount;
    else if (rankPosition === 3) positionPrize = selectedVip.third_place_amount;
    const tiedPlayers = rows.filter((row) => row.rank_position === rankPosition).length;
    return positionPrize / Math.max(tiedPlayers, 1);
  }

  function getPendingBalance(row: VipRankingRow) {
    return row.membership?.is_paid ? 0 : (selectedVip?.entry_fee_amount ?? 0);
  }

  function downloadRanking() {
    if (!selectedVip) return;
    const headers = [
      "posicion", "jugador", "username", "profile_id", "puntos", "resultados_correctos", "marcadores_exactos", "tipo_membresia",
      "aval", "costo_entrada", "estado_pago", "saldo_por_pagar", "premio_final", "pago_neto", "telefono",
      "banco", "numero_cuenta",
    ];
    const csvRows = rows.map((row) => {
      const pendingBalance = getPendingBalance(row);
      const prize = getPrize(row.rank_position);
      return [
        row.rank_position, row.display_name, row.username ?? row.user?.username ?? "", row.profile_id,
        row.total_points, row.correct_results, row.exact_scores,
        getModalityLabel(row.user?.modality), row.user?.aval_display_name ?? "", selectedVip.entry_fee_amount,
        row.membership?.is_paid ? "Pagado" : "Pendiente", pendingBalance, prize, prize - pendingBalance,
        row.user?.contact_phone ?? "", row.user?.bank_name ?? "", row.user?.deposit_account ?? "",
      ];
    });
    const csv = [headers, ...csvRows].map((row) => row.map(escapeCsv).join(",")).join("\r\n");
    const blob = new Blob([`\ufeff${csv}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `ranking-final-vip-${slugify(selectedVip.name) || "vip"}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="space-y-4 border-t border-white/[0.08] pt-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-ink">Ranking final VIP</h2>
          <p className="mt-1 text-sm text-steel">Cierre, cobro y premios de competencias VIP.</p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <label className="block min-w-[280px] space-y-2 text-sm">
            <span className="text-steel">VIP</span>
            <select value={selectedVipId} onChange={(event) => setSelectedVipId(event.target.value)} className="field-control">
              {vips.map((vip) => <option key={vip.id} value={vip.id}>{vip.name}</option>)}
            </select>
          </label>
          <button type="button" onClick={downloadRanking} disabled={!selectedVip || rows.length === 0} className="app-pill h-11 px-4 disabled:opacity-50">
            Descargar CSV
          </button>
        </div>
      </div>

      {loading ? <p className="text-sm text-steel">Cargando rankings VIP...</p> : null}
      {error ? <p className="text-sm text-coral">{error}</p> : null}
      {!loading && !error ? (
        <div className="android-scroll-x">
          <table className="min-w-[1670px] w-full table-fixed text-left text-[11px] text-ink">
            <thead className="app-table-head">
              <tr>
                {[
                  "Pos.", "Jugador", "Puntos", "Membresía", "Aval", "Entrada", "Pago", "Por pagar",
                  "Premio final", "Pago neto", "Teléfono", "Banco", "Número de cuenta",
                ].map((label) => <th key={label} className="px-3 py-3">{label}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const pendingBalance = getPendingBalance(row);
                const prize = getPrize(row.rank_position);
                return (
                  <tr key={row.profile_id} className="app-table-row border-b last:border-b-0">
                    <td className="px-3 py-3 font-semibold">#{row.rank_position}</td>
                    <td className="px-3 py-3 font-medium">
                      <span className="block">{row.display_name}</span>
                      {(row.username ?? row.user?.username) ? <span className="text-xs font-normal text-steel">@{row.username ?? row.user?.username}</span> : null}
                    </td>
                    <td className="px-3 py-3 font-semibold">{row.total_points}</td>
                    <td className="px-3 py-3 text-steel">{getModalityLabel(row.user?.modality)}</td>
                    <td className="px-3 py-3 text-steel">{row.user?.aval_display_name ?? "-"}</td>
                    <td className="px-3 py-3 text-steel">{formatMoney(selectedVip?.entry_fee_amount ?? 0)}</td>
                    <td className="px-3 py-3 text-steel">{row.membership?.is_paid ? "Pagado" : "Pendiente"}</td>
                    <td className="px-3 py-3 font-medium">{formatMoney(pendingBalance)}</td>
                    <td className="px-3 py-3 font-semibold">{formatMoney(prize)}</td>
                    <td className="px-3 py-3 font-semibold">{formatNetPayment(prize - pendingBalance)}</td>
                    <td className="px-3 py-3 text-steel">{row.user?.contact_phone ?? "-"}</td>
                    <td className="px-3 py-3 text-steel">{row.user?.bank_name ?? "-"}</td>
                    <td className="px-3 py-3 text-steel">{row.user?.deposit_account ?? "-"}</td>
                  </tr>
                );
              })}
              {rows.length === 0 ? (
                <tr><td colSpan={13} className="px-3 py-8 text-sm text-steel">Esta VIP todavía no tiene posiciones calculadas.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
