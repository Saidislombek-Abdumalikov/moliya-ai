import { createClient } from '@supabase/supabase-js';

import fs from 'fs';
import path from 'path';

// If running in local Node environment and env vars are not set, load from .env
if (typeof process !== 'undefined' && !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  try {
    const envPath = path.resolve(process.cwd(), '.env');
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf8');
      for (const line of content.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eq = trimmed.indexOf('=');
        if (eq > 0) {
          const k = trimmed.slice(0, eq).trim();
          let v = trimmed.slice(eq + 1).trim();
          if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
            v = v.slice(1, -1);
          }
          if (!process.env[k]) {
            process.env[k] = v;
          }
        }
      }
    }
  } catch {}
}

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://qjumnjzbgjldbwwluggr.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

export { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY };

export const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY || 'MISSING_SUPABASE_SERVICE_ROLE_KEY',
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    }
  }
);
