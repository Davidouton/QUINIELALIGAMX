"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { backendFetch } from "@/lib/api/backend";
import { getBrowserAccessToken } from "@/lib/supabase/session";
import type { AdminUser, AdminVipCompetition, Season } from "@/types/api";

type Props = { userId: string };

type DetailMembershipRow = {
  id: string;
  type: "Quiniela" | "Survivor" | "VIP";
  name: string;
  status: string;
  detail: string;
  archived: boolean;
  seasonId: string | null;
  isActive: boolean;
};

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("es-MX", {
    timeZone: "America/Mexico_City",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function AdminUserDetailPanel({ userId }: Props) {
  const router = useRouter();
  const [user, setUser] = useState<AdminUser | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [vipCompetitions, setVipCompetitions] = useState<AdminVipCompetition[]>([]);
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [savingMembershipId, setSavingMembershipId] = useState<string | null>(null);

  async function loadUserData() {
    const token = await getBrowserAccessToken();
    const [userRows, vips, seasonRows] = await Promise.all([
      backendFetch<AdminUser[]>("/admin/users", token),
      backendFetch<AdminVipCompetition[]>("/admin/vip", token).catch(() => []),
      backendFetch<Season[]>("/seasons", token).catch(() => []),
    ]);
    setUsers(userRows.sort((left, right) => left.display_name.localeCompare(right.display_name, "es-MX")));
    setUser(userRows.find((row) => row.id === userId) ?? null);
    setVipCompetitions(vips);
    setSeasons(seasonRows);
  }

  useEffect(() => {
    async function load() {
      try {
        await loadUserData();
      } catch (caughtError) {
        setError(caughtError instanceof Error ? caughtError.message : "No se pudo cargar el usuario");
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, [userId]);

  const vipMemberships = useMemo(
    () =>
      vipCompetitions.flatMap((vip) =>
        vip.memberships
          .filter((membership) => membership.profile_id === userId)
          .map((membership) => ({ vip, membership })),
      ),
    [userId, vipCompetitions],
  );

  const seasonById = useMemo(() => new Map(seasons.map((season) => [season.id, season])), [seasons]);
  const membershipRows = useMemo<DetailMembershipRow[]>(() => {
    if (!user) return [];
    return [
      ...user.season_memberships.map((membership) => ({
        id: `quiniela-${membership.season_id}`,
        type: "Quiniela" as const,
        name: membership.season_name,
        status: membership.is_active ? "Activa" : "Inactiva",
        detail: membership.is_paid ? "Pagada" : "Pago pendiente",
        archived: seasonById.get(membership.season_id)?.visibility_status === "archived",
        seasonId: membership.season_id,
        isActive: membership.is_active,
      })),
      ...user.survivor_memberships.map((membership) => ({
        id: `survivor-${membership.season_id}`,
        type: "Survivor" as const,
        name: membership.season_name,
        status: membership.is_active ? "Activa" : "Inactiva",
        detail: `Alta ${formatDate(membership.joined_at)}`,
        archived: seasonById.get(membership.season_id)?.visibility_status === "archived",
        seasonId: membership.season_id,
        isActive: membership.is_active,
      })),
      ...vipMemberships.map(({ vip, membership }) => ({
        id: `vip-${membership.id}`,
        type: "VIP" as const,
        name: vip.name,
        status: membership.status,
        detail: `${vip.season_name} · ${membership.is_paid ? "Pagada" : "Pago pendiente"}`,
        archived: seasonById.get(vip.season_id)?.visibility_status === "archived",
        seasonId: vip.season_id,
        isActive: membership.status === "approved",
      })),
    ];
  }, [seasonById, user, vipMemberships]);
  const currentUserIndex = users.findIndex((row) => row.id === userId);
  const previousUser = currentUserIndex > 0 ? users[currentUserIndex - 1] : null;
  const nextUser = currentUserIndex >= 0 && currentUserIndex < users.length - 1 ? users[currentUserIndex + 1] : null;
  const activeMemberships = membershipRows.filter((row) => !row.archived && row.isActive);
  const inactiveMemberships = membershipRows.filter((row) => !row.archived && !row.isActive);
  const archivedMemberships = membershipRows.filter((row) => row.archived);

  async function handleToggleMembership(membership: DetailMembershipRow) {
    if (!membership.seasonId || membership.type === "VIP") return;
    setSavingMembershipId(membership.id);
    setError(null);
    setMessage(null);
    try {
      const token = await getBrowserAccessToken();
      if (membership.type === "Quiniela") {
        const currentMembership = user?.season_memberships.find((row) => row.season_id === membership.seasonId);
        await backendFetch(`/admin/users/${userId}/season-membership`, token, {
          method: "PUT",
          body: JSON.stringify({
            season_id: membership.seasonId,
            is_active: !membership.isActive,
            is_paid: currentMembership?.is_paid ?? false,
            notes: currentMembership?.notes ?? null,
          }),
        });
      } else {
        await backendFetch(`/admin/users/${userId}/survivor-membership`, token, {
          method: "PUT",
          body: JSON.stringify({ season_id: membership.seasonId, is_active: !membership.isActive }),
        });
      }
      await loadUserData();
      setMessage(`${membership.name}: ${membership.isActive ? "membresía removida" : "membresía activada"}.`);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "No se pudo actualizar la membresía");
    } finally {
      setSavingMembershipId(null);
    }
  }

  if (loading) return <p className="text-sm text-steel">Cargando usuario...</p>;
  if (error) return <p className="text-sm text-coral">{error}</p>;
  if (!user) return <p className="text-sm text-coral">Usuario no encontrado.</p>;

  return (
    <div className="space-y-10">
      <header className="border-b border-white/10 pb-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <Link href="/dashboard/admin/user-info" className="text-sm font-semibold text-steel transition hover:text-ink">
            Volver a usuarios
          </Link>
          <div className="flex items-center gap-4">
            <Link href={previousUser ? `/dashboard/admin/user-info/${previousUser.id}` : "#"} aria-disabled={!previousUser} className={`text-sm font-semibold transition ${previousUser ? "text-ink hover:text-[#4f7df3]" : "pointer-events-none text-steel/40"}`}>
              Anterior
            </Link>
            <select value={userId} onChange={(event) => router.push(`/dashboard/admin/user-info/${event.target.value}`)} className="field-control min-w-[240px]">
              {users.map((row) => <option key={row.id} value={row.id}>{row.display_name}</option>)}
            </select>
            <Link href={nextUser ? `/dashboard/admin/user-info/${nextUser.id}` : "#"} aria-disabled={!nextUser} className={`text-sm font-semibold transition ${nextUser ? "text-ink hover:text-[#4f7df3]" : "pointer-events-none text-steel/40"}`}>
              Siguiente
            </Link>
          </div>
        </div>
        <h1 className="mt-5 text-3xl font-semibold text-ink">{user.display_name}</h1>
        <p className="mt-2 text-sm text-steel">{user.username ? `@${user.username} · ` : ""}{user.email ?? "Sin correo"}</p>
      </header>

      {message ? <p className="border-l-2 border-mint px-3 text-sm text-mint">{message}</p> : null}

      <section className="grid gap-x-10 gap-y-5 border-b border-white/10 pb-7 sm:grid-cols-2 lg:grid-cols-4">
        <div><p className="text-xs uppercase tracking-[0.18em] text-steel">Cuenta</p><p className="mt-2 font-semibold text-ink">{user.is_active ? "Activa" : "Bloqueada"}</p></div>
        <div><p className="text-xs uppercase tracking-[0.18em] text-steel">Modalidad</p><p className="mt-2 font-semibold text-ink">{user.modality === "aval" ? "Aval" : "Pre-pago"}</p></div>
        <div><p className="text-xs uppercase tracking-[0.18em] text-steel">Aval</p><p className="mt-2 font-semibold text-ink">{user.aval_display_name ?? "No aplica"}</p></div>
        <div><p className="text-xs uppercase tracking-[0.18em] text-steel">Alta</p><p className="mt-2 font-semibold text-ink">{formatDate(user.created_at)}</p></div>
      </section>

      <MembershipSection title="Membresías activas" empty="Sin membresías activas">
        {activeMemberships.map((membership) => (
          <MembershipRow key={membership.id} membership={membership} saving={savingMembershipId === membership.id} onToggle={handleToggleMembership} />
        ))}
      </MembershipSection>

      <MembershipSection title="Inactivas" empty="Sin membresías inactivas">
        {inactiveMemberships.map((membership) => (
          <MembershipRow key={membership.id} membership={membership} saving={savingMembershipId === membership.id} onToggle={handleToggleMembership} />
        ))}
      </MembershipSection>

      <MembershipSection title="Archivadas" empty="Sin membresías archivadas">
        {archivedMemberships.map((membership) => (
          <MembershipRow key={membership.id} membership={membership} saving={false} onToggle={handleToggleMembership} />
        ))}
      </MembershipSection>
    </div>
  );
}

function MembershipSection({ title, empty, children }: { title: string; empty: string; children: ReactNode }) {
  const rows = Array.isArray(children) ? children : [children];
  const hasRows = rows.some(Boolean);
  return (
    <section>
      <h2 className="text-sm font-semibold uppercase tracking-[0.22em] text-steel">{title}</h2>
      <div className="mt-4 border-y border-white/10 divide-y divide-white/10">
        {hasRows ? children : <p className="py-5 text-sm text-steel">{empty}</p>}
      </div>
    </section>
  );
}

function MembershipRow({ membership, saving, onToggle }: { membership: DetailMembershipRow; saving: boolean; onToggle: (membership: DetailMembershipRow) => Promise<void> }) {
  return (
    <div className="grid gap-2 py-4 sm:grid-cols-[110px_minmax(0,1fr)_120px_190px_110px] sm:items-center">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-steel">{membership.type}</p>
      <p className="font-semibold text-ink">{membership.name}</p>
      <p className={membership.isActive ? "text-sm font-semibold text-mint" : "text-sm text-steel"}>{membership.status}</p>
      <p className="text-sm text-steel">{membership.detail}</p>
      <div className="sm:text-right">
        {!membership.archived && membership.type !== "VIP" ? (
          <button
            type="button"
            onClick={() => void onToggle(membership)}
            disabled={saving}
            className={membership.isActive ? "text-sm font-semibold text-coral" : "text-sm font-semibold text-[#4f7df3]"}
          >
            {saving ? "Guardando..." : membership.isActive ? "Quitar" : "Dar alta"}
          </button>
        ) : (
          <span className="text-sm text-steel">—</span>
        )}
      </div>
    </div>
  );
}
