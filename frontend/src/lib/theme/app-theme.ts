import type { Team, ThemePreference } from "@/types/api";

const DEFAULT_THEME = {
  bgTop: "#07101d",
  bgMid: "#091425",
  bgBottom: "#0a1322",
  surfaceCardBg: "rgba(255, 255, 255, 0.05)",
  surfaceStrongBg: "rgba(13, 26, 48, 0.8)",
  accentHex: "#ff5c7a",
  accentRgb: "255, 92, 122",
  primaryHex: "#87e0a1",
  primaryRgb: "135, 224, 161",
  primaryText: "#07111f",
};

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

function buildThemeTokens(preference: ThemePreference, favoriteTeam?: Team | null) {
  if (preference !== "favorite_team" || !favoriteTeam) {
    return DEFAULT_THEME;
  }

  const primaryHex = normalizeHex(favoriteTeam.primary_color, DEFAULT_THEME.primaryHex);
  const secondaryHex = normalizeHex(favoriteTeam.secondary_color, DEFAULT_THEME.bgMid);
  const accentHex = normalizeHex(
    favoriteTeam.accent_color ?? favoriteTeam.secondary_color,
    DEFAULT_THEME.accentHex,
  );

  return {
    bgTop: mixHex(primaryHex, "#03070F", 0.8),
    bgMid: mixHex(secondaryHex, "#07111F", 0.72),
    bgBottom: mixHex(accentHex, "#050A14", 0.84),
    surfaceCardBg: `rgba(${hexToRgbString(primaryHex)}, 0.14)`,
    surfaceStrongBg: `rgba(${hexToRgbString(secondaryHex)}, 0.33)`,
    accentHex,
    accentRgb: hexToRgbString(accentHex),
    primaryHex,
    primaryRgb: hexToRgbString(primaryHex),
    primaryText: getReadableTextColor(primaryHex),
  };
}

export function applyAppTheme(preference: ThemePreference, favoriteTeam?: Team | null) {
  if (typeof document === "undefined") {
    return;
  }

  const theme = buildThemeTokens(preference, favoriteTeam);
  const root = document.documentElement;
  root.style.setProperty("--app-bg-top", theme.bgTop);
  root.style.setProperty("--app-bg-mid", theme.bgMid);
  root.style.setProperty("--app-bg-bottom", theme.bgBottom);
  root.style.setProperty("--app-surface-card-bg", theme.surfaceCardBg);
  root.style.setProperty("--app-surface-strong-bg", theme.surfaceStrongBg);
  root.style.setProperty("--app-accent-hex", theme.accentHex);
  root.style.setProperty("--app-accent-rgb", theme.accentRgb);
  root.style.setProperty("--app-primary-hex", theme.primaryHex);
  root.style.setProperty("--app-primary-rgb", theme.primaryRgb);
  root.style.setProperty("--app-primary-text", theme.primaryText);
}

export function resetAppTheme() {
  applyAppTheme("standard");
}
