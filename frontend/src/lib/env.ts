const rawApiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000/api/v1";
const rawSiteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
const defaultWorldCupLogoUrl =
  "https://exmvulojkzfjivoykagb.supabase.co/storage/v1/object/public/LOGOS/2026_FIFA_World_Cup_emblem.svg.png";

export const env = {
  appName: process.env.NEXT_PUBLIC_APP_NAME ?? "El Quinielón",
  apiBaseUrl: rawApiBaseUrl.replace(/\/+$/, ""),
  worldCupLogoUrl: process.env.NEXT_PUBLIC_WORLD_CUP_LOGO_URL ?? defaultWorldCupLogoUrl,
  whatsappGeneralUrl: process.env.NEXT_PUBLIC_WHATSAPP_GENERAL_URL ?? "",
  whatsappConversationUrl: process.env.NEXT_PUBLIC_WHATSAPP_CONVERSATION_URL ?? "",
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
  siteUrl: rawSiteUrl.replace(/\/+$/, ""),
};
