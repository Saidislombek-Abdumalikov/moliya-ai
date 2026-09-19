import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';

// Parse .env manually
const envPath = path.resolve(process.cwd(), '.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  for (const line of envContent.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx > 0) {
      const key = trimmed.slice(0, eqIdx).trim();
      let val = trimmed.slice(eqIdx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = val;
    }
  }
}

import { createSupabaseAuthSession } from '../api/_authHelper.js';

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const service = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function main() {
  console.log('=== TESTING PRIVILEGED FIELD TAMPERING BY AUTHENTICATED USER ===\n');

  const testTgId = '888777666';
  const testUserId = `moliya_user_tg_${testTgId}`;

  // 1. Create Supabase Auth session for test user
  console.log('1. Creating real Supabase Auth user session...');
  const session = await createSupabaseAuthSession(testTgId, { name: 'Tamper Tester' });
  if (!session?.access_token || !session.auth_user_id) {
    console.error('Failed to create auth session!');
    return;
  }
  console.log('   Authenticated User created:', {
    auth_user_id: session.auth_user_id,
    token_preview: session.access_token.slice(0, 20) + '...'
  });

  // Ensure record exists in public.users with is_premium: false
  await service.from('users').upsert({
    id: testUserId,
    name: 'Tamper Tester',
    telegram_id: testTgId,
    auth_user_id: session.auth_user_id,
    is_premium: false,
    ai_limit: 10,
    is_blocked: false,
    cards: [],
    transactions: []
  });

  // 2. Create an authenticated Supabase client using the user's JWT access_token
  const authClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: {
      headers: {
        Authorization: `Bearer ${session.access_token}`
      }
    }
  });

  // Verify authClient sees self as authenticated
  const { data: userAuth } = await authClient.auth.getUser(session.access_token);
  console.log('   Client authenticated as:', userAuth?.user?.id);

  // 3. Test: Can this authenticated non-admin user change is_premium directly?
  console.log('\n2. Testing direct UPDATE on is_premium: true...');
  const { data: updateRes, error: updateErr } = await authClient
    .from('users')
    .update({ is_premium: true })
    .eq('id', testUserId)
    .select();

  console.log('   Direct update result:', {
    error: updateErr ? updateErr.message : 'NONE (UPDATE ALLOWED!)',
    updatedRows: updateRes?.length
  });

  // Check in database via service role
  const { data: dbCheck } = await service.from('users').select('id, is_premium, ai_limit').eq('id', testUserId).single();
  console.log('   Database state for user:', dbCheck);

  // 4. Test: Can this authenticated user read User B?
  console.log('\n3. Testing User A -> User B read isolation...');
  const victimUserId = 'moliya_user_tg_8890883928';
  const { data: victimRead, error: victimErr } = await authClient
    .from('users')
    .select('id, name, cards, transactions')
    .eq('id', victimUserId);

  console.log('   Attempt to read Victim User B:', {
    error: victimErr ? victimErr.message : undefined,
    rowsReturned: victimRead?.length,
    data: victimRead
  });

  // Cleanup
  await service.from('users').delete().eq('id', testUserId);
  await service.auth.admin.deleteUser(session.auth_user_id);
}

main().catch(console.error);
