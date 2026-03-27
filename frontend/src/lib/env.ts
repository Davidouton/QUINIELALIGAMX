export const env = {
  appName: process.env.NEXT_PUBLIC_APP_NAME ?? "QuinielaMaestra",
  apiBaseUrl: process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000/api/v1",
  ligaMxLogoUrl: process.env.NEXT_PUBLIC_LIGA_MX_LOGO_URL ?? "",
  betoImageUrl: process.env.NEXT_PUBLIC_BETO_IMAGE_URL ?? "",
  whatsappGeneralUrl: process.env.NEXT_PUBLIC_WHATSAPP_GENERAL_URL ?? "",
  whatsappConversationUrl: process.env.NEXT_PUBLIC_WHATSAPP_CONVERSATION_URL ?? "",
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
  siteUrl: process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
};
