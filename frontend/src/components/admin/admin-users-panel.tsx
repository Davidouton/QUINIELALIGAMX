"use client";

import { useEffect, useState } from "react";

import { backendFetch } from "@/lib/api/backend";
import { getBrowserAccessToken } from "@/lib/supabase/session";
import type { AdminUser, Me, Season } from "@/types/api";

const squareActionButtonClass =
  "inline-flex h-8 w-full items-center justify-center whitespace-nowrap rounded-[12px] border px-3 text-[10px] font-semibold tracking-[0.02em] transition disabled:opacity-60";

const actionNeutralClass =
  `${squareActionButtonClass} border-white/[0.04] bg-white/[0.03] text-ink hover:border-white/[0.08] hover:bg-white/[0.05]`;

const actionPositiveClass =
  `${squareActionButtonClass} border-emerald-300/30 bg-emerald-400/16 text-emerald-50 hover:border-emerald-300/45 hover:bg-emerald-400/22`;

const actionDangerClass =
  `${squareActionButtonClass} border-red-300/35 bg-red-500/16 text-red-50 hover:border-red-300/50 hover:bg-red-500/24`;

function getTrafficTextClass(isPositive: boolean) {
  return isPositive ? "text-emerald-100" : "text-rose-100";
}

function getMembershipStateLabel(isActive?: boolean | null) {
  return isActive ? "Alta" : "Fuera";
}

function getPaymentStateLabel(isPaid?: boolean | null) {
  return isPaid ? "Pagado" : "Pend.";
}

function getScoringStateLabel(canScore?: boolean | null) {
  return canScore ? "Cuenta" : "No";
}

function getRoleLabel(roleCode: string) {
  if (roleCode === "master_admin") {
    return "Super Admin";
  }
  if (roleCode === "admin") {
    return "Admin";
  }
  return "Usuario";
}

function getRoleTableLabel(roleCode: string) {
  if (roleCode === "master_admin") {
    return "SAdmin";
  }
  if (roleCode === "admin") {
    return "Admin";
  }
  return "Usuario";
}

function getModalityLabel(modality: string) {
  return modality === "aval" ? "Aval" : "Pre-pago";
}

function getThemeLabel(themePreference: string) {
  return themePreference === "favorite_team" ? "Equipo" : "Estandar";
}

export function AdminUsersPanel() {
  const [me, setMe] = useState<Me | null>(null);
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [selectedSeasonId, setSelectedSeasonId] = useState("");
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function loadUsers(seasonId: string, accessToken?: string) {
    const token = accessToken ?? (await getBrowserAccessToken());
    const suffix = seasonId ? `?season_id=${seasonId}` : "";
    const rows = await backendFetch<AdminUser[]>(`/admin/users${suffix}`, token);
    setUsers(rows);
  }

  async function loadPanel() {
    const accessToken = await getBrowserAccessToken();
    const [meResponse, seasonRows] = await Promise.all([
      backendFetch<Me>("/me", accessToken),
      backendFetch<Season[]>("/seasons", accessToken),
    ]);
    setMe(meResponse);
    const defaultSeasonId = seasonRows.find((season) => season.is_active)?.id ?? seasonRows[0]?.id ?? "";
    setSeasons(seasonRows);
    setSelectedSeasonId(defaultSeasonId);
    await loadUsers(defaultSeasonId, accessToken);
  }

  useEffect(() => {
    async function runLoad() {
      try {
        await loadPanel();
      } catch (caughtError) {
        setError(caughtError instanceof Error ? caughtError.message : "No se pudieron cargar los usuarios");
      } finally {
        setLoading(false);
      }
    }

    void runLoad();
  }, []);

  async function handleSeasonChange(seasonId: string) {
    setSelectedSeasonId(seasonId);
    setError(null);
    setMessage(null);
    setLoading(true);
    try {
      await loadUsers(seasonId);
    } catch (caughtError) {
      setError(
        caughtError instanceof Error ? caughtError.message : "No se pudieron cargar los usuarios del torneo",
      );
    } finally {
      setLoading(false);
    }
  }

  async function handleToggleAccess(user: AdminUser) {
    setSavingKey(`access:${user.id}`);
    setError(null);
    setMessage(null);
    try {
      const accessToken = await getBrowserAccessToken();
      await backendFetch<AdminUser>(`/admin/users/${user.id}/access`, accessToken, {
        method: "PUT",
        body: JSON.stringify({ is_active: !user.is_active }),
      });
      await loadUsers(selectedSeasonId, accessToken);
      setMessage(`${user.display_name}: acceso ${user.is_active ? "desactivado" : "activado"}.`);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "No se pudo actualizar el acceso");
    } finally {
      setSavingKey(null);
    }
  }

  async function handleToggleMembership(user: AdminUser) {
    const membership = user.selected_season_membership;
    if (!selectedSeasonId) {
      setError("Selecciona un torneo primero.");
      return;
    }

    const nextIsActive = !(membership?.is_active ?? false);
    const nextIsPaid = membership?.is_paid ?? false;

    setSavingKey(`membership:${user.id}`);
    setError(null);
    setMessage(null);
    try {
      const accessToken = await getBrowserAccessToken();
      await backendFetch<AdminUser>(`/admin/users/${user.id}/season-membership`, accessToken, {
        method: "PUT",
        body: JSON.stringify({
          season_id: selectedSeasonId,
          is_active: nextIsActive,
          is_paid: nextIsPaid,
          notes: membership?.notes ?? null,
        }),
      });
      await loadUsers(selectedSeasonId, accessToken);
      setMessage(
        `${user.display_name}: ${
          nextIsActive ? "dado de alta en el torneo" : "removido del torneo"
        }.`,
      );
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "No se pudo actualizar la membresia");
    } finally {
      setSavingKey(null);
    }
  }

  async function handleTogglePayment(user: AdminUser) {
    const membership = user.selected_season_membership;
    if (!selectedSeasonId) {
      setError("Selecciona un torneo primero.");
      return;
    }

    setSavingKey(`payment:${user.id}`);
    setError(null);
    setMessage(null);
    try {
      const accessToken = await getBrowserAccessToken();
      await backendFetch<AdminUser>(`/admin/users/${user.id}/season-membership`, accessToken, {
        method: "PUT",
        body: JSON.stringify({
          season_id: selectedSeasonId,
          is_active: membership?.is_active ?? false,
          is_paid: !(membership?.is_paid ?? false),
          notes: membership?.notes ?? null,
        }),
      });
      await loadUsers(selectedSeasonId, accessToken);
      setMessage(
        `${user.display_name}: pago ${(membership?.is_paid ?? false) ? "marcado pendiente" : "confirmado"}.`,
      );
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "No se pudo actualizar el pago");
    } finally {
      setSavingKey(null);
    }
  }

  async function handleToggleAdmin(user: AdminUser) {
    const nextRole = user.role_code === "user" ? "admin" : "user";

    setSavingKey(`role:${user.id}`);
    setError(null);
    setMessage(null);
    try {
      const accessToken = await getBrowserAccessToken();
      await backendFetch<AdminUser>(`/admin/users/${user.id}/role`, accessToken, {
        method: "PATCH",
        body: JSON.stringify({ role_code: nextRole }),
      });
      await loadUsers(selectedSeasonId, accessToken);
      setMessage(
        `${user.display_name}: rol actualizado a ${nextRole === "admin" ? "admin" : "usuario"}.`,
      );
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "No se pudo actualizar el rol");
    } finally {
      setSavingKey(null);
    }
  }

  const selectedSeason = seasons.find((season) => season.id === selectedSeasonId) ?? null;
  const activeCount = users.filter((user) => user.selected_season_membership?.is_active).length;
  const paidCount = users.filter((user) => user.selected_season_membership?.is_paid).length;
  const appAccessCount = users.filter((user) => user.is_active).length;
  const normalizedSearch = searchTerm.trim().toLowerCase();
  const filteredUsers = users.filter((user) => {
    if (!normalizedSearch) {
      return true;
    }

    const membership = user.selected_season_membership;
    const haystack = [
      user.display_name,
      user.email ?? "",
      user.favorite_team_name ?? "",
      user.contact_phone ?? "",
      user.deposit_account ?? "",
      user.aval_display_name ?? "",
      getModalityLabel(user.modality),
      getThemeLabel(user.theme_preference),
      user.role_code,
      getRoleLabel(user.role_code),
      membership?.is_active ? "activo" : "sin alta",
      membership?.is_paid ? "pagado" : "pendiente",
      user.is_active ? "app activa" : "app bloqueada",
    ]
      .join(" ")
      .toLowerCase();

    return haystack.includes(normalizedSearch);
  });

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-[0.22em] text-ink">
              Accesos por temporada
            </h2>
          </div>
        </div>

        {message ? <p className="mt-4 text-sm text-moss">{message}</p> : null}
        {error ? <p className="mt-4 text-sm text-coral">{error}</p> : null}
      </section>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="px-4 py-3">
          <p className="text-[10px] uppercase tracking-[0.22em] text-steel">Torneo seleccionado</p>
          <p className="mt-2 text-lg font-semibold text-ink">{selectedSeason?.name ?? "Sin torneo"}</p>
        </div>
        <div className="px-4 py-3">
          <p className="text-[10px] uppercase tracking-[0.22em] text-steel">Con acceso a la app</p>
          <p className="mt-2 text-lg font-semibold text-ink">{appAccessCount}</p>
        </div>
        <div className="px-4 py-3">
          <p className="text-[10px] uppercase tracking-[0.22em] text-steel">Alta en torneo / pagados</p>
          <p className="mt-2 text-lg font-semibold text-ink">
            {activeCount} / {paidCount}
          </p>
        </div>
      </div>

      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h3 className="text-sm font-semibold uppercase tracking-[0.22em] text-ink">
              Usuarios registrados
            </h3>
          </div>
          <p className="text-sm text-steel">
            {filteredUsers.length} de {users.length} usuarios
          </p>
        </div>

        {loading ? <p className="mt-4 text-sm text-steel">Cargando usuarios...</p> : null}
        {!loading && users.length === 0 ? (
          <p className="mt-4 text-sm text-steel">Todavia no hay usuarios registrados.</p>
        ) : null}

        {users.length > 0 ? (
          <div className="no-scrollbar overflow-x-auto touch-pan-x">
            <div className="grid gap-3 px-2 py-3 lg:grid-cols-[minmax(0,300px)_minmax(0,300px)] lg:justify-between">
              <label className="space-y-2 text-left text-sm">
                <span className="text-steel">Buscar dentro de la tabla</span>
                <input
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  placeholder="Nombre, correo, rol o estatus"
                  className="field-control"
                />
              </label>
              <label className="space-y-2 text-left text-sm">
                <span className="text-steel">Temporada</span>
                <select
                  value={selectedSeasonId}
                  onChange={(event) => void handleSeasonChange(event.target.value)}
                  className="field-control"
                  disabled={loading || seasons.length === 0}
                >
                  <option value="" disabled>
                    {loading ? "Cargando..." : "Selecciona torneo"}
                  </option>
                  {seasons.map((season) => (
                    <option key={season.id} value={season.id}>
                      {season.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="px-2 pb-2 text-[10px] text-steel/80">
              Roles: Usuario / Admin / SAdmin
            </div>
            <table className="min-w-[910px] table-fixed text-center text-[11px] text-steel">
              <colgroup>
                <col className="w-[156px]" />
                <col className="w-[92px]" />
                <col className="w-[78px]" />
                <col className="w-[78px]" />
                <col className="w-[84px]" />
                <col className="w-[88px]" />
                <col className="w-[360px]" />
              </colgroup>
              <thead className="text-[10px] uppercase tracking-[0.18em] text-steel/85">
                <tr>
                  <th className="sticky left-0 z-20 bg-[rgba(9,20,37,0.68)] px-2 py-2 text-left font-medium backdrop-blur-[1px]">
                    Usuario
                  </th>
                  <th className="px-1 py-2 font-medium">Rol</th>
                  <th className="px-1 py-2 font-medium">App</th>
                  <th className="px-1 py-2 font-medium">Torneo</th>
                  <th className="px-1 py-2 font-medium">Pago</th>
                  <th className="px-1 py-2 font-medium">Puntua</th>
                  <th className="px-2 py-2 font-medium">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.map((user) => {
                  const membership = user.selected_season_membership;
                  const canManageRole =
                    me?.role_code === "master_admin" ||
                    (me?.role_code === "admin" && user.role_code !== "master_admin");
                  const roleActionClass = user.role_code === "user" ? actionPositiveClass : actionDangerClass;
                  const accessActionClass = user.is_active ? actionDangerClass : actionPositiveClass;
                  const paymentActionClass = membership?.is_paid ? actionDangerClass : actionPositiveClass;
                  const membershipActionClass = membership?.is_active ? actionDangerClass : actionPositiveClass;

                  return (
                    <tr key={user.id}>
                      <td className="sticky left-0 z-10 bg-[rgba(9,20,37,0.68)] px-2 py-2 text-left align-top backdrop-blur-[1px]">
                        <p className="truncate font-medium text-ink">{user.display_name}</p>
                        <p className="mt-1 truncate text-[10px] text-steel">{user.email ?? "Sin correo"}</p>
                      </td>
                      <td className="px-1 py-2 align-top">
                        <span className={`inline-flex px-2 py-1 text-[10px] font-semibold uppercase ${getTrafficTextClass(
                          user.role_code === "master_admin" || user.role_code === "admin",
                        )}`}>
                          {getRoleTableLabel(user.role_code)}
                        </span>
                      </td>
                      <td className="px-1 py-2 align-top">
                        <span className={`inline-flex px-2 py-1 text-[10px] font-semibold uppercase ${getTrafficTextClass(user.is_active)}`}>
                          {user.is_active ? "Activa" : "Bloq."}
                        </span>
                      </td>
                      <td className="px-1 py-2 align-top">
                        <span className={`inline-flex px-2 py-1 text-[10px] font-semibold uppercase ${getTrafficTextClass(Boolean(membership?.is_active))}`}>
                          {getMembershipStateLabel(membership?.is_active)}
                        </span>
                      </td>
                      <td className="px-1 py-2 align-top">
                        <span className={`inline-flex px-2 py-1 text-[10px] font-semibold uppercase ${getTrafficTextClass(Boolean(membership?.is_paid))}`}>
                          {getPaymentStateLabel(membership?.is_paid)}
                        </span>
                      </td>
                      <td className="px-1 py-2 align-top">
                        <span className={`inline-flex px-2 py-1 text-[10px] font-semibold uppercase ${getTrafficTextClass(
                          Boolean(membership?.eligible_for_scoring),
                        )}`}>
                          {getScoringStateLabel(membership?.eligible_for_scoring)}
                        </span>
                      </td>
                      <td className="px-2 py-2 align-top">
                        <div className="flex flex-nowrap items-center gap-2 text-left">
                          {canManageRole ? (
                            <button
                              type="button"
                              onClick={() => void handleToggleAdmin(user)}
                              disabled={savingKey === `role:${user.id}`}
                              className={roleActionClass}
                              title={user.role_code === "user" ? "Dar permisos de admin" : "Quitar permisos de admin"}
                            >
                              {savingKey === `role:${user.id}`
                                ? "..."
                                : user.role_code === "user"
                                  ? "Dar admin"
                                  : "Quitar admin"}
                            </button>
                          ) : null}
                          <button
                            type="button"
                            onClick={() => void handleToggleAccess(user)}
                            disabled={savingKey === `access:${user.id}`}
                            className={accessActionClass}
                            title={user.is_active ? "Bloquear acceso a la app" : "Activar acceso a la app"}
                          >
                            {savingKey === `access:${user.id}`
                              ? "..."
                              : user.is_active
                                ? "Bloquear"
                                : "Activar"}
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleTogglePayment(user)}
                            disabled={savingKey === `payment:${user.id}` || !selectedSeasonId}
                            className={paymentActionClass}
                            title={membership?.is_paid ? "Marcar pago pendiente" : "Marcar pago como confirmado"}
                          >
                            {savingKey === `payment:${user.id}`
                              ? "..."
                              : membership?.is_paid
                                ? "Pago pend."
                                : "Marcar pag."}
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleToggleMembership(user)}
                            disabled={savingKey === `membership:${user.id}` || !selectedSeasonId}
                            className={membershipActionClass}
                            title={membership?.is_active ? "Quitar del torneo" : "Dar de alta en el torneo"}
                          >
                            {savingKey === `membership:${user.id}`
                              ? "..."
                              : membership?.is_active
                                ? "Quitar"
                                : "Dar alta"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {filteredUsers.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-sm text-steel">
                      No hubo coincidencias para ese filtro.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
    </div>
  );
}
