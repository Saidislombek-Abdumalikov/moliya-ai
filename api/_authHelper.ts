import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import { supabase, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from './_supabaseClient.js';

// Anon key for client-side-style sign-in on backend (to get real session tokens)
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFqdW1uanpiZ2psZGJ3d2x1Z2dyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY5Nzc0ODIsImV4cCI6MjEwMjU1MzQ4Mn0.zHMIbL50xmrlhtpkpGdewvcWvsBJUAHyo5lS1hdU910';

const AUTH_SALT = 'moliya_tg_auth_v1';

function generateAuthEmail(tgId: string): string {
  return `tg${tgId}@moliya.app`;
}

function generateAuthPassword(tgId: string): string {
  const secret = SUPABASE_SERVICE_ROLE_KEY || 'moliya_master_auth_secret_v1_2026';
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
      // If user already exists, update their password and email confirmation to ensure signInWithPassword works
      if (msg.includes('already been registered') || msg.includes('already exists') || msg.includes('duplicate')) {
        try {
          const { data: usersData } = await supabase.auth.admin.listUsers({ perPage: 1000 });
          const existingUser = usersData?.users?.find(u => u.email === email);
          if (existingUser) {
            await supabase.auth.admin.updateUserById(existingUser.id, {
              password,
              email_confirm: true,
              user_metadata: {
                telegram_id: tgId,
                name: metadata?.name || existingUser.user_metadata?.name || '',
                telegram: metadata?.telegram || existingUser.user_metadata?.telegram || '',
                provider: 'telegram'
              }
            });
          }
        } catch (updateErr: any) {
          console.error('[AUTH_HELPER] Error updating existing auth user:', updateErr.message);
        }
      } else {
        console.error('[AUTH_HELPER] Error creating Supabase Auth user:', msg);
      }
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
