// Only public values. process.env.NEXT_PUBLIC_* must be referenced literally so Next.js inlines them.
export const env = {
  appEnv: process.env.NEXT_PUBLIC_APP_ENV ?? "production",
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
  apiBase: (process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000").replace(/\/$/, ""),
};

export const isDev = env.appEnv === "development";
