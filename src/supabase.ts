import { createClient } from '@supabase/supabase-js';

const getEnv = (key: string) => {
  if (typeof process !== 'undefined' && process.env && process.env[key]) {
    return process.env[key];
  }
  try {
    return (import.meta as any).env?.[key] || '';
  } catch {
    return '';
  }
};

export const SUPABASE_URL = getEnv('VITE_SUPABASE_URL') || getEnv('SUPABASE_URL') || 'https://qjumnjzbgjldbwwluggr.supabase.co';
export const SUPABASE_ANON_KEY = getEnv('VITE_SUPABASE_ANON_KEY') || getEnv('SUPABASE_ANON_KEY') || getEnv('SUPABASE_SERVICE_ROLE_KEY') || '';

if (!SUPABASE_ANON_KEY && typeof window !== 'undefined') {
  console.warn('[SUPABASE_CLIENT] Warning: VITE_SUPABASE_ANON_KEY environment variable is not defined.');
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY || 'MISSING_ANON_KEY');


