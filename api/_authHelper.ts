import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import { supabase, SUPABASE_URL } from './_supabaseClient.js';

// Anon key for client-side-style sign-in on backend (to get real session tokens)
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFqdW1uanpiZ2psZGJ3d2x1Z2dyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY5Nzc0ODIsImV4cCI6MjEwMjU1MzQ4Mn0.zHMIbL50xmrlhtpkpGdewvcWvsBJUAHyo5lS1hdU910';

const AUTH_SALT = 'moliya_tg_auth_v1';

function generateAuthEmail(tgId: string): string {
  return `tg${tgId}@moliya.app`;
}

function generateAuthPassword(tgId: string): string {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY || 'moliya-fallback-secret';
  return crypto.createHmac('sha256', secret).update(`${AUTH_SALT}_${tgId}`).digest('hex');
}

/**
 * Creates (or finds) a Supabase Auth user for the given Telegram ID,
 * signs them in, and returns real access_token + refresh_token.
 */
export async function createSupabaseAuthSession(
  tgId: string,
  metadata?: { name?: string; telegram?: string }
): Promise<{
  access_token: string;
  refresh_token: string;
  expires_in: number;
  auth_user_id: string;
} | null> {
  const email = generateAuthEmail(tgId);
  const password = generateAuthPassword(tgId);

  try {
    // 1. Try to create Supabase Auth user (will fail if already exists — that's OK)
    const { error: createError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        telegram_id: tgId,
        name: metadata?.name || '',
        telegram: metadata?.telegram || '',
        provider: 'telegram'
      }
    });

    if (createError) {
      const msg = createError.message || '';
      if (!msg.includes('already been registered') && !msg.includes('already exists') && !msg.includes('duplicate')) {
        console.error('[AUTH_HELPER] Error creating Supabase Auth user:', msg);
      }
      // If user already exists, we'll just sign them in below
    }

    // 2. Sign in with a fresh anon-key client to get real session tokens
    const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false }
    });

    const { data: signInData, error: signInError } = await anonClient.auth.signInWithPassword({
      email,
      password
    });

    if (signInError || !signInData.session) {
      console.error('[AUTH_HELPER] Sign-in failed:', signInError?.message);

      // If sign-in fails because password doesn't match (user existed before our system),
      // try to update the password and retry
      if (signInError?.message?.includes('Invalid login credentials')) {
        try {
          // Find the user by email and update their password
          const { data: users } = await supabase.auth.admin.listUsers({ perPage: 1000 });
          const existingUser = users?.users?.find(u => u.email === email);
          if (existingUser) {
            await supabase.auth.admin.updateUserById(existingUser.id, { password });
            // Retry sign-in
            const { data: retryData, error: retryError } = await anonClient.auth.signInWithPassword({ email, password });
            if (!retryError && retryData.session) {
              console.log('[AUTH_HELPER] ✅ Supabase Auth session created (after password update) for tg:', tgId);
              return {
                access_token: retryData.session.access_token,
                refresh_token: retryData.session.refresh_token,
                expires_in: retryData.session.expires_in,
                auth_user_id: retryData.user?.id || ''
              };
            }
          }
        } catch (retryErr: any) {
          console.error('[AUTH_HELPER] Retry after password update failed:', retryErr.message);
        }
      }

      return null;
    }

    console.log('[AUTH_HELPER] ✅ Supabase Auth session created for tg:', tgId);

    return {
      access_token: signInData.session.access_token,
      refresh_token: signInData.session.refresh_token,
      expires_in: signInData.session.expires_in,
      auth_user_id: signInData.user?.id || ''
    };
  } catch (err: any) {
    console.error('[AUTH_HELPER] ❌ Unexpected error:', err.message);
    return null;
  }
}
