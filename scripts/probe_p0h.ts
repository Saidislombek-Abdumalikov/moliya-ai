import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';

// Parse .env manually
const envPath = path.resolve(process.cwd(), '.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const idx = trimmed.indexOf('=');
      if (idx > 0) {
        const key = trimmed.slice(0, idx).trim();
        const val = trimmed.slice(idx + 1).trim();
        if (!process.env[key]) process.env[key] = val;
      }
    }
  }
}

const anon = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!);
const service = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function main() {
  console.log('=== P0-H PROBE: CURRENT DATABASE PERMISSIONS ===');

  console.log('\n1. Probing users table with anon key:');
  const { data: anonUsers, error: anonUsersErr } = await anon.from('users').select('id, name, is_premium, cards, transactions').limit(2);
  if (anonUsersErr) {
    console.log('   Anon users SELECT error:', anonUsersErr.message);
  } else {
    console.log('   Anon users SELECT count:', anonUsers?.length);
    if (anonUsers && anonUsers.length > 0) {
      console.log('   [CRITICAL RISK] Anon client can read users:', anonUsers.map(u => ({ id: u.id, name: u.name, is_premium: u.is_premium })));
    }
  }

  console.log('\n2. Probing ai_logs table with anon key:');
  const { data: anonLogs, error: anonLogsErr } = await anon.from('ai_logs').select('*').limit(2);
  if (anonLogsErr) {
    console.log('   Anon ai_logs SELECT error:', anonLogsErr.message);
  } else {
    console.log('   Anon ai_logs SELECT count:', anonLogs?.length);
    if (anonLogs && anonLogs.length > 0) {
      console.log('   [CRITICAL RISK] Anon client can read ai_logs!');
    }
  }

  console.log('\n3. Probing app_notifications table with anon key:');
  const { data: anonNotifs, error: anonNotifsErr } = await anon.from('app_notifications').select('*').limit(2);
  if (anonNotifsErr) {
    console.log('   Anon app_notifications SELECT error:', anonNotifsErr.message);
  } else {
    console.log('   Anon app_notifications SELECT count:', anonNotifs?.length);
  }

  console.log('\n4. Probing ai_keys table with anon key:');
  const { data: anonKeys, error: anonKeysErr } = await anon.from('ai_keys').select('*').limit(2);
  if (anonKeysErr) {
    console.log('   Anon ai_keys SELECT error (EXPECTED/SECURE):', anonKeysErr.message);
  } else {
    console.log('   Anon ai_keys SELECT count:', anonKeys?.length);
  }

  console.log('\n5. Probing service role access:');
  const { count: userCount, error: sErr } = await service.from('users').select('*', { count: 'exact', head: true });
  console.log('   Service role total users:', userCount, 'Error:', sErr?.message || 'none');
}

main().catch(console.error);
