import type { VercelRequest, VercelResponse } from '@vercel/node';
import crypto from 'crypto';
import { supabase } from './_supabaseClient.js';
import { createSupabaseAuthSession } from './_authHelper.js';

function verifyTelegramInitData(initData: string, botToken: string): { isValid: boolean; user?: any } {
  if (!botToken || !initData) {
    return { isValid: false };
  }
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get("hash");
    if (!hash) return { isValid: false };

    params.delete("hash");

    const keys = Array.from(params.keys()).sort();
    const dataCheckString = keys
      .map((key) => `${key}=${params.get(key)}`)
      .join("\n");

    const secretKey = crypto
      .createHmac("sha256", "WebAppData")
      .update(botToken)
      .digest();

    const computedHash = crypto
      .createHmac("sha256", secretKey)
      .update(dataCheckString)
      .digest("hex");

    const isValid = computedHash === hash;
    let user = null;
    if (isValid) {
      const userJson = params.get("user");
      if (userJson) {
        user = JSON.parse(userJson);
      }
    }
    return { isValid, user };
  } catch (e) {
    console.error("Error verifying Telegram initData:", e);
    return { isValid: false };
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') return res.status(200).end();

  // Extract action from query (via vercel rewrite ?action=...) or URL path
  let action = (req.query.action as string) || '';
  if (!action && req.url) {
    const cleanUrl = req.url.split('?')[0];
    action = cleanUrl.replace(/^\/api\/auth\/?/, '').trim();
  }

  const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8955141731:AAGILXzT69Vity8ZFi-H8XeZc_H6_BFaS8Y';

  // 1. /api/auth/telegram
  if (action === 'telegram') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

    try {
      const { initData } = req.body || {};
      let tgUser: any = null;

      if (initData && BOT_TOKEN) {
        const verification = verifyTelegramInitData(initData, BOT_TOKEN);
        if (verification.isValid && verification.user) {
          tgUser = verification.user;
        }
      }

      if (!tgUser || !tgUser.id) {
        return res.status(401).json({ error: "Invalid or unverified Telegram authentication data" });
      }

      const tgId = String(tgUser.id);
      const userId = `moliya_user_tg_${tgId}`;

      // 1. Identity Block Guard: Check if Telegram identity is blocked by Admin
      const { data: blockedDoc } = await supabase
        .from('users')
        .select('id, onboarding, device_info')
        .eq('id', `restricted_tg_${tgId}`)
        .maybeSingle();

      if (blockedDoc && blockedDoc.onboarding?.is_blocked !== false) {
        return res.status(403).json({
          error: 'ACCOUNT_RESTRICTED',
          message: "Hisobingiz ma'muriyat tomonidan bloklangan."
        });
      }

      // 2. Canonical User Check & Auto-Creation
      let { data: userDoc } = await supabase
        .from('users')
        .select('*')
        .eq('id', userId)
        .maybeSingle();

      if (userDoc) {
        const isUserBlocked = Boolean(
          userDoc.onboarding?.is_blocked ||
          userDoc.device_info?.is_blocked ||
          userDoc.onboarding?.is_restricted ||
          userDoc.device_info?.restricted
        );

        if (isUserBlocked) {
          return res.status(403).json({
            error: 'ACCOUNT_RESTRICTED',
            message: "Hisobingiz ma'muriyat tomonidan bloklangan."
          });
        }
      } else {
        // Auto-create user record for first-time Telegram Mini App entry
        const nowStr = new Date().toISOString();
        const trialEnd = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
        const tgName = [tgUser.first_name, tgUser.last_name].filter(Boolean).join(' ') || 'Telegram Foydalanuvchi';
        const tgUsername = tgUser.username ? '@' + tgUser.username : '@moliya_user';

        const newOnboarding = {
          completed: false,
          tour_completed: false,
          language: tgUser.language_code || 'uz',
          name: tgName,
          telegram: tgUsername,
          telegramId: tgId,
          trial_started_at: nowStr,
          trial_ends_at: trialEnd,
          registration_status: 'completed'
        };

        const newRecord = {
          id: userId,
          name: tgName,
          telegram: tgUsername,
          telegram_id: tgId,
          phone: null,
          language: tgUser.language_code || 'uz',
          is_premium: true,
          premium_expires_at: trialEnd,
          ai_limit: null,
          ai_query_count: 0,
          platform: 'telegram',
          cards: [],
          transactions: [],
          onboarding: newOnboarding,
          registration_status: 'completed',
          created_at: nowStr,
          updated_at: nowStr
        };

        const { data: createdUser } = await supabase.from('users').upsert(newRecord, {
          onConflict: 'id',
          ignoreDuplicates: true  // SAFETY: Never overwrite existing user data in race conditions
        }).select().single();
        // If insert was ignored (user appeared between check and insert), re-fetch
        if (!createdUser) {
          const { data: refetched } = await supabase.from('users').select('*').eq('id', userId).maybeSingle();
          userDoc = refetched || newRecord;
        } else {
          userDoc = createdUser;
        }
      }
      // ── Effective Access Calculation (replaces destructive trial reset) ──
      // Import effectiveAccess inline to avoid circular deps at module level
      const { effectiveAccess } = await import('./_accessHelper.js');
      const access = effectiveAccess(userDoc);

      // Only grant a new 1-day trial if ALL of these are true:
      //   1. User has no premium_expires_at AND no trial_ends_at
      //   2. User is NOT already VIP or Unlimited (admin-granted)
      //   3. User was JUST created (within the last 60 seconds) OR has never had any access set
      const hasAnyExpiry = userDoc?.premium_expires_at || userDoc?.trial_ends_at || userDoc?.onboarding?.trial_ends_at;
      const isAdminGranted = Boolean(userDoc?.unlimited_ai) || (userDoc?.is_premium && !hasAnyExpiry);
      const isNewlyCreated = userDoc?.created_at && (Date.now() - new Date(userDoc.created_at).getTime()) < 60000;

      let isPremium = access.isPremium;

      if (!hasAnyExpiry && !isAdminGranted && isNewlyCreated) {
        // Genuinely new user — grant 1-day trial
        const trialEnd = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
        isPremium = true;
        await supabase.from('users').update({
          is_premium: true,
          premium_expires_at: trialEnd,
          ai_limit: null,
          updated_at: new Date().toISOString()
        }).eq('id', userId);
      }
      // IMPORTANT: We do NOT auto-downgrade here anymore.
      // The effectiveAccess() function handles expiration logic.
      // This prevents destroying admin-granted VIP/Unlimited status.

      const now = new Date();
      const expiresAt = new Date(now.getTime() + 60 * 24 * 3600 * 1000).toISOString();
      const randomHex = Array.from({ length: 32 }, () => Math.floor(Math.random() * 256).toString(16).padStart(2, '0')).join('');
      const sessionToken = 'sess_' + randomHex;

      const tgName = [tgUser.first_name, tgUser.last_name].filter(Boolean).join(' ') || 'Telegram Foydalanuvchi';
      const tgUsername = tgUser.username ? '@' + tgUser.username : '@moliya_user';

      const updatedOnboarding = {
        ...(userDoc?.onboarding || {}),
        completed: userDoc?.onboarding?.completed === true,
        tour_completed: userDoc?.onboarding?.tour_completed === true,
        language: userDoc?.language || tgUser.language_code || 'uz',
        name: tgName,
        phone: userDoc?.phone || '',
        telegram: tgUsername,
        telegramId: tgId,
        session_token: sessionToken,
        session_expires_at: expiresAt,
        registration_status: 'completed'
      };

      await supabase.from('users').update({
        onboarding: updatedOnboarding,
        updated_at: now.toISOString()
      }).eq('id', userId);

      const authSession = await createSupabaseAuthSession(tgId, { name: tgName, telegram: tgUsername });

      if (authSession?.auth_user_id) {
        await supabase.from('users').update({
          auth_user_id: authSession.auth_user_id
        }).eq('id', userId);
      }

      return res.status(200).json({
        userId,
        sessionToken,
        access_token: authSession?.access_token || null,
        refresh_token: authSession?.refresh_token || null,
        onboarding: updatedOnboarding,
        cards: userDoc?.cards || [],
        transactions: userDoc?.transactions || [],
        isPremium: access.isPremium,
        accessLevel: access.level,
        accessLabel: access.label,
        canUseAi: access.canUseAi,
        trialEndsAt: userDoc?.trial_ends_at || userDoc?.premium_expires_at,
        aiLimit: access.aiLimit
      });
    } catch (error: any) {
      console.error('Error in auth telegram:', error);
      return res.status(500).json({ error: error.message });
    }
  }

  // 2. /api/auth/exchange-code
  if (action === 'exchange-code') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

    try {
      const { code } = req.body || {};
      if (!code || typeof code !== 'string' || code.length < 16) {
        return res.status(400).json({ error: 'Missing or invalid code' });
      }

      const codeId = `exchange_${code}`;
      const { data: codeDoc, error: lookupError } = await supabase
        .from('users')
        .select('*')
        .eq('id', codeId)
        .maybeSingle();

      if (lookupError || !codeDoc) {
        return res.status(400).json({ error: 'Invalid or expired code' });
      }

      if (codeDoc.session_expires_at && new Date(codeDoc.session_expires_at).getTime() < Date.now()) {
        await supabase.from('users').delete().eq('id', codeId);
        return res.status(400).json({ error: 'Code expired' });
      }

      if (codeDoc.login_request_status === 'USED') {
        return res.status(400).json({ error: 'Code already used' });
      }

      const tgId = codeDoc.telegram_id;
      if (!tgId) {
        return res.status(400).json({ error: 'Invalid code: no telegram_id' });
      }

      await supabase.from('users').update({
        login_request_status: 'USED',
        updated_at: new Date().toISOString()
      }).eq('id', codeId);

      const userId = `moliya_user_tg_${tgId}`;
      const { data: userDoc } = await supabase
        .from('users')
        .select('*')
        .eq('id', userId)
        .maybeSingle();

      let authSession: any = null;
      try {
        authSession = await createSupabaseAuthSession(
          String(tgId),
          { name: userDoc?.name || '', telegram: userDoc?.telegram || '' }
        );
      } catch (authErr) {
        console.warn('[EXCHANGE-CODE] Warning creating auth session:', authErr);
      }

      return res.status(200).json({
        access_token: authSession?.access_token || null,
        refresh_token: authSession?.refresh_token || null,
        userId,
        sessionToken: userDoc?.session_token || codeDoc.session_token || null,
        onboarding: userDoc?.onboarding || null,
        cards: userDoc?.cards || [],
        transactions: userDoc?.transactions || [],
        isPremium: userDoc?.is_premium || false
      });
    } catch (error: any) {
      console.error('[EXCHANGE-CODE] Error:', error);
      return res.status(500).json({ error: error.message });
    }
  }

  // 3. /api/auth/check-login-request
  if (action === 'check-login-request') {
    const requestId = (req.query.requestId as string) || (req.body && req.body.requestId);
    if (!requestId || typeof requestId !== 'string') {
      return res.status(400).json({ error: 'Missing requestId parameter' });
    }

    const cleanId = requestId.replace(/^req_/, '').trim();

    try {
      const { data: reqDoc, error } = await supabase
        .from('users')
        .select('*')
        .eq('id', `req_${cleanId}`)
        .maybeSingle();

      if (!error && reqDoc) {
        if (reqDoc.login_request_status === 'VERIFIED' && reqDoc.telegram_id && reqDoc.session_token) {
          const userId = `moliya_user_tg_${reqDoc.telegram_id}`;
          const { data: userDoc } = await supabase.from('users').select('*').eq('id', userId).maybeSingle();

          let authSession: any = null;
          try {
            authSession = await createSupabaseAuthSession(
              reqDoc.telegram_id,
              { name: userDoc?.name || '', telegram: userDoc?.telegram || '' }
            );
          } catch (e) {
            console.warn('[CHECK-LOGIN] Warning creating auth session:', e);
          }

          // Mark request as consumed
          await supabase.from('users').update({ login_request_status: 'CONSUMED' }).eq('id', `req_${cleanId}`);

          return res.status(200).json({
            status: 'VERIFIED',
            userId,
            sessionToken: reqDoc.session_token,
            access_token: authSession?.access_token || null,
            refresh_token: authSession?.refresh_token || null,
            onboarding: userDoc?.onboarding || null,
            phone: userDoc?.phone || '',
            cards: userDoc?.cards || [],
            transactions: userDoc?.transactions || []
          });
        }
        return res.status(200).json({ status: reqDoc.login_request_status || 'PENDING' });
      }

      return res.status(200).json({ status: 'PENDING' });
    } catch (error: any) {
      console.error('Error checking login request in Supabase:', error);
      return res.status(200).json({ status: 'PENDING' });
    }
  }

  // 4. /api/auth/create-login-request
  if (action === 'create-login-request') {
    try {
      const { requestId } = req.body || {};
      if (!requestId || typeof requestId !== 'string' || requestId.length < 8) {
        return res.status(400).json({ error: 'Invalid or missing requestId' });
      }

      const cleanId = requestId.replace(/^req_/, '').trim();
      const nowIso = new Date().toISOString();

      await supabase.from('users').upsert({
        id: `req_${cleanId}`,
        login_request_id: cleanId,
        login_request_status: 'PENDING',
        updated_at: nowIso
      }, { onConflict: 'id' });

      return res.status(200).json({ success: true, requestId });
    } catch (error: any) {
      console.error('Error creating login request in Supabase:', error);
      return res.status(200).json({ success: true, requestId: req.body?.requestId || 'fallback' });
    }
  }

  // 5. /api/auth/validate-session
  if (action === 'validate-session') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

    try {
      const { sessionToken } = req.body || {};
      if (!sessionToken || typeof sessionToken !== 'string') {
        return res.status(200).json({ valid: false, reason: 'Missing sessionToken' });
      }

      const { data: userDoc, error } = await supabase
        .from('users')
        .select('*')
        .eq('session_token', sessionToken)
        .maybeSingle();

      if (!error && userDoc) {
        // Restriction & Block check
        const isBlocked = Boolean(
          userDoc.is_blocked ||
          userDoc.is_restricted ||
          userDoc.id?.startsWith('restricted_') ||
          userDoc.device_info?.is_blocked ||
          userDoc.device_info?.restricted ||
          userDoc.onboarding?.is_blocked ||
          userDoc.onboarding?.is_restricted
        );

        if (isBlocked) {
          return res.status(200).json({ valid: false, reason: 'ACCOUNT_RESTRICTED', message: "Hisobingiz cheklangan" });
        }

        if (userDoc.session_expires_at && new Date(userDoc.session_expires_at).getTime() < Date.now()) {
          return res.status(200).json({ valid: false, reason: 'Session expired' });
        }

        const tgId = userDoc.telegram_id || userDoc.onboarding?.telegramId;
        let authSession = null;
        if (tgId) {
          authSession = await createSupabaseAuthSession(
            String(tgId),
            { name: userDoc.name || '', telegram: userDoc.telegram || '' }
          );
        }

        return res.status(200).json({
          valid: true,
          userId: userDoc.id,
          access_token: authSession?.access_token || null,
          refresh_token: authSession?.refresh_token || null,
          onboarding: userDoc.onboarding || null,
          cards: userDoc.cards || [],
          transactions: userDoc.transactions || [],
          isPremium: userDoc.is_premium || false
        });
      }

      return res.status(200).json({ valid: false, reason: 'Session not found' });
    } catch (error: any) {
      console.error('Error validating session in Supabase:', error);
      return res.status(200).json({ valid: false, error: error.message });
    }
  }

  // 6. /api/auth/delete-account
  if (action === 'delete-account') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

    try {
      const { userId, telegramId, initData } = req.body || {};
      if (!userId && !telegramId) {
        return res.status(400).json({ error: 'Missing userId or telegramId' });
      }

      // Security verification via initData if present
      let verifiedTgUser: any = null;
      if (initData && BOT_TOKEN) {
        const verification = verifyTelegramInitData(initData, BOT_TOKEN);
        if (verification.isValid && verification.user) {
          verifiedTgUser = verification.user;
        }
      }

      // Resolve target user record from Supabase
      const uidStr = userId ? String(userId).trim() : '';
      const tgIdStr = telegramId ? String(telegramId).trim() : (verifiedTgUser?.id ? String(verifiedTgUser.id) : null);

      let userDoc: any = null;
      if (uidStr) {
        const { data: byId } = await supabase.from('users').select('*').eq('id', uidStr).maybeSingle();
        userDoc = byId;
      }

      if (!userDoc && tgIdStr) {
        const { data: byTg } = await supabase.from('users').select('*').eq('telegram_id', tgIdStr).maybeSingle();
        userDoc = byTg;
        if (!userDoc) {
          const { data: byTgId } = await supabase.from('users').select('*').eq('id', `moliya_user_tg_${tgIdStr}`).maybeSingle();
          userDoc = byTgId;
        }
      }

      const canonicalUserId = userDoc?.id || uidStr || (tgIdStr ? `moliya_user_tg_${tgIdStr}` : null);
      const targetTgId = tgIdStr || userDoc?.telegram_id || userDoc?.onboarding?.telegramId || (canonicalUserId?.startsWith('moliya_user_tg_') ? canonicalUserId.replace('moliya_user_tg_', '') : null);

      // Collect any message IDs stored in onboarding.bot_messages
      const botMessages: any[] = Array.isArray(userDoc?.onboarding?.bot_messages) ? userDoc.onboarding.bot_messages : [];
      const storedIds: number[] = [];
      for (const m of botMessages) {
        const numId = Number(m.message_id || m.messageId);
        if (Number.isInteger(numId) && numId > 0 && !storedIds.includes(numId)) {
          storedIds.push(numId);
        }
      }

      const lastMsgId = Number(userDoc?.onboarding?.last_message_id) || 0;

      // 1. Purge Telegram Bot Chat History if targetTgId and BOT_TOKEN exist
      let chatPurged = false;
      const tgDetails = { attempted: 0, deleted: 0, alreadyAbsent: 0, notDeletable: 0, failed: 0 };

      if (targetTgId && targetTgId !== '—' && BOT_TOKEN) {
        try {
          const idsToDelete = new Set<number>();
          storedIds.forEach(id => idsToDelete.add(id));

          // Probe to discover active topMsgId
          let topMsgId = lastMsgId && lastMsgId > 0 ? lastMsgId : null;
          try {
            const probeRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chat_id: String(targetTgId),
                text: '·',
                disable_notification: true
              })
            });
            const probeData = await probeRes.json();
            if (probeData.ok && probeData.result?.message_id) {
              const probeId = probeData.result.message_id;
              topMsgId = Math.max(topMsgId || 0, probeId);
              idsToDelete.add(probeId);
            }
          } catch (probeErr) {
            console.warn('[DELETE_ACCOUNT] Probe error:', probeErr);
          }

          // Sweep backwards up to 150 messages from topMsgId
          if (topMsgId && topMsgId > 0) {
            const minId = Math.max(1, topMsgId - 150);
            for (let m = topMsgId; m >= minId; m--) {
              idsToDelete.add(m);
            }
          }

          const idList = Array.from(idsToDelete).sort((a, b) => b - a);
          tgDetails.attempted = idList.length;

          // Process in batches of up to 100 via deleteMessages + individual fallback
          for (let i = 0; i < idList.length; i += 100) {
            const chunk = idList.slice(i, i + 100);
            try {
              const batchRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/deleteMessages`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chat_id: String(targetTgId), message_ids: chunk })
              });
              const batchData = await batchRes.json();
              if (batchData.ok) {
                tgDetails.deleted += chunk.length;
              } else {
                // Fallback to individual deleteMessage
                const indResults = await Promise.allSettled(
                  chunk.map(async (msgId) => {
                    const sRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/deleteMessage`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ chat_id: String(targetTgId), message_id: msgId })
                    });
                    return await sRes.json();
                  })
                );

                indResults.forEach((r) => {
                  if (r.status === 'fulfilled') {
                    const d = r.value;
                    if (d?.ok) {
                      tgDetails.deleted++;
                    } else {
                      const desc = (d?.description || '').toLowerCase();
                      if (desc.includes('not found')) {
                        tgDetails.alreadyAbsent++;
                      } else if (desc.includes("can't be deleted") || desc.includes('cant be deleted')) {
                        tgDetails.notDeletable++;
                      } else {
                        tgDetails.failed++;
                      }
                    }
                  } else {
                    tgDetails.failed++;
                  }
                });
              }
            } catch {
              tgDetails.failed += chunk.length;
            }

            if (i + 100 < idList.length) {
              await new Promise(r => setTimeout(r, 40));
            }
          }

          // Permanently wipe client keyboard state
          try {
            const kbRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chat_id: String(targetTgId),
                text: '🗑️',
                disable_notification: true,
                reply_markup: { remove_keyboard: true }
              })
            });
            const kbData = await kbRes.json();
            if (kbData.ok && kbData.result?.message_id) {
              await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/deleteMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chat_id: String(targetTgId), message_id: kbData.result.message_id })
              }).catch(() => {});
            }
          } catch {}

          chatPurged = true;
        } catch (tgErr) {
          console.warn('[DELETE_ACCOUNT] Telegram purge error:', tgErr);
        }
      }

      // 2. Delete user row from Supabase
      if (canonicalUserId) {
        await supabase.from('users').delete().eq('id', canonicalUserId);
      }
      if (targetTgId) {
        // Also clean up any associated temporary auth docs
        await supabase.from('users').delete().or(`id.eq.moliya_user_tg_${targetTgId},id.eq.req_${targetTgId},id.eq.exchange_${targetTgId}`);
      }

      return res.status(200).json({
        success: true,
        userDeleted: true,
        chatPurged,
        userId: canonicalUserId,
        telegramId: targetTgId,
        details: tgDetails
      });
    } catch (error: any) {
      console.error('[DELETE_ACCOUNT] Error:', error);
      return res.status(500).json({ error: error.message });
    }
  }

  return res.status(404).json({ error: 'Auth route not found', action });
}
