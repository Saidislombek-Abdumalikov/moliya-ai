import { wipeFinancialData } from './_financialDataService.js';
import { deleteUserAccount, blockUser, unblockUser } from './_userAccountService.js';
import { grantFullPremium } from './_premiumService.js';
import { resetDailyQueries } from './_queryUsageService.js';
import { logAdminAudit } from './_auditLogService.js';

/**
 * ADMIN ORCHESTRATION LAYER.
 * 
 * Each function orchestrates an admin action by calling exactly one domain service
 * and recording an auditable log entry.
 * 
 * Strictly adheres to:
 * - No "magic deletes"
 * - Multi-user safety (strictly scoped by targetUserId)
 * - Explicit scope separation
 */

/**
 * Admin Action 1: Wipe Data / Delete Account.
 * Explicitly separated:
 * - scope 'financial': wipes ONLY financial records (transactions & cards). Preserves user account and identity.
 * - scope 'account': deactivates / deletes user account.
 */
export async function adminWipeUserData(
  targetUserId: string,
  scope: 'financial' | 'account' = 'financial',
  adminId: string = 'admin',
  targetUserName?: string
) {
  if (!targetUserId) throw new Error('targetUserId is required');

  if (scope === 'financial') {
    const result = await wipeFinancialData(targetUserId);
    await logAdminAudit({
      action: 'USER_DATA_WIPED',
      target_user_id: targetUserId,
      target_user_name: targetUserName,
      admin_id: adminId,
      details: { scope: 'financial_records_only', timestamp: result.wipedAt }
    });
    return { success: true, action: 'USER_DATA_WIPED', scope: 'financial', targetUserId };
  } else {
    const result = await deleteUserAccount(targetUserId, { hardDelete: true, wipeTelegramChat: true });
    await logAdminAudit({
      action: 'ACCOUNT_DELETED',
      target_user_id: targetUserId,
      target_user_name: targetUserName,
      admin_id: adminId,
      details: { mode: result.mode, chatPurged: result.chatPurged }
    });
    return { success: true, action: 'ACCOUNT_DELETED', scope: 'account', targetUserId, chatPurged: result.chatPurged };
  }
}

/**
 * Admin Action 2: Block / Unblock User.
 */
export async function adminToggleUserBlock(
  targetUserId: string,
  shouldBlock: boolean,
  adminId: string = 'admin',
  targetUserName?: string,
  reason?: string
) {
  if (!targetUserId) throw new Error('targetUserId is required');

  if (shouldBlock) {
    const res = await blockUser(targetUserId, reason);
    await logAdminAudit({
      action: 'USER_BLOCKED',
      target_user_id: targetUserId,
      target_user_name: targetUserName,
      admin_id: adminId,
      details: { reason }
    });
    return res;
  } else {
    const res = await unblockUser(targetUserId);
    await logAdminAudit({
      action: 'USER_UNBLOCKED',
      target_user_id: targetUserId,
      target_user_name: targetUserName,
      admin_id: adminId
    });
    return res;
  }
}

/**
 * Admin Action 3: Give Full Premium.
 */
export async function adminGrantFullPremium(
  targetUserId: string,
  expiresAt: string | null = null,
  adminId: string = 'admin',
  targetUserName?: string
) {
  if (!targetUserId) throw new Error('targetUserId is required');

  const res = await grantFullPremium(targetUserId, expiresAt);
  await logAdminAudit({
    action: 'FULL_PREMIUM_GRANTED',
    target_user_id: targetUserId,
    target_user_name: targetUserName,
    admin_id: adminId,
    details: { expiresAt }
  });
  return res;
}

/**
 * Admin Action 4: Reset Daily Queries.
 */
export async function adminResetDailyQueries(
  targetUserId: string,
  adminId: string = 'admin',
  targetUserName?: string
) {
  if (!targetUserId) throw new Error('targetUserId is required');

  const res = await resetDailyQueries(targetUserId);
  await logAdminAudit({
    action: 'DAILY_QUERIES_RESET',
    target_user_id: targetUserId,
    target_user_name: targetUserName,
    admin_id: adminId
  });
  return res;
}
