import type { Team, ThemePreference } from "@/types/api";

export type NormalizedThemePreference = "auto" | "night" | "day_blue" | "favorite_team";

type AppThemeTokens = {
  key: Exclude<NormalizedThemePreference, "auto">;
  label: string;
  description: string;
  colorScheme: "light" | "dark";
  surfaceMode: "light" | "dark";
  bgTop: string;
  bgMid: string;
  bgBottom: string;
  surfaceCardBg: string;
  surfaceStrongBg: string;
  surfaceSubtleBg: string;
  surfaceSoftBg: string;
  surfaceSoftHoverBg: string;
  borderSoft: string;
  borderStrong: string;
  accentHex: string;
  accentRgb: string;
  primaryHex: string;
  primaryRgb: string;
  primaryText: string;
  inkRgb: string;
  sandRgb: string;
  steelRgb: string;
  nightRgb: string;
  slateRgb: string;
  gridRgb: string;
  placeholderRgb: string;
};

const NIGHT_THEME: AppThemeTokens = {
  key: "night",
  label: "Noche",
  description: "Mantiene el look oscuro base de QuinielaMaestra.",
  colorScheme: "dark",
  surfaceMode: "dark",
  bgTop: "#07101D",
  bgMid: "#091425",
  bgBottom: "#0A1322",
  surfaceCardBg: "rgba(255, 255, 255, 0.05)",
  surfaceStrongBg: "rgba(13, 26, 48, 0.8)",
  surfaceSubtleBg: "rgba(255, 255, 255, 0.014)",
  surfaceSoftBg: "rgba(255, 255, 255, 0.05)",
  surfaceSoftHoverBg: "rgba(255, 255, 255, 0.08)",
  borderSoft: "rgba(255, 255, 255, 0.04)",
  borderStrong: "rgba(255, 255, 255, 0.08)",
  accentHex: "#FF5C7A",
  accentRgb: "255, 92, 122",
  primaryHex: "#87E0A1",
  primaryRgb: "135, 224, 161",
  primaryText: "#07111F",
  inkRgb: "245, 247, 255",
  sandRgb: "219, 229, 255",
  steelRgb: "142, 165, 209",
  nightRgb: "7, 17, 31",
  slateRgb: "13, 26, 48",
  gridRgb: "255, 255, 255",
  placeholderRgb: "142, 165, 209",
};

const DAY_BLUE_THEME: AppThemeTokens = {
  key: "day_blue",
  label: "Dia Azul",
  description: "Usa fondo claro con acentos azules y contraste diurno.",
  colorScheme: "light",
  surfaceMode: "light",
  bgTop: "#F8FBFF",
  bgMid: "#F4F8FF",
  bgBottom: "#EDF4FF",
  surfaceCardBg: "rgba(255, 255, 255, 0.82)",
  surfaceStrongBg: "rgba(255, 255, 255, 0.92)",
  surfaceSubtleBg: "rgba(14, 54, 124, 0.04)",
  surfaceSoftBg: "rgba(255, 255, 255, 0.72)",
  surfaceSoftHoverBg: "rgba(255, 255, 255, 0.94)",
  borderSoft: "rgba(14, 54, 124, 0.10)",
  borderStrong: "rgba(14, 54, 124, 0.16)",
  accentHex: "#1F66FF",
  accentRgb: "31, 102, 255",
  primaryHex: "#0E4ED8",
  primaryRgb: "14, 78, 216",
  primaryText: "#F8FBFF",
  inkRgb: "13, 42, 92",
  sandRgb: "59, 91, 145",
  steelRgb: "86, 114, 164",
  nightRgb: "13, 42, 92",
  slateRgb: "237, 244, 255",
  gridRgb: "18, 68, 145",
  placeholderRgb: "86, 114, 164",
};

const DEFAULT_THEME = NIGHT_THEME;

let autoThemeCleanup: (() => void) | null = null;

export const THEME_PREFERENCE_OPTIONS: Array<{
  value: NormalizedThemePreference;
  label: string;
}> = [
  { value: "auto", label: "Auto" },
  { value: "night", label: "Noche" },
  { value: "day_blue", label: "Dia Azul" },
  { value: "favorite_team", label: "Equipo" },
];

function normalizeHex(value: string | null | undefined, fallback: string) {
  if (!value) {
    return fallback;
  }

  let hex = value.trim();
  if (!hex) {
    return fallback;
  }
  if (!hex.startsWith("#")) {
    hex = `#${hex}`;
  }
  if (/^#[0-9a-fA-F]{3}$/.test(hex)) {
    hex = `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`;
  }
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) {
    return fallback;
  }
  return hex.toUpperCase();
}

function hexToRgbParts(hex: string) {
  const normalized = normalizeHex(hex, DEFAULT_THEME.accentHex).slice(1);
  return {
    red: Number.parseInt(normalized.slice(0, 2), 16),
    green: Number.parseInt(normalized.slice(2, 4), 16),
    blue: Number.parseInt(normalized.slice(4, 6), 16),
  };
}

function hexToRgbString(hex: string) {
  const { red, green, blue } = hexToRgbParts(hex);
  return `${red}, ${green}, ${blue}`;
}

function mixHex(hex: string, targetHex: string, amount: number) {
  const source = hexToRgbParts(hex);
  const target = hexToRgbParts(targetHex);
  const weight = Math.max(0, Math.min(1, amount));
  const red = Math.round(source.red * (1 - weight) + target.red * weight);
  const green = Math.round(source.green * (1 - weight) + target.green * weight);
  const blue = Math.round(source.blue * (1 - weight) + target.blue * weight);
  return `#${[red, green, blue].map((value) => value.toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

function getReadableTextColor(hex: string) {
  const { red, green, blue } = hexToRgbParts(hex);
  const luminance = (red * 299 + green * 587 + blue * 114) / 1000;
  return luminance > 150 ? "#07111F" : "#F5F7FF";
}

function prefersDarkMode() {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return true;
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function normalizeThemePreference(
  preference: ThemePreference | string | null | undefined,
): NormalizedThemePreference {
  if (preference === "auto" || preference === "night" || preference === "day_blue") {
    return preference;
  }
  if (preference === "favorite_team") {
    return "favorite_team";
  }
  return "night";
}

function resolveThemePreference(preference: NormalizedThemePreference): Exclude<NormalizedThemePreference, "auto"> {
  if (preference === "auto") {
    return prefersDarkMode() ? "night" : "day_blue";
  }
  return preference;
}

export function getThemePreferenceLabel(preference: ThemePreference | string | null | undefined) {
  const normalized = normalizeThemePreference(preference);
  if (normalized === "auto") {
    return "Auto";
  }
  if (normalized === "favorite_team") {
    return "Equipo";
  }
  if (normalized === "day_blue") {
    return "Dia Azul";
  }
  return "Noche";
}

export function getThemePreferenceDescription(
  preference: ThemePreference | string | null | undefined,
  hasFavoriteTeam = true,
) {
  const normalized = normalizeThemePreference(preference);
  if (normalized === "auto") {
    return "Sigue el modo del sistema entre Noche y Dia Azul.";
  }
  if (normalized === "favorite_team") {
    return hasFavoriteTeam
      ? "El dashboard tomara los colores principales del club seleccionado."
      : "Selecciona un equipo favorito para activar esta variante.";
  }
  if (normalized === "day_blue") {
    return DAY_BLUE_THEME.description;
  }
  return NIGHT_THEME.description;
}

function buildFavoriteTeamTheme(favoriteTeam: Team): AppThemeTokens {
  const primaryHex = normalizeHex(favoriteTeam.primary_color, DEFAULT_THEME.primaryHex);
  const secondaryHex = normalizeHex(favoriteTeam.secondary_color, DEFAULT_THEME.bgMid);
  const accentHex = normalizeHex(
    favoriteTeam.accent_color ?? favoriteTeam.secondary_color,
    DEFAULT_THEME.accentHex,
  );
  const nightHex = mixHex(primaryHex, "#07111F", 0.74);
  const slateHex = mixHex(secondaryHex, "#0D1A30", 0.54);
  const sandHex = mixHex(primaryHex, "#F5F7FF", 0.82);
  const steelHex = mixHex(accentHex, "#C7D8FF", 0.58);

  return {
    key: "favorite_team",
    label: "Equipo",
    description: "Usa los colores principales del club seleccionado.",
    colorScheme: "dark",
    surfaceMode: "dark",
    bgTop: mixHex(primaryHex, "#03070F", 0.8),
    bgMid: mixHex(secondaryHex, "#07111F", 0.72),
    bgBottom: mixHex(accentHex, "#050A14", 0.84),
    surfaceCardBg: `rgba(${hexToRgbString(primaryHex)}, 0.14)`,
    surfaceStrongBg: `rgba(${hexToRgbString(secondaryHex)}, 0.33)`,
    surfaceSubtleBg: `rgba(${hexToRgbString(primaryHex)}, 0.09)`,
    surfaceSoftBg: `rgba(${hexToRgbString(primaryHex)}, 0.12)`,
    surfaceSoftHoverBg: `rgba(${hexToRgbString(primaryHex)}, 0.18)`,
    borderSoft: `rgba(${hexToRgbString(primaryHex)}, 0.18)`,
    borderStrong: `rgba(${hexToRgbString(accentHex)}, 0.28)`,
    accentHex,
    accentRgb: hexToRgbString(accentHex),
    primaryHex,
    primaryRgb: hexToRgbString(primaryHex),
    primaryText: getReadableTextColor(primaryHex),
    inkRgb: "245, 247, 255",
    sandRgb: hexToRgbString(sandHex),
    steelRgb: hexToRgbString(steelHex),
    nightRgb: hexToRgbString(nightHex),
    slateRgb: hexToRgbString(slateHex),
    gridRgb: "255, 255, 255",
    placeholderRgb: hexToRgbString(steelHex),
  };
}

export function getThemeTokens(preference: ThemePreference, favoriteTeam?: Team | null) {
  const normalized = normalizeThemePreference(preference);
  if (normalized === "favorite_team" && favoriteTeam) {
    return buildFavoriteTeamTheme(favoriteTeam);
  }

  const resolved = resolveThemePreference(normalized);
  return resolved === "day_blue" ? DAY_BLUE_THEME : NIGHT_THEME;
}

function clearAutoThemeSync() {
  if (autoThemeCleanup) {
    autoThemeCleanup();
    autoThemeCleanup = null;
  }
}

function applyThemeTokens(theme: AppThemeTokens) {
  const root = document.documentElement;
  root.dataset.appTheme = theme.key;
  root.dataset.appSurface = theme.surfaceMode;
  root.style.colorScheme = theme.colorScheme;
  root.style.setProperty("--app-bg-top", theme.bgTop);
  root.style.setProperty("--app-bg-mid", theme.bgMid);
  root.style.setProperty("--app-bg-bottom", theme.bgBottom);
  root.style.setProperty("--app-surface-card-bg", theme.surfaceCardBg);
  root.style.setProperty("--app-surface-strong-bg", theme.surfaceStrongBg);
  root.style.setProperty("--app-surface-subtle-bg", theme.surfaceSubtleBg);
  root.style.setProperty("--app-surface-soft-bg", theme.surfaceSoftBg);
  root.style.setProperty("--app-surface-soft-hover-bg", theme.surfaceSoftHoverBg);
  root.style.setProperty("--app-border-soft", theme.borderSoft);
  root.style.setProperty("--app-border-strong", theme.borderStrong);
  root.style.setProperty("--app-accent-hex", theme.accentHex);
  root.style.setProperty("--app-accent-rgb", theme.accentRgb);
  root.style.setProperty("--app-primary-hex", theme.primaryHex);
  root.style.setProperty("--app-primary-rgb", theme.primaryRgb);
  root.style.setProperty("--app-primary-text", theme.primaryText);
  root.style.setProperty("--app-ink-rgb", theme.inkRgb);
  root.style.setProperty("--app-sand-rgb", theme.sandRgb);
  root.style.setProperty("--app-steel-rgb", theme.steelRgb);
  root.style.setProperty("--app-night-rgb", theme.nightRgb);
  root.style.setProperty("--app-slate-rgb", theme.slateRgb);
  root.style.setProperty("--app-grid-rgb", theme.gridRgb);
  root.style.setProperty("--app-placeholder-rgb", theme.placeholderRgb);
}

export function applyAppTheme(preference: ThemePreference, favoriteTeam?: Team | null) {
  if (typeof document === "undefined") {
    return;
  }

  clearAutoThemeSync();
  const normalized = normalizeThemePreference(preference);
  const syncTheme = () => applyThemeTokens(getThemeTokens(normalized, favoriteTeam));
  syncTheme();

  if (normalized === "auto" && typeof window !== "undefined" && typeof window.matchMedia === "function") {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = () => syncTheme();
    mediaQuery.addEventListener("change", handleChange);
    autoThemeCleanup = () => {
      mediaQuery.removeEventListener("change", handleChange);
    };
  }
}

export function resetAppTheme() {
  applyAppTheme("night");
}
