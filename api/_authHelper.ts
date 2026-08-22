import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import { supabase, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from './_supabaseClient.js';

// Anon key for client-side-style sign-in on backend (to get real session tokens)
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';

export const MOLIYA_AUTH_SECRET = process.env.MOLIYA_AUTH_SECRET || '';

export function generateAuthEmail(tgId: string): string {
  const cleanTgId = String(tgId).trim();
  return `tg${cleanTgId}@moliya.app`;
}

/**
 * Version 2 (NEW) Password Derivation
 * Derived strictly using MOLIYA_AUTH_SECRET with versioned prefix.
 */
export function deriveV2Password(tgId: string, customSecret?: string): string {
  const secret = customSecret || MOLIYA_AUTH_SECRET || SUPABASE_SERVICE_ROLE_KEY || 'moliya_auth_secret_v2_fallback';
  return crypto.createHmac('sha256', secret).update(`moliya_tg_auth_v2_${String(tgId).trim()}`).digest('hex');
}

/**
 * Version 1 (LEGACY) Password Derivation
 * Maintained strictly for transparent backward-compatible migration of existing accounts.
 */
export function deriveLegacyV1Password(tgId: string, customSecret?: string): string {
  const secret = customSecret || SUPABASE_SERVICE_ROLE_KEY || 'moliya_master_auth_secret_v1_2026';
  return crypto.createHmac('sha256', secret).update(`moliya_tg_auth_v1_${String(tgId).trim()}`).digest('hex');
}

/**
 * Links public.users.auth_user_id to the Supabase Auth UUID
 * ensuring strict 1:1 relational identity mapping.
 */
export async function linkAuthUserIdentity(tgId: string, authUserId: string): Promise<void> {
  if (!tgId || !authUserId) return;
  try {
    const userId = `moliya_user_tg_${tgId}`;
    await supabase.from('users').update({
      auth_user_id: authUserId,
      updated_at: new Date().toISOString()
    }).eq('id', userId);
  } catch (err: any) {
    console.error('[AUTH_HELPER] Failed to link auth_user_id:', err.message);
  }
}

/**
 * Creates (or finds) a Supabase Auth user for the given Telegram ID,
 * transparently upgrades legacy credentials to v2, signs them in,
 * links public.users.auth_user_id, and returns real access_token + refresh_token.
 */
export async function createSupabaseAuthSession(
  tgId: string,
  metadataOrToken?: string | { name?: string; telegram?: string },
  name?: string,
  telegram?: string
): Promise<{
  access_token: string;
  refresh_token: string;
  expires_in: number;
  auth_user_id: string;
} | null> {
  const cleanTgId = String(tgId).trim();
  const meta: { name: string; telegram: string } = {
    name: typeof metadataOrToken === 'object' ? (metadataOrToken?.name || '') : (name || ''),
    telegram: typeof metadataOrToken === 'object' ? (metadataOrToken?.telegram || '') : (telegram || '')
  };
  const email = generateAuthEmail(cleanTgId);
  const v2Password = deriveV2Password(cleanTgId);
  const v1Password = deriveLegacyV1Password(cleanTgId);

  // Anon client to execute password sign-in (or service client if anon key is not set)
  const effectiveAuthKey = SUPABASE_ANON_KEY || SUPABASE_SERVICE_ROLE_KEY || 'MISSING_AUTH_KEY';
  const anonClient = createClient(SUPABASE_URL, effectiveAuthKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  try {
    // ── STEP 1: Attempt sign-in with NEW v2 Password ──────────────────────────
    const { data: v2SignIn, error: v2Error } = await anonClient.auth.signInWithPassword({
      email,
      password: v2Password
    });

    if (v2SignIn?.session && v2SignIn.user) {
      await linkAuthUserIdentity(cleanTgId, v2SignIn.user.id);
      return {
        access_token: v2SignIn.session.access_token,
        refresh_token: v2SignIn.session.refresh_token,
        expires_in: v2SignIn.session.expires_in,
        auth_user_id: v2SignIn.user.id
      };
    }

    // ── STEP 2: Attempt sign-in with LEGACY v1 Password ──────────────────────
    const { data: v1SignIn, error: v1Error } = await anonClient.auth.signInWithPassword({
      email,
      password: v1Password
    });

    if (v1SignIn?.session && v1SignIn.user) {
      console.log(`[AUTH_HELPER] 🔄 Transparently migrating legacy v1 user ${cleanTgId} to v2 password.`);
      // Transparently update password to v2 in Supabase Auth
      try {
        await supabase.auth.admin.updateUserById(v1SignIn.user.id, {
          password: v2Password,
          email_confirm: true
        });
      } catch (migrateErr: any) {
        console.error('[AUTH_HELPER] Warning: Could not update user password to v2:', migrateErr.message);
      }

      await linkAuthUserIdentity(cleanTgId, v1SignIn.user.id);
      return {
        access_token: v1SignIn.session.access_token,
        refresh_token: v1SignIn.session.refresh_token,
        expires_in: v1SignIn.session.expires_in,
        auth_user_id: v1SignIn.user.id
      };
    }

    // ── STEP 3: User does not exist or needs initial account creation ────────
    const { data: createdUserData, error: createError } = await supabase.auth.admin.createUser({
      email,
      password: v2Password,
      email_confirm: true,
      user_metadata: {
        telegram_id: cleanTgId,
        name: meta.name || '',
        telegram: meta.telegram || '',
        provider: 'telegram'
      }
    });

    if (createError) {
      const msg = createError.message || '';
      // If user was already registered under different password, update password to v2
      if (msg.includes('already been registered') || msg.includes('already exists') || msg.includes('duplicate')) {
        try {
          const { data: usersData } = await supabase.auth.admin.listUsers({ perPage: 1000 });
          const existingUser = usersData?.users?.find(u => u.email === email);
          if (existingUser) {
            await supabase.auth.admin.updateUserById(existingUser.id, {
              password: v2Password,
              email_confirm: true,
              user_metadata: {
                telegram_id: cleanTgId,
                name: meta.name || existingUser.user_metadata?.name || '',
                telegram: meta.telegram || existingUser.user_metadata?.telegram || '',
                provider: 'telegram'
              }
            });
          }
        } catch (updateErr: any) {
          console.error('[AUTH_HELPER] Error updating existing auth user to v2:', updateErr.message);
        }
      } else {
        console.error('[AUTH_HELPER] Error creating Supabase Auth user:', msg);
      }
    }

    // ── STEP 4: Final sign-in with v2 password ───────────────────────────────
    const { data: finalSignIn, error: finalError } = await anonClient.auth.signInWithPassword({
      email,
      password: v2Password
    });

    if (finalError || !finalSignIn?.session) {
      console.error('[AUTH_HELPER] Final Sign-in failed:', finalError?.message);
      return null;
    }

    console.log('[AUTH_HELPER] ✅ Supabase Auth session established (v2) for tg:', cleanTgId);
    await linkAuthUserIdentity(cleanTgId, finalSignIn.user.id);

    return {
      access_token: finalSignIn.session.access_token,
      refresh_token: finalSignIn.session.refresh_token,
      expires_in: finalSignIn.session.expires_in,
      auth_user_id: finalSignIn.user.id
    };
  } catch (err: any) {

    console.error('[AUTH_HELPER] ❌ Unexpected error in createSupabaseAuthSession:', err.message);
    return null;
  }
}


