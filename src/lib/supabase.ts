import { createClient } from '@supabase/supabase-js';
const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
if (!url || !key) console.warn('Configure VITE_SUPABASE_URL e VITE_SUPABASE_PUBLISHABLE_KEY no .env.');
export const supabase = createClient(url || 'https://invalid.example', key || 'placeholder', {
  auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: true },
});
