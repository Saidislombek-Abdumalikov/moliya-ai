import fs from 'fs';
import { createClient } from '@supabase/supabase-js';

const envText = fs.readFileSync('.env', 'utf8');
const env = {};
envText.split('\n').forEach(line => {
  const [k, ...v] = line.split('=');
  if (k && v) env[k.trim()] = v.join('=').trim();
});

const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

function maskKey(k) {
  if (!k || k.length < 8) return '••••••••••••';
  return '••••••••••••' + k.slice(-4);
}

async function validateGeminiKey(apiKey) {
  const startTime = Date.now();
  const testUrl = https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=;
  try {
    const res = await fetch(testUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: 'ping' }] }],
        generationConfig: { maxOutputTokens: 1, temperature: 0 }
      })
    });
    const latencyMs = Date.now() - startTime;
    if (res.ok) {
      return { valid: true, latencyMs };
    }
    const errData = await res.json().catch(() => ({}));
    return { valid: false, error: errData.error?.message || HTTP  };
  } catch (e) {
    return { valid: false, error: e.message };
  }
}

export async function rotateKeys(newKeyList) {
  if (!Array.isArray(newKeyList) || newKeyList.length === 0) {
    console.error('No new keys provided.');
    return { success: false, error: 'No keys provided' };
  }

  console.log(Starting rotation with  new key(s)...);

  const validatedKeys = [];
  for (let i = 0; i < newKeyList.length; i++) {
    const raw = newKeyList[i].trim();
    if (!raw) continue;
    console.log(Validating key # ()...);
    const valResult = await validateGeminiKey(raw);
    if (!valResult.valid) {
      console.error(❌ Key # () failed validation: );
    } else {
      console.log(✅ Key # () is healthy (ms));
      validatedKeys.push({ key: raw, latencyMs: valResult.latencyMs });
    }
  }

  if (validatedKeys.length === 0) {
    console.error('❌ None of the provided keys passed validation. Aborting rotation.');
    return { success: false, error: 'All keys failed validation' };
  }

  // Fetch current database keys
  const { data: existingKeys, error } = await supabase
    .from('ai_keys')
    .select('*')
    .order('priority', { ascending: true });

  if (error) {
    console.error('Error fetching existing keys:', error.message);
    return { success: false, error: error.message };
  }

  const nowIso = new Date().toISOString();
  const summary = [];

  // Update existing slots with new keys
  for (let i = 0; i < validatedKeys.length; i++) {
    const { key, latencyMs } = validatedKeys[i];
    const masked = maskKey(key);
    const slotName = KEY ;

    if (existingKeys && existingKeys[i]) {
      const existingId = existingKeys[i].id;
      const oldMasked = maskKey(existingKeys[i].api_key);
      console.log(Rotating Slot # (ID: ):  ➔ );

      await supabase.from('ai_keys').update({
        name: slotName,
        api_key: key,
        key_preview: masked,
        is_active: true,
        health_status: 'healthy',
        today_requests: 0,
        total_requests: 0,
        last_error: null,
        last_tested_at: nowIso,
        updated_at: nowIso
      }).eq('id', existingId);

      summary.push({ slot: i + 1, id: existingId, name: slotName, oldMasked, newMasked: masked, latencyMs });
    } else {
      console.log(Creating new Slot #: );
      const { data: inserted } = await supabase.from('ai_keys').insert({
        name: slotName,
        provider: 'gemini',
        api_key: key,
        key_preview: masked,
        model: 'gemini-3.5-flash-lite',
        priority: i + 1,
        is_active: true,
        health_status: 'healthy',
        today_requests: 0,
        total_requests: 0,
        created_at: nowIso,
        updated_at: nowIso
      }).select();

      summary.push({ slot: i + 1, id: inserted?.[0]?.id, name: slotName, oldMasked: 'none', newMasked: masked, latencyMs });
    }
  }

  // Revoke remaining old slots that were not rotated
  if (existingKeys && existingKeys.length > validatedKeys.length) {
    for (let i = validatedKeys.length; i < existingKeys.length; i++) {
      const oldKey = existingKeys[i];
      const oldMasked = maskKey(oldKey.api_key);
      console.log(Revoking unrotated old slot # ()...);
      await supabase.from('ai_keys').delete().eq('id', oldKey.id);
    }
  }

  console.log('✅ Rotation complete in server storage.');
  return { success: true, summary };
}

const keyFilePath = 'c:/Users/Saidislom/Desktop/All the project/Antigravity/Moliya V2/.new_gemini_keys';
if (fs.existsSync(keyFilePath)) {
  const fileContent = fs.readFileSync(keyFilePath, 'utf8');
  const keys = fileContent.split('\n').map(k => k.trim()).filter(Boolean);
  rotateKeys(keys).then(() => {
    try { fs.unlinkSync(keyFilePath); } catch {}
  });
}
