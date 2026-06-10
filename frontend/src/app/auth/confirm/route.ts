import type { EmailOtpType } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

import { createSupabaseServerClient } from "@/lib/supabase/server";

function getSafeNextPath(request: NextRequest, type: EmailOtpType | null) {
  const nextPath = request.nextUrl.searchParams.get("next");
  if (nextPath?.startsWith("/")) {
    return nextPath;
  }
  if (type === "recovery" || type === "invite") {
    return "/reset-password";
  }
  return "/dashboard";
}

function buildRedirect(request: NextRequest, pathname: string, error?: string) {
  const redirectUrl = request.nextUrl.clone();
  redirectUrl.pathname = pathname;
  redirectUrl.search = "";

  if (error) {
    redirectUrl.searchParams.set("error", error);
  }

  return redirectUrl;
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const successPath = getSafeNextPath(request, type);

  const supabase = await createSupabaseServerClient();

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      return NextResponse.redirect(buildRedirect(request, successPath));
    }

    return NextResponse.redirect(buildRedirect(request, "/login", "No se pudo completar el acceso."));
  }

  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({
      type,
      token_hash: tokenHash,
    });

    if (!error) {
      return NextResponse.redirect(buildRedirect(request, successPath));
    }
  }

  const fallbackPath = type === "recovery" ? "/reset-password" : "/login";
  const fallbackError =
    type === "recovery"
      ? "El enlace para restablecer tu contrasena es invalido o ya expiro."
      : "El enlace de confirmacion es invalido o ya expiro.";

  return NextResponse.redirect(buildRedirect(request, fallbackPath, fallbackError));
}
