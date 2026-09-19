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
  console.log('=== INSPECTING EXACT SCHEMA TYPES ===\n');

  // 1. Inspect telegram_id column behavior
  // Insert a test user with alphanumeric string into telegram_id
  const testId = 'test_schema_check_' + Date.now();
  
  // Try inserting string 'alpha_123'
  const { error: textErr } = await service.from('users').insert([{
    id: testId,
    telegram_id: 'alpha_test_val'
  }]);

  if (textErr) {
    console.log('Inserting string "alpha_test_val" failed:', textErr.message);
    if (textErr.message.includes('bigint') || textErr.message.includes('integer') || textErr.message.includes('numeric')) {
      console.log('=> telegram_id is NUMERIC / BIGINT');
    }
  } else {
    console.log('Inserting string "alpha_test_val" SUCCEEDED!');
    console.log('=> telegram_id is definitely TEXT / VARCHAR (stores arbitrary strings)');
    // Clean up
    await service.from('users').delete().eq('id', testId);
  }

  // 2. Fetch an existing user row to see sample values
  const { data: sampleUsers } = await service.from('users').select('id, telegram_id, auth_user_id').not('telegram_id', 'is', null).limit(3);
  console.log('\nSample existing telegram_id values:', sampleUsers);

  // 3. Inspect app_notifications table
  console.log('\n=== INSPECTING app_notifications TABLE ===');
  const { data: notifs, error: notifErr } = await service.from('app_notifications').select('*').limit(10);
  if (notifErr) {
    console.error('Error querying app_notifications:', notifErr.message);
  } else {
    console.log(`Found ${notifs?.length || 0} rows in app_notifications:`);
    for (const n of notifs || []) {
      console.log('  Row:', {
        id: n.id,
        title: n.title,
        target: n.target,
        user_id: (n as any).user_id,
        telegram_id: (n as any).telegram_id,
        created_at: n.created_at
      });
      console.log('  Full keys in row:', Object.keys(n));
    }
  }
}

main().catch(console.error);
