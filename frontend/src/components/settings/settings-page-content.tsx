"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

import { backendFetch, CATALOG_CACHE_TTL_MS } from "@/lib/api/backend";
import { env } from "@/lib/env";
import { promptOneSignalPush } from "@/lib/onesignal/client";
import { getBrowserAccessToken } from "@/lib/supabase/session";
import {
  THEME_PREFERENCE_OPTIONS,
  applyAppTheme,
  getThemePreferenceLabel,
  getThemeTokens,
  normalizeThemePreference,
} from "@/lib/theme/app-theme";
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
  pick_reminder_hours_before: "" | PickReminderHoursBefore;
  matchday_start_notification_enabled: boolean;
  match_result_notification_enabled: boolean;
  matchday_summary_notification_enabled: boolean;
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
  theme_preference: "night",
  pick_reminder_email_enabled: false,
  pick_reminder_hours_before: "",
  matchday_start_notification_enabled: false,
  match_result_notification_enabled: false,
  matchday_summary_notification_enabled: false,
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
    theme_preference: normalizeThemePreference(me.theme_preference),
    pick_reminder_email_enabled: me.pick_reminder_email_enabled ?? false,
    pick_reminder_hours_before: me.pick_reminder_hours_before ?? "",
    matchday_start_notification_enabled: me.matchday_start_notification_enabled ?? false,
    match_result_notification_enabled: me.match_result_notification_enabled ?? false,
    matchday_summary_notification_enabled: me.matchday_summary_notification_enabled ?? false,
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
  const [pushPermission, setPushPermission] = useState<NotificationPermission | "unsupported">("unsupported");
  const [requestingPushPermission, setRequestingPushPermission] = useState(false);

  const favoriteTeam = useMemo(
    () => teams.find((team) => team.id === form.favorite_team_id) ?? null,
    [form.favorite_team_id, teams],
  );
  const avalDisplayName = useMemo(
    () => registeredUsers.find((user) => user.id === form.aval_profile_id)?.display_name ?? null,
    [form.aval_profile_id, registeredUsers],
  );

  useEffect(() => {
    if (typeof window === "undefined" || !("Notification" in window)) {
      setPushPermission("unsupported");
      return;
    }
    setPushPermission(Notification.permission);
  }, []);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setTeamsLoading(true);

      try {
        const accessToken = await getBrowserAccessToken();
        const [meResult, teamsResult, registeredUsersResult] = await Promise.allSettled([
          backendFetch<Me>("/me", accessToken),
          backendFetch<Team[]>("/teams", undefined, { cacheTtlMs: CATALOG_CACHE_TTL_MS }),
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

  async function handleRequestPushPermission() {
    setRequestingPushPermission(true);
    setSaveError(null);
    try {
      const granted = await promptOneSignalPush();
      if (typeof window !== "undefined" && "Notification" in window) {
        setPushPermission(Notification.permission);
      } else {
        setPushPermission(granted ? "granted" : "unsupported");
      }
      setMessage(granted ? "Notificaciones push activadas en este dispositivo." : "No se activaron las notificaciones push.");
    } catch (caughtError) {
      setSaveError(
        caughtError instanceof Error ? caughtError.message : "No se pudo activar permisos de notificaciones",
      );
    } finally {
      setRequestingPushPermission(false);
    }
  }

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
          pick_reminder_opening_enabled: false,
          pick_reminder_hours_before:
            form.pick_reminder_email_enabled && form.pick_reminder_hours_before !== ""
              ? form.pick_reminder_hours_before
              : null,
          matchday_start_notification_enabled:
            form.pick_reminder_email_enabled && form.matchday_start_notification_enabled,
          match_result_notification_enabled:
            form.pick_reminder_email_enabled && form.match_result_notification_enabled,
          matchday_summary_notification_enabled:
            form.pick_reminder_email_enabled && form.matchday_summary_notification_enabled,
        }),
      });

      setMe(saved);
      setForm(buildFormFromMe(saved));
      const nextFavoriteTeam = teams.find((team) => team.id === saved.favorite_team_id) ?? null;
      applyAppTheme(saved.theme_preference, nextFavoriteTeam);
      setMessage("Settings guardados.");
    } catch (caughtError) {
      setSaveError(
        caughtError instanceof Error ? caughtError.message : "No se pudieron guardar settings",
      );
    } finally {
      setSaving(false);
    }
  }

  const previewTheme = useMemo(
    () => getThemeTokens(form.theme_preference, favoriteTeam),
    [favoriteTeam, form.theme_preference],
  );
  const whatsappCards = [
    {
      title: "WhatsApp general",
      link: env.whatsappGeneralUrl,
      fallbackValue: "Configura NEXT_PUBLIC_WHATSAPP_GENERAL_URL",
    },
    {
      title: "WhatsApp conversacion",
      link: env.whatsappConversationUrl,
      fallbackValue: "Configura NEXT_PUBLIC_WHATSAPP_CONVERSATION_URL",
    },
  ];

  if (loading) {
    return <p className="text-sm text-ink/60">Cargando settings...</p>;
  }

  return (
    <div className="space-y-6">
      <header className="page-header">
        <h1 className="page-title">Settings</h1>
      </header>

      {loadError && !me ? <p className="text-sm text-coral">{loadError}</p> : null}
      {saveError ? <p className="text-sm text-coral">{saveError}</p> : null}
      {message ? <p className="text-sm text-moss">{message}</p> : null}

      <div className="grid gap-12 xl:grid-cols-[minmax(0,1fr)_320px]">
        <section>
          <form onSubmit={handleSubmit} className="space-y-10">
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-[0.22em] text-steel">
                Datos principales
              </h2>
            </div>

            <div className="grid gap-x-10 gap-y-7 border-t border-white/10 pt-6 md:grid-cols-2">
              <label className="space-y-2 text-sm">
                <span className="text-steel">Nombre</span>
                <input
                  value={form.display_name}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, display_name: event.target.value }))
                  }
                  className="h-14 w-full border-0 border-b border-white/15 bg-transparent px-0 text-ink outline-none transition focus:border-[#4f7df3]"
                  placeholder="Tu nickname"
                />
              </label>
              <label className="space-y-2 text-sm">
                <span className="text-steel">Correo</span>
                <input
                  type="email"
                  value={form.email}
                  onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
                  className="w-full border-0 border-b border-white/15 bg-transparent px-0 py-3 text-ink outline-none transition focus:border-[#4f7df3]"
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
                  className="w-full border-0 border-b border-white/15 bg-transparent px-0 py-3 text-ink outline-none transition focus:border-[#4f7df3]"
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
                  className="w-full border-0 border-b border-white/15 bg-transparent px-0 py-3 text-ink outline-none transition focus:border-[#4f7df3]"
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
                  className="w-full border-0 border-b border-white/15 bg-transparent px-0 py-3 text-ink outline-none transition focus:border-[#4f7df3]"
                  placeholder="CLABE, cuenta o referencia"
                />
              </label>
              <label className="space-y-2 text-sm">
                <span className="text-steel">Modalidad</span>
                <div className="flex min-h-12 items-center border-b border-white/15 py-3 text-ink/70">
                  <span>{form.modality === "aval" ? "Aval" : "Pre-pago"}</span>
                </div>
              </label>
              {form.modality === "aval" ? (
                <label className="space-y-2 text-sm">
                  <span className="text-steel">Aval</span>
                  <div className="flex min-h-12 items-center border-b border-white/15 py-3 text-ink/70">
                    <span>{avalDisplayName ?? "Aval asignado por admin"}</span>
                  </div>
                </label>
              ) : null}
            </div>

            <div>
              <h2 className="text-sm font-semibold uppercase tracking-[0.22em] text-steel">Equipo y ambiente</h2>
            </div>

            <div className="grid gap-x-10 gap-y-7 border-t border-white/10 pt-6 md:grid-cols-2">
              <label className="space-y-2 text-sm">
                <span className="text-steel">Equipo favorito</span>
                <select
                  value={form.favorite_team_id}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, favorite_team_id: event.target.value }))
                  }
                  className="w-full border-0 border-b border-white/15 bg-transparent px-0 py-3 text-ink outline-none transition focus:border-[#4f7df3]"
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
                {teamLoadError ? <p className="text-xs text-coral">{teamLoadError}</p> : null}
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
                  className="w-full border-0 border-b border-white/15 bg-transparent px-0 py-3 text-ink outline-none transition focus:border-[#4f7df3]"
                >
                  {THEME_PREFERENCE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div>
              <h2 className="text-sm font-semibold uppercase tracking-[0.22em] text-steel">Notificaciones</h2>
            </div>

            <div className="grid gap-x-10 gap-y-7 border-t border-white/10 pt-6 md:grid-cols-2">
              <label className="space-y-2 text-sm">
                <span className="text-steel">Recordatorios push</span>
                <select
                  value={form.pick_reminder_email_enabled ? "si" : "no"}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      pick_reminder_email_enabled: event.target.value === "si",
                      pick_reminder_hours_before:
                        event.target.value === "si" ? current.pick_reminder_hours_before : "",
                      matchday_start_notification_enabled:
                        event.target.value === "si" ? current.matchday_start_notification_enabled : false,
                      match_result_notification_enabled:
                        event.target.value === "si" ? current.match_result_notification_enabled : false,
                      matchday_summary_notification_enabled:
                        event.target.value === "si" ? current.matchday_summary_notification_enabled : false,
                    }))
                  }
                  className="h-14 w-full border-0 border-b border-white/15 bg-transparent px-0 text-ink outline-none transition focus:border-[#4f7df3]"
                >
                  <option value="no">Desactivados</option>
                  <option value="si">Activar push</option>
                </select>
              </label>

              <div className="space-y-2 text-sm">
                <span className="text-steel">Permiso del navegador</span>
                <div className="flex h-14 items-center justify-between gap-3 border-b border-white/15">
                  <span>
                    {pushPermission === "granted"
                      ? "Activo"
                      : pushPermission === "denied"
                        ? "Bloqueado"
                        : pushPermission === "default"
                          ? "Pendiente"
                          : "No compatible"}
                  </span>
                  <button
                    type="button"
                    onClick={() => void handleRequestPushPermission()}
                    disabled={requestingPushPermission || pushPermission === "unsupported"}
                    className="text-xs font-semibold uppercase tracking-[0.14em] text-ink transition hover:text-[#4f7df3] active:text-[#4f7df3] disabled:opacity-50"
                  >
                    {requestingPushPermission ? "Solicitando..." : "Activar"}
                  </button>
                </div>
              </div>

              <div className="divide-y divide-white/10 border-y border-white/10 md:col-span-2">
                <label className="flex items-center gap-3 py-4 text-sm text-ink">
                  <input
                    type="checkbox"
                    checked={form.pick_reminder_hours_before === 1}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        pick_reminder_hours_before: event.target.checked ? 1 : "",
                      }))
                    }
                    className="h-4 w-4 accent-[#4f7df3]"
                    disabled={!form.pick_reminder_email_enabled}
                  />
                  <span>1 hora antes de cerrar tu pick</span>
                </label>
                <label className="flex items-center gap-3 py-4 text-sm text-ink">
                  <input
                    type="checkbox"
                    checked={form.matchday_start_notification_enabled}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        matchday_start_notification_enabled: event.target.checked,
                      }))
                    }
                    className="h-4 w-4 accent-[#4f7df3]"
                    disabled={!form.pick_reminder_email_enabled}
                  />
                  <span>1 hora antes del inicio de la jornada</span>
                </label>
                <label className="flex items-center gap-3 py-4 text-sm text-ink">
                  <input
                    type="checkbox"
                    checked={form.match_result_notification_enabled}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        match_result_notification_enabled: event.target.checked,
                      }))
                    }
                    className="h-4 w-4 accent-[#4f7df3]"
                    disabled={!form.pick_reminder_email_enabled}
                  />
                  <span>Marcador y standings por partido</span>
                </label>
                <label className="flex items-center gap-3 py-4 text-sm text-ink">
                  <input
                    type="checkbox"
                    checked={form.matchday_summary_notification_enabled}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        matchday_summary_notification_enabled: event.target.checked,
                      }))
                    }
                    className="h-4 w-4 accent-[#4f7df3]"
                    disabled={!form.pick_reminder_email_enabled}
                  />
                  <span>Standing y puntos al cierre de la jornada</span>
                </label>
              </div>
            </div>

            <button
              type="submit"
              disabled={saving || !form.display_name.trim()}
              className={`text-sm font-semibold uppercase tracking-[0.16em] transition disabled:opacity-50 ${saving ? "text-[#4f7df3]" : "text-ink hover:text-[#4f7df3]"}`}
            >
              {saving ? "Guardando..." : "Guardar"}
            </button>
          </form>
        </section>

        <section className="space-y-5 border-t border-white/10 pt-6 xl:border-l xl:border-t-0 xl:pl-8 xl:pt-0">
          <h2 className="text-sm font-semibold uppercase tracking-[0.22em] text-steel">Ambiente</h2>
          <div className="space-y-4 border-t border-white/10 pt-5">
            <p className="text-xs uppercase tracking-[0.25em]" style={{ color: previewTheme.accentHex }}>
              {getThemePreferenceLabel(form.theme_preference)}
            </p>
            <p className="text-2xl font-semibold text-ink">
              {form.theme_preference === "favorite_team" && favoriteTeam
                ? favoriteTeam.name
                : me?.display_name ?? "Usuario"}
            </p>
          </div>
        </section>
      </div>

      <section className="space-y-5 border-t border-white/10 pt-8">
        <h2 className="text-sm font-semibold uppercase tracking-[0.22em] text-steel">WhatsApp</h2>

        <div className="grid gap-x-12 gap-y-8 lg:grid-cols-2">
          {whatsappCards.map((item) => {
            const effectiveValue = item.link || item.fallbackValue;
            const isConfigured = Boolean(item.link);

            return (
              <div
                key={item.title}
                className="space-y-5 border-t border-white/10 pt-5"
              >
                <p className="text-base font-semibold text-ink">{item.title}</p>

                <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                  <div className="flex h-[176px] w-[176px] items-center justify-center bg-white p-3">
                    <img
                      src={buildQrImageUrl(effectiveValue)}
                      alt={`QR ${item.title}`}
                      className="h-full w-full object-contain"
                    />
                  </div>

                  <div className="min-w-0 flex-1 space-y-3">
                    {isConfigured ? (
                      <a
                        href={item.link}
                        target="_blank"
                        rel="noreferrer"
                        className="block break-all text-sm text-ink transition hover:text-[#4f7df3]"
                      >
                        {item.link}
                      </a>
                    ) : (
                      <p className="text-sm text-steel">
                        No disponible
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
