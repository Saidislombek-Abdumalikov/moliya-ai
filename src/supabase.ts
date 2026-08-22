import { createClient } from '@supabase/supabase-js';

export const SUPABASE_URL = (import.meta as any).env?.VITE_SUPABASE_URL || 'https://qjumnjzbgjldbwwluggr.supabase.co';
export const SUPABASE_ANON_KEY = (import.meta as any).env?.VITE_SUPABASE_ANON_KEY || '';

if (!SUPABASE_ANON_KEY && typeof window !== 'undefined') {
  console.warn('[SUPABASE_CLIENT] Warning: VITE_SUPABASE_ANON_KEY environment variable is not defined.');
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY || 'MISSING_ANON_KEY');

