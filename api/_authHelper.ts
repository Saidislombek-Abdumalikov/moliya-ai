import { safeLog, safeError } from './_logger.js';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import { supabase, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from './_supabaseClient.js';

// Anon key for client-side-style sign-in on backend (to get real session tokens)
const SUPABASE_ANON_KEY = (process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '').trim();

const AUTH_SALT = 'moliya_tg_auth_v1';

function generateAuthEmail(tgId: string): string {
  return `tg${tgId}@moliya.app`;
}

function generateAuthPassword(tgId: string): string {
  const secret = (process.env.MOLIYA_AUTH_SECRET || SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!secret) {
    throw new Error('Authentication secret (MOLIYA_AUTH_SECRET or SUPABASE_SERVICE_ROLE_KEY) is not configured');
  }
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
          const { data: usersData, error: listError } = await supabase.auth.admin.listUsers({ perPage: 1000 });
          if (listError) throw listError;
          const existingUser = usersData.users.find(u => u.email === email);
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
          safeError('[AUTH_HELPER] Error updating existing auth user:', updateErr.message);
        }
      } else {
        safeError('[AUTH_HELPER] Error creating Supabase Auth user:', msg);
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
      safeError('[AUTH_HELPER] Sign-in failed:', signInError?.message);
      return null;
    }

    safeLog('[AUTH_HELPER] ✅ Supabase Auth session created for tg:', tgId);

    return {
      access_token: signInData.session.access_token,
      refresh_token: signInData.session.refresh_token,
      expires_in: signInData.session.expires_in,
      auth_user_id: signInData.user?.id || ''
    };
  } catch (err: any) {
    safeError('[AUTH_HELPER] ❌ Unexpected error:', err.message);
    return null;
  }
}

export function isValidPhoneNumber(phone: any): boolean {
  if (!phone || typeof phone !== 'string') return false;
  const digits = phone.replace(/\D/g, '');
  return (digits.length === 12 && digits.startsWith('998')) || (digits.length === 9);
}

