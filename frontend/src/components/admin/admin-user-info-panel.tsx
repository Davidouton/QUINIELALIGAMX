"use client";

import { useEffect, useState } from "react";

import { backendFetch } from "@/lib/api/backend";
import { getBrowserAccessToken } from "@/lib/supabase/session";
import type { AdminUser } from "@/types/api";

function getModalityLabel(modality: string) {
  return modality === "aval" ? "Aval" : "Pre-pago";
}

function getThemeLabel(themePreference: string) {
  return themePreference === "favorite_team" ? "Equipo" : "Estandar";
}

export function AdminUserInfoPanel() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const accessToken = await getBrowserAccessToken();
        const rows = await backendFetch<AdminUser[]>("/admin/users", accessToken);
        setUsers(rows);
        setError(null);
      } catch (caughtError) {
        setError(caughtError instanceof Error ? caughtError.message : "No se pudo cargar la info de usuarios");
      } finally {
        setLoading(false);
      }
    }

    void load();
  }, []);

  const normalizedSearch = searchTerm.trim().toLowerCase();
  const filteredUsers = users.filter((user) => {
    if (!normalizedSearch) {
      return true;
    }

    return [
      user.display_name,
      user.email ?? "",
      user.contact_phone ?? "",
      user.bank_name ?? "",
      user.favorite_team_name ?? "",
      user.deposit_account ?? "",
      user.aval_display_name ?? "",
      getModalityLabel(user.modality),
      getThemeLabel(user.theme_preference),
    ]
      .join(" ")
      .toLowerCase()
      .includes(normalizedSearch);
  });

  return (
    <div className="space-y-5">
      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-[0.22em] text-ink">Info usuarios</h2>
          </div>
          <p className="text-sm text-steel">
            {filteredUsers.length} de {users.length} usuarios
          </p>
        </div>

        <label className="block max-w-[320px] space-y-2 text-sm">
          <span className="text-steel">Buscar</span>
          <input
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder="Nombre, correo, telefono, equipo, aval"
            className="field-control"
          />
        </label>

        {loading ? <p className="text-sm text-steel">Cargando info de usuarios...</p> : null}
        {error ? <p className="text-sm text-coral">{error}</p> : null}
      </section>

      {!loading && !error ? (
        <section className="space-y-3">
          <div className="no-scrollbar overflow-x-auto touch-pan-x">
            <table className="min-w-[1190px] table-fixed text-left text-[11px] text-ink">
              <colgroup>
                <col className="w-[180px]" />
                <col className="w-[190px]" />
                <col className="w-[120px]" />
                <col className="w-[110px]" />
                <col className="w-[150px]" />
                <col className="w-[150px]" />
                <col className="w-[210px]" />
                <col className="w-[150px]" />
                <col className="w-[110px]" />
              </colgroup>
              <thead className="app-table-head">
                <tr>
                  <th className="px-3 py-3">Usuario</th>
                  <th className="px-3 py-3">Correo</th>
                  <th className="px-3 py-3">Telefono</th>
                  <th className="px-3 py-3">Modalidad</th>
                  <th className="px-3 py-3">Aval</th>
                  <th className="px-3 py-3">Banco</th>
                  <th className="px-3 py-3">Cuenta deposito</th>
                  <th className="px-3 py-3">Equipo</th>
                  <th className="px-3 py-3">Tema</th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.map((user) => (
                  <tr key={user.id} className="app-table-row border-b last:border-b-0">
                    <td className="px-3 py-3 font-medium text-ink">{user.display_name}</td>
                    <td className="px-3 py-3 text-steel">{user.email ?? "-"}</td>
                    <td className="px-3 py-3 text-steel">{user.contact_phone ?? "-"}</td>
                    <td className="px-3 py-3 text-steel">{getModalityLabel(user.modality)}</td>
                    <td className="px-3 py-3 text-steel">{user.aval_display_name ?? "-"}</td>
                    <td className="px-3 py-3 text-steel">{user.bank_name ?? "-"}</td>
                    <td className="px-3 py-3 text-steel">{user.deposit_account ?? "-"}</td>
                    <td className="px-3 py-3 text-steel">{user.favorite_team_name ?? "-"}</td>
                    <td className="px-3 py-3 text-steel">{getThemeLabel(user.theme_preference)}</td>
                  </tr>
                ))}
                {filteredUsers.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-3 py-8 text-sm text-steel">
                      No hubo coincidencias para ese filtro.
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
