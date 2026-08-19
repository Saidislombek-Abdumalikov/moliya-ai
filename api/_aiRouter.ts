import { GoogleGenAI, Type } from "@google/genai";
import { supabase } from './_supabaseClient.js';

export interface AiKeyRecord {
  id: string;
  name: string;
  provider: 'google' | 'openai' | 'groq' | 'anthropic';
  api_key: string;
  model: string;
  priority: number;
  status: 'active' | 'disabled' | 'rate_limited' | 'exhausted' | 'invalid';
  total_requests: number;
  success_requests: number;
  failed_requests: number;
  last_error?: string | null;
  last_error_at?: string | null;
  last_used_at?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface AiParseResult {
  success: boolean;
  type?: string;
  amount?: string;
  category?: string;
  note?: string;
  title?: string;
  debtWho?: string;
  items?: Array<{ name: string; amount: number }>;
  providerUsed?: string;
  keyIdUsed?: string;
  error?: string;
}

// In-memory runtime fallback storage if database table is initializing
let inMemoryKeys: AiKeyRecord[] = [];

/**
 * Safely masks secret API key (e.g., "AIzaSy...ABCD" -> "••••••••••••ABCD")
 */
export function maskApiKey(key: string): string {
  if (!key || key.length < 8) return '••••••••••••';
  return '••••••••••••' + key.slice(-4);
}

/**
 * Retrieves ordered list of active/candidate AI keys
 */
export async function getCandidateAiKeys(): Promise<AiKeyRecord[]> {
  try {
    const { data: dbKeys, error } = await supabase
      .from('ai_keys')
      .select('*')
      .neq('status', 'disabled')
      .neq('status', 'invalid')
      .order('priority', { ascending: true })
      .order('updated_at', { ascending: false });

    if (!error && Array.isArray(dbKeys) && dbKeys.length > 0) {
      return dbKeys;
    }
  } catch (err) {
    console.warn('[AI_ROUTER] Supabase ai_keys query notice:', err);
  }

  // Use in-memory keys if available
  const validMemoryKeys = inMemoryKeys.filter(k => k.status !== 'disabled' && k.status !== 'invalid');
  if (validMemoryKeys.length > 0) {
    return validMemoryKeys.sort((a, b) => a.priority - b.priority);
  }

  // Ultimate fallback to environment variables
  const envKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY || "";
  if (envKey) {
    return [
      {
        id: 'env_primary_gemini',
        name: 'Default Environment Key',
        provider: 'google',
        api_key: envKey,
        model: 'gemini-2.5-flash',
        priority: 1,
        status: 'active',
        total_requests: 0,
        success_requests: 0,
        failed_requests: 0
      }
    ];
  }

  return [];
}

/**
 * Updates AI Key stats in database and in-memory
 */
export async function recordKeyResult(
  keyId: string,
  isSuccess: boolean,
  errorMessage?: string,
  errorType?: 'rate_limited' | 'exhausted' | 'invalid' | 'temporary'
) {
  const nowIso = new Date().toISOString();

  // 1. Update in-memory
  const memKey = inMemoryKeys.find(k => k.id === keyId);
  if (memKey) {
    memKey.total_requests = (memKey.total_requests || 0) + 1;
    if (isSuccess) {
      memKey.success_requests = (memKey.success_requests || 0) + 1;
      memKey.last_used_at = nowIso;
      memKey.status = 'active';
    } else {
      memKey.failed_requests = (memKey.failed_requests || 0) + 1;
      memKey.last_error = errorMessage || 'Failed';
      memKey.last_error_at = nowIso;
      if (errorType && errorType !== 'temporary') {
        memKey.status = errorType;
      }
    }
  }

  // 2. Update Supabase
  try {
    const { data: current } = await supabase.from('ai_keys').select('*').eq('id', keyId).maybeSingle();
    if (current) {
      const updatePayload: any = {
        total_requests: (current.total_requests || 0) + 1,
        updated_at: nowIso
      };

      if (isSuccess) {
        updatePayload.success_requests = (current.success_requests || 0) + 1;
        updatePayload.last_used_at = nowIso;
        if (current.status === 'rate_limited') {
          updatePayload.status = 'active'; // Recovered
        }
      } else {
        updatePayload.failed_requests = (current.failed_requests || 0) + 1;
        updatePayload.last_error = errorMessage || 'Request failed';
        updatePayload.last_error_at = nowIso;
        if (errorType && errorType !== 'temporary') {
          updatePayload.status = errorType;
        }
      }

      await supabase.from('ai_keys').update(updatePayload).eq('id', keyId);
    }
  } catch (err) {
    console.warn('[AI_ROUTER] Supabase key stats update notice:', err);
  }
}

/**
 * Execute AI single prompt with Google GenAI SDK
 */
async function callGoogleGenAi(key: AiKeyRecord, prompt: string): Promise<any> {
  const ai = new GoogleGenAI({ apiKey: key.api_key });
  const modelName = key.model || 'gemini-2.5-flash';

  const response = await ai.models.generateContent({
    model: modelName,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          type: { type: Type.STRING },
          amount: { type: Type.NUMBER },
          category: { type: Type.STRING },
          note: { type: Type.STRING },
          title: { type: Type.STRING },
          debtWho: { type: Type.STRING },
        },
        required: ["type", "amount", "category", "note"],
      }
    }
  });

  if (!response?.text) throw new Error("Empty response from Google GenAI");
  return JSON.parse(response.text);
}

/**
 * Execute OpenAI / Groq / Generic REST API
 */
async function callOpenAiCompatible(key: AiKeyRecord, prompt: string): Promise<any> {
  const endpoint = key.provider === 'groq' 
    ? 'https://api.groq.com/openai/v1/chat/completions'
    : 'https://api.openai.com/v1/chat/completions';

  const model = key.model || (key.provider === 'groq' ? 'llama-3.3-70b-versatile' : 'gpt-4o-mini');

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${key.api_key}`
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: 'You are a financial parsing assistant. Return ONLY valid JSON with keys: type, amount, category, note, title, debtWho.' },
        { role: 'user', content: prompt }
      ],
      response_format: { type: 'json_object' }
    })
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`API error ${res.status}: ${errText}`);
  }

  const json: any = await res.json();
  const rawText = json?.choices?.[0]?.message?.content;
  if (!rawText) throw new Error("No completion choices returned");
  return JSON.parse(rawText);
}

/**
 * CENTRAL AI ROUTER — Executes financial transaction parsing with Automatic Key Rotation
 */
export async function executeAiWithRotation(promptText: string): Promise<AiParseResult> {
  const candidateKeys = await getCandidateAiKeys();

  if (candidateKeys.length === 0) {
    return {
      success: false,
      error: 'No active AI keys configured. Please add an AI key in Admin Dashboard.'
    };
  }

  const prompt = `You are a financial AI assistant for Moliya AI. Parse this transaction spoken transcript or written text in Uzbek, Russian, or English: "${promptText}".
Detect:
- type: 'expense' (spending), 'income' (salary/earnings), 'debt' (borrowed money), or 'lending' (loaned money to someone)
- amount: total amount in numbers (e.g. "45 ming" -> 45000, "1.5 mln" -> 1500000, "100 dollar" -> 100, "ellik ming" -> 50000)
- category: choose EXACTLY one from: ['Oziq-ovqat', 'Transport', 'Kiyim', 'Kommunal', 'Sog\\'liq', 'Ta\\'lim', 'Ko\\'ngil ochar', 'Boshqa', 'Maosh', 'Freelance', 'Biznes', 'Sovg\\'a', 'Investitsiya', 'Do\\'st', 'Bank', 'Oila', 'Hamkasb']
- note: meaningful description of the item or expense
- title: concise 2-3 word title
- debtWho: person or organization name if debt/lending, otherwise empty`;

  let lastErrorMsg = '';

  for (let i = 0; i < candidateKeys.length; i++) {
    const key = candidateKeys[i];
    console.log(`[AI_ROUTER] Attempting AI generation with Key #${i + 1} (${key.name} - ${key.provider}:${key.model})...`);

    try {
      let parsedJson: any = null;

      if (key.provider === 'google') {
        parsedJson = await callGoogleGenAi(key, prompt);
      } else {
        parsedJson = await callOpenAiCompatible(key, prompt);
      }

      if (parsedJson && (parsedJson.amount || parsedJson.category)) {
        // Success! Record usage stats for this key
        await recordKeyResult(key.id, true);
        const fmtAmt = Number(parsedJson.amount || 0).toLocaleString('en-US').replace(/,/g, ' ');

        return {
          success: true,
          type: parsedJson.type || 'expense',
          amount: fmtAmt,
          category: parsedJson.category || 'Boshqa',
          note: parsedJson.note || promptText,
          title: parsedJson.title || parsedJson.note || promptText,
          debtWho: parsedJson.debtWho || '',
          providerUsed: `${key.provider}:${key.model}`,
          keyIdUsed: key.id
        };
      }
    } catch (err: any) {
      const errMsg = err?.message || String(err);
      lastErrorMsg = errMsg;
      console.warn(`[AI_ROUTER] ⚠️ Key ${key.name} failed:`, errMsg);

      // Determine failure type
      let failureType: 'rate_limited' | 'exhausted' | 'invalid' | 'temporary' = 'temporary';
      if (errMsg.includes('429') || errMsg.includes('RESOURCE_EXHAUSTED') || errMsg.includes('quota') || errMsg.includes('rate limit')) {
        failureType = 'rate_limited';
      } else if (errMsg.includes('401') || errMsg.includes('403') || errMsg.includes('API_KEY_INVALID') || errMsg.includes('invalid api key')) {
        failureType = 'invalid';
      }

      await recordKeyResult(key.id, false, errMsg, failureType);

      // Continue to next available key in the rotation loop!
      console.log(`[AI_ROUTER] 🔄 Rotating to next available AI key...`);
    }
  }

  // All keys exhausted
  return {
    success: false,
    error: `AI parsing failed across all ${candidateKeys.length} configured provider keys. Last error: ${lastErrorMsg}`
  };
}

/**
 * Test a specific AI Key safely (Admin Dashboard Action)
 */
export async function testSpecificAiKey(keyData: {
  provider: 'google' | 'openai' | 'groq' | 'anthropic';
  api_key: string;
  model?: string;
}): Promise<{ healthy: boolean; status: string; latencyMs: number; error?: string }> {
  const start = Date.now();
  const testPrompt = 'Say "healthy" in JSON: {"status":"healthy"}';

  try {
    const dummyKey: AiKeyRecord = {
      id: 'test_key',
      name: 'Test Probe',
      provider: keyData.provider,
      api_key: keyData.api_key,
      model: keyData.model || (keyData.provider === 'google' ? 'gemini-1.5-flash' : 'gpt-4o-mini'),
      priority: 99,
      status: 'active',
      total_requests: 0,
      success_requests: 0,
      failed_requests: 0
    };

    if (dummyKey.provider === 'google') {
      const ai = new GoogleGenAI({ apiKey: dummyKey.api_key });
      const resp = await ai.models.generateContent({
        model: dummyKey.model,
        contents: "Respond with the word: OK",
      });
      if (resp?.text) {
        return { healthy: true, status: 'Healthy 🟢', latencyMs: Date.now() - start };
      }
    } else {
      await callOpenAiCompatible(dummyKey, testPrompt);
      return { healthy: true, status: 'Healthy 🟢', latencyMs: Date.now() - start };
    }

    return { healthy: false, status: 'Invalid Response 🔴', latencyMs: Date.now() - start, error: 'Empty output' };
  } catch (err: any) {
    const msg = err?.message || String(err);
    const latency = Date.now() - start;
    if (msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED') || msg.includes('quota')) {
      return { healthy: false, status: 'Quota Exhausted / Rate Limited 🟡', latencyMs: latency, error: msg };
    } else if (msg.includes('401') || msg.includes('403') || msg.includes('API_KEY_INVALID')) {
      return { healthy: false, status: 'Invalid Key 🔴', latencyMs: latency, error: msg };
    }
    return { healthy: false, status: 'Provider Error 🔴', latencyMs: latency, error: msg };
  }
}

/**
 * In-memory key manager helper (for mock testing & fallback)
 */
export function setInMemoryKeys(keys: AiKeyRecord[]) {
  inMemoryKeys = [...keys];
}
