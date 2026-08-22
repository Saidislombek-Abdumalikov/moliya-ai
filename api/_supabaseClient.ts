import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
import path from 'node:path';

// Automatically populate process.env from local .env file if present in Node runtime
if (!process.env.SUPABASE_SERVICE_ROLE_KEY && typeof process !== 'undefined' && typeof process.cwd === 'function') {
  try {
    const envPath = path.resolve(process.cwd(), '.env');
    if (fs.existsSync(envPath)) {
      const envContent = fs.readFileSync(envPath, 'utf8');
      envContent.split('\n').forEach(line => {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
          const idx = trimmed.indexOf('=');
          const key = trimmed.slice(0, idx).trim();
          const val = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
          if (!process.env[key]) {
            process.env[key] = val;
          }
        }
      });
    }
  } catch (_) {}
}

export const SUPABASE_URL = process.env.SUPABASE_URL || 'https://qjumnjzbgjldbwwluggr.supabase.co';
export const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!SUPABASE_SERVICE_ROLE_KEY && process.env.NODE_ENV === 'production') {
  console.error('[SUPABASE_SERVER] CRITICAL: SUPABASE_SERVICE_ROLE_KEY environment variable is missing.');
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY || 'MISSING_SERVICE_ROLE_KEY', {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  }
});


