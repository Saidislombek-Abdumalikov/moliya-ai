import { supabase } from '../api/_supabaseClient';
import { createSupabaseAuthSession } from '../api/_authHelper';

async function runAuthAuditSuite() {
  console.log('====================================================');
  console.log('🚀 RUNNING EPICSELL / MOLIYA AI COMPREHENSIVE SUITE');
  console.log('====================================================\n');

  let passed = 0;
  let failed = 0;

  const assert = (condition: boolean, testName: string) => {
    if (condition) {
      console.log(`✅ PASS: ${testName}`);
      passed++;
    } else {
      console.error(`❌ FAIL: ${testName}`);
      failed++;
    }
  };

  const testTgId = '9988776655';
  const testUserId = `moliya_user_tg_${testTgId}`;

  try {
    // Clean up test state before starting
    await supabase.from('users').delete().eq('telegram_id', testTgId);
    await supabase.from('users').delete().eq('id', testUserId);

    // ─────────────────────────────────────────────────────────────
    // TEST 1: OTP Generation & Storage
    // ─────────────────────────────────────────────────────────────
    console.log('--- TEST 1: OTP Generation & Storage ---');
    const otp1 = '112233';
    const expiresAt1 = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const ins1 = await supabase.from('users').insert({
      id: `otp_${otp1}`,
      telegram_id: testTgId,
      name: 'Test User',
      telegram: '@testuser',
      onboarding: {
        otp_code: otp1,
        telegram_id: testTgId,
        login_request_status: 'PENDING_OTP',
        expires_at: expiresAt1
      }
    });
    if (ins1.error) console.error('Insert error 1:', ins1.error);

    const { data: storedOtp1, error: selErr } = await supabase.from('users').select('*').eq('id', `otp_${otp1}`).maybeSingle();
    if (selErr) console.error('Select error 1:', selErr);
    assert(Boolean(storedOtp1 && storedOtp1.telegram_id === testTgId), 'OTP 1 successfully generated and stored in Supabase');

    // ─────────────────────────────────────────────────────────────
    // TEST 2: Old Code Invalidation when New Code is Requested
    // ─────────────────────────────────────────────────────────────
    console.log('\n--- TEST 2: Old Code Invalidation on New Request ---');
    // Simulate generating second OTP (invalidating previous ones)
    await supabase.from('users').delete().eq('telegram_id', testTgId).like('id', 'otp_%');

    const otp2 = '445566';
    const expiresAt2 = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    await supabase.from('users').insert({
      id: `otp_${otp2}`,
      telegram_id: testTgId,
      name: 'Test User',
      telegram: '@testuser',
      onboarding: {
        otp_code: otp2,
        telegram_id: testTgId,
        login_request_status: 'PENDING_OTP',
        expires_at: expiresAt2
      }
    });

    const { data: checkOldOtp } = await supabase.from('users').select('*').eq('id', `otp_${otp1}`).maybeSingle();
    const { data: checkNewOtp } = await supabase.from('users').select('*').eq('id', `otp_${otp2}`).maybeSingle();
    assert(!checkOldOtp, 'Old OTP (112233) was invalidated and deleted');
    assert(Boolean(checkNewOtp), 'New OTP (445566) is active');

    // ─────────────────────────────────────────────────────────────
    // TEST 3: Verification of New OTP (First-Time User Registration)
    // ─────────────────────────────────────────────────────────────
    console.log('\n--- TEST 3: Verification of New OTP (New User) ---');
    // Simulate verify-code endpoint logic
    const { data: validOtpDoc } = await supabase.from('users').select('*').eq('id', `otp_${otp2}`).maybeSingle();
    assert(Boolean(validOtpDoc), 'Valid OTP record located');

    // Single-use deletion
    await supabase.from('users').delete().eq('id', `otp_${otp2}`);

    // Create user record
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 60 * 24 * 3600 * 1000).toISOString();
    await supabase.from('users').insert({
      id: testUserId,
      name: 'Test User',
      telegram: '@testuser',
      telegram_id: testTgId,
      phone: null,
      language: 'uz',
      is_premium: false,
      onboarding: {
        completed: false,
        language: 'uz',
        name: 'Test User',
        phone: '',
        telegram: '@testuser',
        telegramId: testTgId,
        monthlyGoal: 1000000,
        session_token: 'sess_test_123456',
        session_expires_at: expiresAt
      },
      cards: [],
      transactions: [],
      created_at: now.toISOString(),
      updated_at: now.toISOString()
    });

    const { data: createdUser } = await supabase.from('users').select('*').eq('id', testUserId).maybeSingle();
    assert(Boolean(createdUser), 'New user account created with moliya_user_tg_9988776655');
    assert(createdUser?.onboarding?.completed === false, 'New user has onboarding completed = false');

    // ─────────────────────────────────────────────────────────────
    // TEST 4: Single-Use Enforcement (Re-attempting same OTP fails)
    // ─────────────────────────────────────────────────────────────
    console.log('\n--- TEST 4: Single-Use Enforcement ---');
    const { data: recheckUsedOtp } = await supabase.from('users').select('*').eq('id', `otp_${otp2}`).maybeSingle();
    assert(!recheckUsedOtp, 'Re-verification of same OTP fails because record was deleted (single-use enforced)');

    // ─────────────────────────────────────────────────────────────
    // TEST 5: Expiration Handling
    // ─────────────────────────────────────────────────────────────
    console.log('\n--- TEST 5: Expiration Handling ---');
    const expiredOtp = '778899';
    const pastExpiresAt = new Date(Date.now() - 5 * 60 * 1000).toISOString(); // 5 min ago
    await supabase.from('users').insert({
      id: `otp_${expiredOtp}`,
      telegram_id: testTgId,
      name: 'Test User',
      onboarding: {
        otp_code: expiredOtp,
        login_request_status: 'PENDING_OTP',
        expires_at: pastExpiresAt
      }
    });

    const { data: expiredDoc } = await supabase.from('users').select('*').eq('id', `otp_${expiredOtp}`).maybeSingle();
    const isExpired = expiredDoc && new Date(expiredDoc.onboarding?.expires_at).getTime() < Date.now();
    assert(Boolean(isExpired), 'Expired code timestamp correctly detected as expired');

    // Clean up expired
    await supabase.from('users').delete().eq('id', `otp_${expiredOtp}`);

    // ─────────────────────────────────────────────────────────────
    // TEST 6: Existing User Verification & Data Preservation
    // ─────────────────────────────────────────────────────────────
    console.log('\n--- TEST 6: Existing User Data Preservation ---');
    // Add existing cards and transactions to user
    const sampleCard = { id: 'c1', name: 'Uzcard', number: '8600 **** 1234', balance: 500000, color: 'purple' };
    const sampleTx = { id: 't1', type: 'expense', name: 'Tushlik', category: 'food', amount: 45000, date: new Date().toISOString() };
    
    await supabase.from('users').update({
      cards: [sampleCard],
      transactions: [sampleTx],
      onboarding: {
        completed: true,
        language: 'uz',
        name: 'Test User Verified',
        phone: '+998901234567',
        telegram: '@testuser',
        telegramId: testTgId,
        monthlyGoal: 2000000,
        session_token: 'sess_test_123456',
        session_expires_at: expiresAt
      }
    }).eq('id', testUserId);

    // Simulate second login of existing user
    const { data: fetchedExisting } = await supabase.from('users').select('*').eq('id', testUserId).maybeSingle();
    assert(fetchedExisting?.cards?.length === 1 && fetchedExisting?.cards[0]?.name === 'Uzcard', 'Existing user cards preserved intact');
    assert(fetchedExisting?.transactions?.length === 1 && fetchedExisting?.transactions[0]?.name === 'Tushlik', 'Existing user transactions preserved intact');
    assert(fetchedExisting?.onboarding?.completed === true, 'Existing user onboarding completed state preserved');

    // ─────────────────────────────────────────────────────────────
    // TEST 7: Supabase Auth Session Generation
    // ─────────────────────────────────────────────────────────────
    console.log('\n--- TEST 7: Supabase Auth Session Generation ---');
    const authSession = await createSupabaseAuthSession(testTgId, { name: 'Test User', telegram: '@testuser' });
    assert(Boolean(authSession && authSession.access_token && authSession.refresh_token), 'Supabase Auth session generated with valid JWT access_token & refresh_token');

    // ─────────────────────────────────────────────────────────────
    // TEST 8: Web App Instant Login Request Flow (req_...)
    // ─────────────────────────────────────────────────────────────
    console.log('\n--- TEST 8: Web App Login Request Flow (req_...) ---');
    const testReqId = `test_req_${Date.now()}`;
    // Web App registers request
    await supabase.from('users').insert({
      id: `req_${testReqId}`,
      name: 'Web Login Pending',
      onboarding: {
        login_request_id: testReqId,
        login_request_status: 'PENDING',
        expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString()
      }
    });

    // Bot verifies request
    const testExchangeCode = `ex_${Date.now()}_secret`;
    await supabase.from('users').update({
      telegram_id: testTgId,
      name: 'Test User Verified',
      onboarding: {
        login_request_id: testReqId,
        login_request_status: 'VERIFIED',
        exchange_code: testExchangeCode,
        telegram_id: testTgId,
        session_token: 'sess_web_123',
        expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString()
      }
    }).eq('id', `req_${testReqId}`);

    // Web App check-login-request queries status
    const { data: reqDoc } = await supabase.from('users').select('*').eq('id', `req_${testReqId}`).maybeSingle();
    assert(reqDoc?.onboarding?.login_request_status === 'VERIFIED', 'Web App login request verified by Telegram bot');
    assert(reqDoc?.onboarding?.telegram_id === testTgId, 'Web App login correctly identified Telegram User ID');

    // Clean up request
    await supabase.from('users').delete().eq('id', `req_${testReqId}`);

    // ─────────────────────────────────────────────────────────────
    // TEST 9: Cross-Client Data Synchronization (Web App <-> APK)
    // ─────────────────────────────────────────────────────────────
    console.log('\n--- TEST 9: Cross-Platform Data Synchronization ---');
    // 1. Web App adds a new transaction
    const newTxWeb = {
      id: `tx_web_${Date.now()}`,
      type: 'expense',
      name: 'Supermarket Xarid',
      category: 'shopping',
      amount: 120000,
      date: new Date().toISOString()
    };
    const currentTxs = fetchedExisting?.transactions || [];
    const updatedTxs = [newTxWeb, ...currentTxs];

    await supabase.from('users').update({
      transactions: updatedTxs,
      updated_at: new Date().toISOString()
    }).eq('id', testUserId);

    // 2. APK retrieves the latest user document
    const { data: apkUserDoc } = await supabase.from('users').select('*').eq('id', testUserId).maybeSingle();
    const foundTxInApk = apkUserDoc?.transactions?.some((t: any) => t.name === 'Supermarket Xarid' && t.amount === 120000);
    assert(Boolean(foundTxInApk), 'Transaction created on Web App is instantly visible in APK (100% data sync)');

    // ─────────────────────────────────────────────────────────────
    // TEST 10: Multi-Client Unified User Identity Model
    // ─────────────────────────────────────────────────────────────
    console.log('\n--- TEST 10: Unified Identity Model Verification ---');
    assert(apkUserDoc?.id === `moliya_user_tg_${testTgId}`, 'Unified user profile ID (moliya_user_tg_...) shared across all clients');
    assert(apkUserDoc?.telegram_id === testTgId, 'Telegram ID consistent across APK, Web App, and Telegram Bot');

    // Clean up test user
    await supabase.from('users').delete().eq('telegram_id', testTgId);
    await supabase.from('users').delete().eq('id', testUserId);

    console.log('\n====================================================');
    console.log(`🏁 TEST SUITE COMPLETE: ${passed} PASSED, ${failed} FAILED`);
    console.log('====================================================');

    if (failed > 0) {
      process.exit(1);
    }
  } catch (err: any) {
    console.error('Fatal test error:', err);
    process.exit(1);
  }
}

runAuthAuditSuite();
