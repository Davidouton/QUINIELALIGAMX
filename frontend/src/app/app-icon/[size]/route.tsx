import { ImageResponse } from "next/og";

import { env } from "@/lib/env";
import type { AppBranding } from "@/types/api";

const CONTENT_TYPE = "image/png";

export const runtime = "nodejs";

function normalizeSize(rawSize: string) {
  const parsed = Number(rawSize);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 192;
  }

  if (parsed <= 32) {
    return 32;
  }
  if (parsed <= 180) {
    return 180;
  }
  if (parsed <= 192) {
    return 192;
  }
  return 512;
}

function AppIcon({ size, logoDataUrl }: { size: number; logoDataUrl: string }) {
  const borderRadius = Math.round(size * 0.24);
  const badgeSize = Math.round(size * 0.72);
  const logoSize = Math.round(size * 0.56);
  const accentCircle = Math.round(size * 0.16);

  return (
    <div
      style={{
        width: size,
        height: size,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        position: "relative",
        background:
          "linear-gradient(180deg, #07101d 0%, #091425 55%, #0a1322 100%)",
        color: "#f5f7ff",
        fontFamily: '"Avenir Next", "SF Pro Display", sans-serif',
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: Math.round(size * 0.08),
          borderRadius,
          border: "1px solid rgba(255,255,255,0.08)",
          background:
            "linear-gradient(145deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0.03) 100%)",
          boxShadow: "0 24px 60px rgba(3, 8, 20, 0.45)",
        }}
      />
      <div
        style={{
          width: badgeSize,
          height: badgeSize,
          borderRadius: Math.round(size * 0.18),
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          position: "relative",
          border: "1px solid rgba(255,255,255,0.10)",
          background:
            "linear-gradient(160deg, rgba(255,92,122,0.18) 0%, rgba(8,18,34,0.75) 55%, rgba(8,18,34,0.96) 100%)",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: Math.round(size * 0.09),
            right: Math.round(size * 0.09),
            width: accentCircle,
            height: accentCircle,
            borderRadius: 999,
            background: "#ff5c7a",
            boxShadow: "0 0 28px rgba(255,92,122,0.55)",
          }}
        />
        <img
          src={logoDataUrl}
          alt="FIFA World Cup"
          style={{
            width: logoSize,
            height: logoSize,
            objectFit: "contain",
            filter: "drop-shadow(0 14px 26px rgba(3, 8, 20, 0.45))",
          }}
        />
      </div>
    </div>
  );
}

async function loadAppBranding() {
  try {
    const response = await fetch(`${env.apiBaseUrl}/branding`, {
      cache: "no-store",
    });
    if (!response.ok) {
      return null;
    }
    return (await response.json()) as AppBranding;
  } catch {
    return null;
  }
}

async function buildLogoDataUrl() {
  const branding = await loadAppBranding();
  const sourceUrl = branding?.app_icon_url?.trim() || env.worldCupLogoUrl;
  const response = await fetch(sourceUrl, {
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`No se pudo cargar el icono de app: ${response.status}`);
  }

  const contentType = response.headers.get("content-type") || "image/png";
  const buffer = Buffer.from(await response.arrayBuffer());
  return `data:${contentType};base64,${buffer.toString("base64")}`;
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ size: string }> },
) {
  const { size: rawSize } = await context.params;
  const size = normalizeSize(rawSize);
  const logoDataUrl = await buildLogoDataUrl();

  return new ImageResponse(<AppIcon size={size} logoDataUrl={logoDataUrl} />, {
    width: size,
    height: size,
    headers: {
      "Content-Type": CONTENT_TYPE,
      "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
    },
  });
}
