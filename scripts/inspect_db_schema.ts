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

const service = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function main() {
  console.log('=== INSPECTING SUPABASE USERS TABLE SCHEMA ===');

  // Fetch users to see column names and types
  const { data: users, error } = await service.from('users').select('*').limit(5);
  if (error) {
    console.error('Error fetching users:', error);
    return;
  }

  if (users && users.length > 0) {
    console.log('Columns on users table:');
    for (const key of Object.keys(users[0])) {
      const val = users[0][key];
      console.log(`  - ${key}: value=${JSON.stringify(val)?.slice(0, 50)} (typeof: ${typeof val})`);
    }

    // Look for rows that have auth_user_id
    const userWithAuth = users.find(u => u.auth_user_id);
    if (userWithAuth) {
      console.log('\nUser with auth_user_id found:', {
        id: userWithAuth.id,
        telegram_id: userWithAuth.telegram_id,
        auth_user_id: userWithAuth.auth_user_id,
        type: typeof userWithAuth.auth_user_id
      });
    } else {
      console.log('\nNo user in top 5 had auth_user_id. Querying specifically for not null:');
      const { data: authUsers } = await service.from('users').select('id, telegram_id, auth_user_id').not('auth_user_id', 'is', null).limit(2);
      console.log('Auth users:', authUsers);
    }
  }

  // Check current policies on all tables
  console.log('\n=== CHECKING CURRENT POLICIES & RLS STATUS ===');
  // Can test query with anon client to see what is currently blocked or open
  const anon = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!);

  const { data: anonUsers, error: anonUsersErr } = await anon.from('users').select('id').limit(1);
  console.log('Anon users query:', { success: !anonUsersErr, error: anonUsersErr?.message });

  const { data: anonLogs, error: anonLogsErr } = await anon.from('ai_logs').select('id').limit(1);
  console.log('Anon ai_logs query:', { success: !anonLogsErr, error: anonLogsErr?.message });

  const { data: anonNotifs, error: anonNotifsErr } = await anon.from('app_notifications').select('id').limit(1);
  console.log('Anon app_notifications query:', { success: !anonNotifsErr, error: anonNotifsErr?.message });
}

main().catch(console.error);
