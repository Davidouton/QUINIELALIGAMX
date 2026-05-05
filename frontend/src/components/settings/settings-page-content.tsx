"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

import { backendFetch } from "@/lib/api/backend";
import { env } from "@/lib/env";
import { getBrowserAccessToken } from "@/lib/supabase/session";
import { applyAppTheme, resetAppTheme } from "@/lib/theme/app-theme";
import type {
  Me,
  PaymentModality,
  PickReminderHoursBefore,
  RegisteredUserOption,
  Team,
  ThemePreference,
} from "@/types/api";

type SettingsFormState = {
  display_name: string;
  email: string;
  favorite_team_id: string;
  contact_phone: string;
  bank_name: string;
  deposit_account: string;
  modality: PaymentModality;
  aval_profile_id: string;
  theme_preference: ThemePreference;
  pick_reminder_email_enabled: boolean;
  pick_reminder_opening_enabled: boolean;
  pick_reminder_hours_before: "" | PickReminderHoursBefore;
};

const initialForm: SettingsFormState = {
  display_name: "",
  email: "",
  favorite_team_id: "",
  contact_phone: "",
  bank_name: "",
  deposit_account: "",
  modality: "pre_pago",
  aval_profile_id: "",
  theme_preference: "standard",
  pick_reminder_email_enabled: false,
  pick_reminder_opening_enabled: false,
  pick_reminder_hours_before: "",
};

function buildFormFromMe(me: Me): SettingsFormState {
  return {
    display_name: me.display_name ?? "",
    email: me.email ?? "",
    favorite_team_id: me.favorite_team_id ?? "",
    contact_phone: me.contact_phone ?? "",
    bank_name: me.bank_name ?? "",
    deposit_account: me.deposit_account ?? "",
    modality: me.modality ?? "pre_pago",
    aval_profile_id: me.aval_profile_id ?? "",
    theme_preference: me.theme_preference ?? "standard",
    pick_reminder_email_enabled: me.pick_reminder_email_enabled ?? false,
    pick_reminder_opening_enabled: me.pick_reminder_opening_enabled ?? false,
    pick_reminder_hours_before: me.pick_reminder_hours_before ?? "",
  };
}

function normalizeOptionalValue(value: string) {
  const cleaned = value.trim();
  return cleaned || null;
}

function buildQrImageUrl(data: string) {
  return `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(data)}`;
}

export function SettingsPageContent() {
  const [me, setMe] = useState<Me | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [registeredUsers, setRegisteredUsers] = useState<RegisteredUserOption[]>([]);
  const [form, setForm] = useState<SettingsFormState>(initialForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [teamsLoading, setTeamsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [teamLoadError, setTeamLoadError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const favoriteTeam = useMemo(
    () => teams.find((team) => team.id === form.favorite_team_id) ?? null,
    [form.favorite_team_id, teams],
  );

  useEffect(() => {
    async function load() {
      setLoading(true);
      setTeamsLoading(true);

      try {
        const accessToken = await getBrowserAccessToken();
        const [meResult, teamsResult, registeredUsersResult] = await Promise.allSettled([
          backendFetch<Me>("/me", accessToken),
          backendFetch<Team[]>("/teams"),
          backendFetch<RegisteredUserOption[]>("/me/registered-users", accessToken),
        ]);

        if (meResult.status === "fulfilled") {
          setMe(meResult.value);
          setForm(buildFormFromMe(meResult.value));
          setLoadError(null);
        } else {
          setLoadError(
            meResult.reason instanceof Error ? meResult.reason.message : "No se pudo cargar tu perfil",
          );
        }

        if (teamsResult.status === "fulfilled") {
          setTeams(teamsResult.value);
          setTeamLoadError(null);
        } else {
          setTeams([]);
          setTeamLoadError(
            teamsResult.reason instanceof Error
              ? teamsResult.reason.message
              : "No se pudo cargar la lista de equipos",
          );
        }

        if (registeredUsersResult.status === "fulfilled") {
          setRegisteredUsers(registeredUsersResult.value);
        } else {
          setRegisteredUsers([]);
        }
      } catch (caughtError) {
        setLoadError(caughtError instanceof Error ? caughtError.message : "No se pudo cargar settings");
      } finally {
        setLoading(false);
        setTeamsLoading(false);
      }
    }

    void load();
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setSaveError(null);
    setMessage(null);

    if (form.theme_preference === "favorite_team" && !form.favorite_team_id) {
      setSaving(false);
      setSaveError("Selecciona un equipo favorito para usar ese ambiente.");
      return;
    }
    if (form.modality === "aval" && !form.aval_profile_id) {
      setSaving(false);
      setSaveError("Selecciona un usuario aval.");
      return;
    }

    try {
      const accessToken = await getBrowserAccessToken();
      const saved = await backendFetch<Me>("/me", accessToken, {
        method: "PUT",
        body: JSON.stringify({
          display_name: form.display_name.trim(),
          email: normalizeOptionalValue(form.email),
          favorite_team_id: normalizeOptionalValue(form.favorite_team_id),
          contact_phone: normalizeOptionalValue(form.contact_phone),
          bank_name: normalizeOptionalValue(form.bank_name),
          deposit_account: normalizeOptionalValue(form.deposit_account),
          modality: form.modality,
          aval_profile_id: form.modality === "aval" ? normalizeOptionalValue(form.aval_profile_id) : null,
          theme_preference: form.theme_preference,
          pick_reminder_email_enabled: form.pick_reminder_email_enabled,
          pick_reminder_opening_enabled: form.pick_reminder_opening_enabled,
          pick_reminder_hours_before:
            form.pick_reminder_email_enabled && form.pick_reminder_hours_before !== ""
              ? form.pick_reminder_hours_before
              : null,
        }),
      });

      setMe(saved);
      setForm(buildFormFromMe(saved));
      const nextFavoriteTeam = teams.find((team) => team.id === saved.favorite_team_id) ?? null;
      if (saved.theme_preference === "favorite_team") {
        applyAppTheme(saved.theme_preference, nextFavoriteTeam);
      } else {
        resetAppTheme();
      }
      setMessage("Settings guardados.");
    } catch (caughtError) {
      setSaveError(
        caughtError instanceof Error ? caughtError.message : "No se pudieron guardar settings",
      );
    } finally {
      setSaving(false);
    }
  }

  const previewStyle =
    form.theme_preference === "favorite_team" && favoriteTeam
      ? {
          background: `linear-gradient(135deg, ${favoriteTeam.primary_color ?? "#87e0a1"} 0%, ${
            favoriteTeam.secondary_color ?? "#091425"
          } 58%, ${favoriteTeam.accent_color ?? favoriteTeam.primary_color ?? "#ff5c7a"} 100%)`,
          color: "#f5f7ff",
        }
      : undefined;
  const isFavoriteThemePreview = form.theme_preference === "favorite_team" && favoriteTeam;
  const whatsappCards = [
    {
      title: "WhatsApp general",
      link: env.whatsappGeneralUrl,
      fallbackValue: "Configura NEXT_PUBLIC_WHATSAPP_GENERAL_URL",
      description: "Canal general para avisos, resultados y movimiento del torneo.",
    },
    {
      title: "WhatsApp conversacion",
      link: env.whatsappConversationUrl,
      fallbackValue: "Configura NEXT_PUBLIC_WHATSAPP_CONVERSATION_URL",
      description: "Espacio para cotorreo, picks, debate y seguimiento del grupo.",
    },
  ];

  if (loading) {
    return <p className="text-sm text-ink/60">Cargando settings...</p>;
  }

  return (
    <div className="space-y-6">
      <section>
        <h1 className="text-xl font-semibold text-ink">Perfil</h1>
      </section>

      {loadError && !me ? <p className="text-sm text-coral">{loadError}</p> : null}
      {saveError ? <p className="text-sm text-coral">{saveError}</p> : null}
      {message ? <p className="text-sm text-moss">{message}</p> : null}

      <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <section className="space-y-5">
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-[0.22em] text-steel">
                Datos principales
              </h2>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <label className="space-y-2 text-sm">
                <span className="text-steel">Nombre</span>
                <input
                  value={form.display_name}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, display_name: event.target.value }))
                  }
                  className="field-control"
                  placeholder="Tu nickname"
                />
              </label>
              <label className="space-y-2 text-sm">
                <span className="text-steel">Correo</span>
                <input
                  type="email"
                  value={form.email}
                  onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
                  className="field-control"
                  placeholder="tu@correo.com"
                />
              </label>
              <label className="space-y-2 text-sm">
                <span className="text-steel">Telefono</span>
                <input
                  type="tel"
                  value={form.contact_phone}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, contact_phone: event.target.value }))
                  }
                  className="field-control"
                  placeholder="+52 55 0000 0000"
                />
              </label>
              <label className="space-y-2 text-sm">
                <span className="text-steel">Banco</span>
                <input
                  value={form.bank_name}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, bank_name: event.target.value }))
                  }
                  className="field-control"
                  placeholder="Banco o institucion"
                />
              </label>
              <label className="space-y-2 text-sm">
                <span className="text-steel">Cuenta de deposito</span>
                <input
                  value={form.deposit_account}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, deposit_account: event.target.value }))
                  }
                  className="field-control"
                  placeholder="CLABE, cuenta o referencia"
                />
              </label>
              <label className="space-y-2 text-sm">
                <span className="text-steel">Modalidad</span>
                <select
                  value={form.modality}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      modality: event.target.value as PaymentModality,
                      aval_profile_id: event.target.value === "aval" ? current.aval_profile_id : "",
                    }))
                  }
                  className="field-control"
                >
                  <option value="pre_pago">Pre-pago</option>
                  <option value="aval">Aval</option>
                </select>
              </label>
              {form.modality === "aval" ? (
                <label className="space-y-2 text-sm">
                  <span className="text-steel">Aval</span>
                  <select
                    value={form.aval_profile_id}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, aval_profile_id: event.target.value }))
                    }
                    className="field-control"
                  >
                    <option value="">Selecciona usuario</option>
                    {registeredUsers.map((user) => (
                      <option key={user.id} value={user.id}>
                        {user.display_name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
            </div>

            <div>
              <h3 className="text-xl font-semibold text-ink">Equipo y ambiente</h3>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <label className="space-y-2 text-sm">
                <span className="text-steel">Equipo favorito</span>
                <select
                  value={form.favorite_team_id}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, favorite_team_id: event.target.value }))
                  }
                  className="field-control"
                  disabled={teamsLoading}
                >
                  <option value="">
                    {teamsLoading ? "Cargando equipos..." : "Selecciona equipo"}
                  </option>
                  {teams.map((team) => (
                    <option key={team.id} value={team.id}>
                      {team.name}
                    </option>
                  ))}
                </select>
                <p className={`text-xs ${teamLoadError ? "text-coral" : "text-steel"}`}>
                  {teamLoadError ?? `${teams.length} equipos disponibles`}
                </p>
              </label>
              <label className="space-y-2 text-sm">
                <span className="text-steel">Ambiente</span>
                <select
                  value={form.theme_preference}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      theme_preference: event.target.value as ThemePreference,
                    }))
                  }
                  className="field-control"
                >
                  <option value="standard">Estandar</option>
                  <option value="favorite_team">Equipo favorito</option>
                </select>
              </label>
            </div>

            <div>
              <h3 className="text-xl font-semibold text-ink">Recordatorios</h3>
              <p className="mt-2 text-sm text-steel">
                Te avisamos por mail cuando una jornada ya este activa y antes del primer juego del dia.
              </p>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <label className="space-y-2 text-sm">
                <span className="text-steel">Mail de recordatorios</span>
                <select
                  value={form.pick_reminder_email_enabled ? "si" : "no"}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      pick_reminder_email_enabled: event.target.value === "si",
                      pick_reminder_opening_enabled:
                        event.target.value === "si" ? current.pick_reminder_opening_enabled : false,
                      pick_reminder_hours_before:
                        event.target.value === "si" ? current.pick_reminder_hours_before : "",
                    }))
                  }
                  className="field-control"
                >
                  <option value="no">No enviar</option>
                  <option value="si">Enviar por mail</option>
                </select>
              </label>

              <label className="space-y-2 text-sm">
                <span className="text-steel">Antes del primer juego del dia</span>
                <select
                  value={form.pick_reminder_hours_before === "" ? "none" : String(form.pick_reminder_hours_before)}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      pick_reminder_hours_before:
                        event.target.value === "none"
                          ? ""
                          : (Number(event.target.value) as PickReminderHoursBefore),
                    }))
                  }
                  className="field-control"
                  disabled={!form.pick_reminder_email_enabled}
                >
                  <option value="none">Sin recordatorio previo</option>
                  <option value="3">3 horas antes</option>
                  <option value="1">1 hora antes</option>
                </select>
              </label>

              <label className="space-y-2 text-sm md:col-span-2">
                <span className="text-steel">Al abrir la jornada</span>
                <select
                  value={form.pick_reminder_opening_enabled ? "si" : "no"}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      pick_reminder_opening_enabled: event.target.value === "si",
                    }))
                  }
                  className="field-control"
                  disabled={!form.pick_reminder_email_enabled}
                >
                  <option value="no">No mandar</option>
                  <option value="si">Mandar una vez</option>
                </select>
              </label>
            </div>

            <button
              type="submit"
              disabled={saving || !form.display_name.trim()}
              className="secondary-button disabled:opacity-60"
            >
              {saving ? "Guardando..." : "Guardar"}
            </button>
          </form>
        </section>

        <section className="space-y-5">
          <div>
            <p className="text-[10px] uppercase tracking-[0.22em] text-steel">Preview</p>
            <h2 className="mt-2 text-sm font-semibold uppercase tracking-[0.22em] text-ink">
              Ambiente activo
            </h2>
          </div>

          <div
            className="px-4 py-4"
            style={previewStyle}
          >
            <p
              className={`text-xs uppercase tracking-[0.25em] ${
                isFavoriteThemePreview ? "text-white/75" : "text-steel/80"
              }`}
            >
              {form.theme_preference === "favorite_team" ? "Equipo favorito" : "Estandar"}
            </p>
            <p className={`mt-3 text-2xl font-semibold ${isFavoriteThemePreview ? "text-white" : "text-ink"}`}>
              {form.theme_preference === "favorite_team" && favoriteTeam
                ? favoriteTeam.name
                : me?.display_name ?? "Usuario"}
            </p>
            <p className={`mt-2 text-sm ${isFavoriteThemePreview ? "text-white/80" : "text-steel"}`}>
              {form.theme_preference === "favorite_team"
                ? "El dashboard usara los colores principales del club seleccionado."
                : "Se mantiene el look base de QuinielaMaestra."}
            </p>
          </div>
        </section>
      </div>

      <section className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[10px] uppercase tracking-[0.22em] text-steel">Comunidad</p>
            <h2 className="mt-2 text-sm font-semibold uppercase tracking-[0.22em] text-ink">WhatsApp</h2>
            <p className="mt-2 max-w-2xl text-sm text-steel">
              Escanea cualquiera de los QR para entrar rapido al grupo general o al chat de conversacion.
            </p>
          </div>
        </div>

        <div className="grid gap-5 lg:grid-cols-2">
          {whatsappCards.map((item) => {
            const effectiveValue = item.link || item.fallbackValue;
            const isConfigured = Boolean(item.link);

            return (
              <div
                key={item.title}
                className="space-y-4 px-1 py-4 sm:px-3"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-base font-semibold text-ink">{item.title}</p>
                    <p className="mt-2 text-sm text-steel">{item.description}</p>
                  </div>
                  <span
                    className={`rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] ${
                      isConfigured
                        ? "border-emerald-300/35 bg-emerald-400/12 text-emerald-100"
                        : "border-amber-300/30 bg-amber-400/10 text-amber-100"
                    }`}
                  >
                    {isConfigured ? "Activo" : "Pendiente"}
                  </span>
                </div>

                <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                  <div className="flex h-[188px] w-[188px] items-center justify-center rounded-[18px] bg-white p-3">
                    <img
                      src={buildQrImageUrl(effectiveValue)}
                      alt={`QR ${item.title}`}
                      className="h-full w-full rounded-[18px] object-contain"
                    />
                  </div>

                  <div className="min-w-0 flex-1 space-y-3">
                    <p className="text-xs uppercase tracking-[0.2em] text-steel/80">Link</p>
                    {isConfigured ? (
                      <a
                        href={item.link}
                        target="_blank"
                        rel="noreferrer"
                        className="block break-all text-sm text-ink underline decoration-white/20 underline-offset-4 transition hover:decoration-white/60"
                      >
                        {item.link}
                      </a>
                    ) : (
                      <p className="text-sm text-steel">
                        Agrega la URL en `frontend/.env.local` para activar este QR.
                      </p>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
