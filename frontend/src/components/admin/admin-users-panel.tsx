"use client";

import { useEffect, useState } from "react";

import { backendFetch } from "@/lib/api/backend";
import { getBrowserAccessToken } from "@/lib/supabase/session";
import { getThemePreferenceLabel } from "@/lib/theme/app-theme";
import type { AdminUser, Me, Season } from "@/types/api";

type BillingDraft = {
  modality: string;
  aval_profile_id: string;
};

type PasswordDraft = {
  password: string;
};

type BulkImportRow = {
  row_number: number;
  email: string | null;
  display_name: string | null;
  status: string;
  detail: string | null;
};

type BulkImportResponse = {
  created_or_updated: number;
  failed: number;
  rows: BulkImportRow[];
};

type NewUserDraft = {
  email: string;
  display_name: string;
  password: string;
  is_paid: boolean;
  modality: string;
  aval_profile_id: string;
  notes: string;
};

const initialNewUserDraft: NewUserDraft = {
  email: "",
  display_name: "",
  password: "",
  is_paid: false,
  modality: "pre_pago",
  aval_profile_id: "",
  notes: "",
};

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

export function AdminUsersPanel() {
  const [me, setMe] = useState<Me | null>(null);
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [selectedSeasonId, setSelectedSeasonId] = useState("");
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [billingDrafts, setBillingDrafts] = useState<Record<string, BillingDraft>>({});
  const [passwordDrafts, setPasswordDrafts] = useState<Record<string, PasswordDraft>>({});
  const [newUserDraft, setNewUserDraft] = useState<NewUserDraft>(initialNewUserDraft);
  const [bulkCsv, setBulkCsv] = useState("");
  const [bulkSendInvites, setBulkSendInvites] = useState(false);
  const [bulkResult, setBulkResult] = useState<BulkImportResponse | null>(null);
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
    setBillingDrafts(
      Object.fromEntries(
        rows.map((user) => [
          user.id,
          {
            modality: user.modality ?? "pre_pago",
            aval_profile_id: user.aval_profile_id ?? "",
          },
        ]),
      ),
    );
    setPasswordDrafts(
      Object.fromEntries(rows.map((user) => [user.id, { password: "" }])),
    );
  }

  async function loadPanel() {
    const accessToken = await getBrowserAccessToken();
    const [meResponse, seasonRows] = await Promise.all([
      backendFetch<Me>("/me", accessToken),
      backendFetch<Season[]>("/seasons", accessToken),
    ]);
    setMe(meResponse);
    const worldCupSeasons = seasonRows.filter((season) => season.tournament_format === "world_cup");
    const visibleSeasons = worldCupSeasons.length > 0 ? worldCupSeasons : seasonRows;
    const defaultSeasonId = visibleSeasons.find((season) => season.is_active)?.id ?? visibleSeasons[0]?.id ?? "";
    setSeasons(visibleSeasons);
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

  function updateBillingDraft(userId: string, patch: Partial<BillingDraft>) {
    setBillingDrafts((current) => ({
      ...current,
      [userId]: {
        modality: current[userId]?.modality ?? "pre_pago",
        aval_profile_id: current[userId]?.aval_profile_id ?? "",
        ...patch,
      },
    }));
  }

  function updatePasswordDraft(userId: string, patch: Partial<PasswordDraft>) {
    setPasswordDrafts((current) => ({
      ...current,
      [userId]: {
        password: current[userId]?.password ?? "",
        ...patch,
      },
    }));
  }

  function updateNewUserDraft(patch: Partial<NewUserDraft>) {
    setNewUserDraft((current) => ({
      ...current,
      ...patch,
    }));
  }

  async function handleCreateUser() {
    if (!selectedSeasonId) {
      setError("Selecciona un torneo primero.");
      return;
    }
    if (!newUserDraft.email.trim() || !newUserDraft.display_name.trim()) {
      setError("Captura nombre y correo del usuario.");
      return;
    }
    if (newUserDraft.modality === "aval" && !newUserDraft.aval_profile_id) {
      setError("Selecciona un aval para crear usuario con modalidad aval.");
      return;
    }

    setSavingKey("create-user");
    setError(null);
    setMessage(null);
    try {
      const accessToken = await getBrowserAccessToken();
      const createdUser = await backendFetch<AdminUser>("/admin/users", accessToken, {
        method: "POST",
        body: JSON.stringify({
          email: newUserDraft.email.trim(),
          display_name: newUserDraft.display_name.trim(),
          password: newUserDraft.password.trim() || null,
          season_id: selectedSeasonId,
          is_active: true,
          is_paid: newUserDraft.is_paid,
          modality: newUserDraft.modality,
          aval_profile_id: newUserDraft.modality === "aval" ? newUserDraft.aval_profile_id : null,
          notes: newUserDraft.notes.trim() || null,
        }),
      });
      setNewUserDraft(initialNewUserDraft);
      await loadUsers(selectedSeasonId, accessToken);
      setMessage(`${createdUser.display_name}: usuario creado y alta enviada para ${selectedSeason?.name ?? "el torneo"}.`);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "No se pudo crear el usuario");
    } finally {
      setSavingKey(null);
    }
  }

  async function handleSaveBilling(user: AdminUser) {
    const draft = billingDrafts[user.id] ?? {
      modality: user.modality ?? "pre_pago",
      aval_profile_id: user.aval_profile_id ?? "",
    };

    if (draft.modality === "aval" && !draft.aval_profile_id) {
      setError("Selecciona un aval antes de guardar la modalidad aval.");
      return;
    }

    setSavingKey(`billing:${user.id}`);
    setError(null);
    setMessage(null);
    try {
      const accessToken = await getBrowserAccessToken();
      await backendFetch<AdminUser>(`/admin/users/${user.id}/billing`, accessToken, {
        method: "PUT",
        body: JSON.stringify({
          modality: draft.modality,
          aval_profile_id: draft.modality === "aval" ? draft.aval_profile_id || null : null,
        }),
      });
      await loadUsers(selectedSeasonId, accessToken);
      setMessage(`${user.display_name}: modalidad de cobro actualizada.`);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "No se pudo actualizar la modalidad");
    } finally {
      setSavingKey(null);
    }
  }

  async function handleUpdatePassword(user: AdminUser) {
    const password = passwordDrafts[user.id]?.password.trim() ?? "";
    if (password.length < 6) {
      setError("La clave temporal debe tener al menos 6 caracteres.");
      return;
    }

    setSavingKey(`password:${user.id}`);
    setError(null);
    setMessage(null);
    try {
      const accessToken = await getBrowserAccessToken();
      await backendFetch<AdminUser>(`/admin/users/${user.id}/password`, accessToken, {
        method: "PUT",
        body: JSON.stringify({ password }),
      });
      updatePasswordDraft(user.id, { password: "" });
      setMessage(`${user.display_name}: clave temporal actualizada.`);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "No se pudo actualizar la clave");
    } finally {
      setSavingKey(null);
    }
  }

  async function handleBulkImport() {
    if (!selectedSeasonId) {
      setError("Selecciona un torneo primero.");
      return;
    }
    if (!bulkCsv.trim()) {
      setError("Pega un CSV con usuarios antes de importar.");
      return;
    }

    setSavingKey("bulk-users");
    setError(null);
    setMessage(null);
    setBulkResult(null);
    try {
      const accessToken = await getBrowserAccessToken();
      const result = await backendFetch<BulkImportResponse>("/admin/users/bulk", accessToken, {
        method: "POST",
        body: JSON.stringify({
          season_id: selectedSeasonId,
          csv_text: bulkCsv,
          send_invites: bulkSendInvites,
        }),
      });
      setBulkResult(result);
      await loadUsers(selectedSeasonId, accessToken);
      setMessage(
        `Bulk terminado: ${result.created_or_updated} usuario${
          result.created_or_updated === 1 ? "" : "s"
        } creado${result.created_or_updated === 1 ? "" : "s"} o actualizado${
          result.failed > 0 ? `, ${result.failed} con error` : ""
        }.`,
      );
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "No se pudo importar el CSV");
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
      getThemePreferenceLabel(user.theme_preference),
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
        <div className="grid gap-3 px-2 py-3 lg:grid-cols-[1fr_1fr_180px_150px_170px_1fr_auto] lg:items-end">
          <label className="space-y-2 text-left text-sm">
            <span className="text-steel">Nombre</span>
            <input
              value={newUserDraft.display_name}
              onChange={(event) => updateNewUserDraft({ display_name: event.target.value })}
              placeholder="Nombre visible"
              className="field-control"
            />
          </label>
          <label className="space-y-2 text-left text-sm">
            <span className="text-steel">Correo</span>
            <input
              value={newUserDraft.email}
              onChange={(event) => updateNewUserDraft({ email: event.target.value })}
              type="email"
              placeholder="correo@dominio.com"
              className="field-control"
            />
          </label>
          <label className="space-y-2 text-left text-sm">
            <span className="text-steel">Password opcional</span>
            <input
              value={newUserDraft.password}
              onChange={(event) => updateNewUserDraft({ password: event.target.value })}
              type="password"
              placeholder="Invita si queda vacio"
              className="field-control"
            />
          </label>
          <label className="space-y-2 text-left text-sm">
            <span className="text-steel">Modalidad</span>
            <select
              value={newUserDraft.modality}
              onChange={(event) =>
                updateNewUserDraft({
                  modality: event.target.value,
                  aval_profile_id: event.target.value === "aval" ? newUserDraft.aval_profile_id : "",
                })
              }
              className="field-control"
            >
              <option value="pre_pago">Pre-pago</option>
              <option value="aval">Aval</option>
            </select>
          </label>
          <label className="space-y-2 text-left text-sm">
            <span className="text-steel">Aval</span>
            <select
              value={newUserDraft.aval_profile_id}
              onChange={(event) => updateNewUserDraft({ aval_profile_id: event.target.value })}
              className="field-control"
              disabled={newUserDraft.modality !== "aval"}
            >
              <option value="">{newUserDraft.modality === "aval" ? "Selecciona aval" : "No aplica"}</option>
              {users.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.display_name}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-2 text-left text-sm">
            <span className="text-steel">Notas</span>
            <input
              value={newUserDraft.notes}
              onChange={(event) => updateNewUserDraft({ notes: event.target.value })}
              placeholder="Opcional"
              className="field-control"
            />
          </label>
          <div className="flex flex-col gap-2">
            <label className="flex h-10 items-center gap-2 text-sm text-steel">
              <input
                checked={newUserDraft.is_paid}
                onChange={(event) => updateNewUserDraft({ is_paid: event.target.checked })}
                type="checkbox"
                className="h-4 w-4 accent-emerald-400"
              />
              Pagado
            </label>
            <button
              type="button"
              onClick={() => void handleCreateUser()}
              disabled={savingKey === "create-user" || loading || !selectedSeasonId}
              className={actionPositiveClass}
            >
              {savingKey === "create-user" ? "Creando..." : "Crear usuario"}
            </button>
          </div>
        </div>

        <div className="grid gap-3 px-2 py-3 lg:grid-cols-[minmax(0,1fr)_220px] lg:items-end">
          <label className="space-y-2 text-left text-sm">
            <span className="text-steel">Bulk CSV</span>
            <textarea
              value={bulkCsv}
              onChange={(event) => setBulkCsv(event.target.value)}
              placeholder={
                "email,display_name,password,is_paid,modality,notes\nusuario@correo.com,Usuario Demo,temporal123,true,pre_pago,Alta inicial"
              }
              className="field-control min-h-[118px] resize-y font-mono text-[12px]"
            />
          </label>
          <div className="flex flex-col gap-2">
            <label className="flex min-h-10 items-center gap-2 text-sm text-steel">
              <input
                checked={bulkSendInvites}
                onChange={(event) => setBulkSendInvites(event.target.checked)}
                type="checkbox"
                className="h-4 w-4 accent-emerald-400"
              />
              Invitar filas sin password
            </label>
            <button
              type="button"
              onClick={() => void handleBulkImport()}
              disabled={savingKey === "bulk-users" || loading || !selectedSeasonId || !bulkCsv.trim()}
              className={actionPositiveClass}
            >
              {savingKey === "bulk-users" ? "Importando..." : "Importar CSV"}
            </button>
            <p className="text-[10px] leading-4 text-steel/80">
              Columnas: email, display_name, password, is_paid, modality, notes.
            </p>
          </div>
        </div>

        {bulkResult ? (
          <div className="px-2 text-left text-[11px] text-steel">
            <p className="font-semibold text-ink">
              Resultado bulk: {bulkResult.created_or_updated} OK / {bulkResult.failed} errores
            </p>
            {bulkResult.rows.filter((row) => row.status === "error").length > 0 ? (
              <div className="mt-2 grid gap-1">
                {bulkResult.rows
                  .filter((row) => row.status === "error")
                  .slice(0, 8)
                  .map((row) => (
                    <p key={`${row.row_number}-${row.email ?? "sin-email"}`} className="text-coral">
                      Fila {row.row_number}: {row.email ?? row.display_name ?? "sin datos"} - {row.detail}
                    </p>
                  ))}
              </div>
            ) : null}
          </div>
        ) : null}

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
            <table className="min-w-[1450px] table-fixed text-center text-[11px] text-steel">
              <colgroup>
                <col className="w-[156px]" />
                <col className="w-[92px]" />
                <col className="w-[78px]" />
                <col className="w-[78px]" />
                <col className="w-[84px]" />
                <col className="w-[88px]" />
                <col className="w-[210px]" />
                <col className="w-[210px]" />
                <col className="w-[210px]" />
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
                  <th className="px-1 py-2 font-medium">Modalidad</th>
                  <th className="px-1 py-2 font-medium">Aval</th>
                  <th className="px-1 py-2 font-medium">Clave</th>
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
                  const billingDraft = billingDrafts[user.id] ?? {
                    modality: user.modality ?? "pre_pago",
                    aval_profile_id: user.aval_profile_id ?? "",
                  };
                  const passwordDraft = passwordDrafts[user.id] ?? { password: "" };
                  const avalOptions = users
                    .filter((optionUser) => optionUser.id !== user.id)
                    .sort((left, right) => left.display_name.localeCompare(right.display_name));

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
                      <td className="px-1 py-2 align-top">
                        <select
                          value={billingDraft.modality}
                          onChange={(event) =>
                            updateBillingDraft(user.id, {
                              modality: event.target.value,
                              aval_profile_id: event.target.value === "aval" ? billingDraft.aval_profile_id : "",
                            })
                          }
                          className="field-control h-8 w-full text-[11px]"
                        >
                          <option value="pre_pago">Pre-pago</option>
                          <option value="aval">Aval</option>
                        </select>
                      </td>
                      <td className="px-1 py-2 align-top">
                        <select
                          value={billingDraft.aval_profile_id}
                          onChange={(event) => updateBillingDraft(user.id, { aval_profile_id: event.target.value })}
                          className="field-control h-8 w-full text-[11px]"
                          disabled={billingDraft.modality !== "aval"}
                        >
                          <option value="">{billingDraft.modality === "aval" ? "Selecciona aval" : "No aplica"}</option>
                          {avalOptions.map((optionUser) => (
                            <option key={optionUser.id} value={optionUser.id}>
                              {optionUser.display_name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-1 py-2 align-top">
                        <div className="flex flex-col gap-2">
                          <input
                            value={passwordDraft.password}
                            onChange={(event) =>
                              updatePasswordDraft(user.id, { password: event.target.value })
                            }
                            type="password"
                            placeholder="Clave temporal"
                            className="field-control h-8 w-full text-[11px]"
                          />
                          <button
                            type="button"
                            onClick={() => void handleUpdatePassword(user)}
                            disabled={
                              savingKey === `password:${user.id}` ||
                              passwordDraft.password.trim().length < 6
                            }
                            className={actionNeutralClass}
                            title="Cambiar clave sin enviar correo"
                          >
                            {savingKey === `password:${user.id}` ? "..." : "Cambiar clave"}
                          </button>
                        </div>
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
                          <button
                            type="button"
                            onClick={() => void handleSaveBilling(user)}
                            disabled={savingKey === `billing:${user.id}`}
                            className={actionNeutralClass}
                            title="Guardar modalidad de cobro"
                          >
                            {savingKey === `billing:${user.id}` ? "..." : "Guardar cobro"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {filteredUsers.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="px-4 py-8 text-sm text-steel">
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
