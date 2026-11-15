/// <reference types="vite/client" />
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY: string;
  readonly VITE_MAPTILER_KEY: string;
  readonly VITE_OSM_TILES_URL?: string;
}
