import {ThinkingLevel,type GoogleGenAI,type GenerateContentParameters} from '@google/genai';

// Bound and abort the SDK HTTP request instead of abandoning a Promise.race.
// Provider-side processing/billing may still continue after HTTP cancellation.
export async function generateBounded(ai:Pick<GoogleGenAI,'models'>,params:GenerateContentParameters,
  deadline:number,perAttemptMs=10000) {
  const timeout=Math.min(perAttemptMs,deadline-Date.now());
  if(timeout<=0)throw new Error('AI_TIMEOUT');
  const response=await ai.models.generateContent({...params,config:{...params.config,
    ...(!params.config?.thinkingConfig
      ? /^gemini-2\.5-flash(?:-lite)?$/i.test(String(params.model || ''))
        ? {thinkingConfig:{thinkingBudget:0}}
        : /^gemini-3\.(?:5|6)-flash(?:-lite)?$/.test(params.model)
        ? {thinkingConfig:{thinkingLevel:ThinkingLevel.MINIMAL}}
        : {}
      : {}),
    maxOutputTokens:Math.max(params.config?.maxOutputTokens||0,2048),
    abortSignal:AbortSignal.timeout(timeout),
    httpOptions:{...params.config?.httpOptions,timeout}
  }});
  if(response.candidates?.[0]?.finishReason==='MAX_TOKENS')throw new Error('AI_RESPONSE_INCOMPLETE');
  if(!response.text?.trim())throw new Error('AI_EMPTY_RESPONSE');
  return response;
}

// An unavailable model is different from a broken/throttled key. Keep model
// fallback for 400/404, but rotate keys on authentication/quota/network failures.
export function tryNextModel(error:any):boolean {
  const message=String(error?.message||'');
  const status=Number(error?.status || error?.code || message.match(/\b(400|401|403|404|429|500|503)\b/)?.[1]);
  if(/API_KEY_INVALID|API key not valid|permission|unauth|quota|resource_exhausted/i.test(message))return false;
  return status===400 || status===404;
}
