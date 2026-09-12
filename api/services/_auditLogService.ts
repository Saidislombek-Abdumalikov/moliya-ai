import { supabase } from '../_supabaseClient.js';

export interface AdminAuditEntry {
  id?: string;
  action: string;
  target_user_id?: string | null;
  target_user_name?: string | null;
  admin_id?: string;
  details?: any;
  created_at?: string;
}

/**
 * Append an entry to the system audit logs stored in the moliya_system_audit_logs record.
 */
async function appendSystemAuditLog(entry: AdminAuditEntry): Promise<void> {
  try {
    const { data: sysRow } = await supabase.from('users').select('onboarding').eq('id', 'moliya_system_audit_logs').maybeSingle();
    const existing = Array.isArray(sysRow?.onboarding?.logs) ? sysRow.onboarding.logs : [];
    const updated = [entry, ...existing].slice(0, 200);
    await supabase.from('users').upsert({
      id: 'moliya_system_audit_logs',
      name: 'System Audit Logs',
      onboarding: { logs: updated },
      updated_at: new Date().toISOString()
    }, { onConflict: 'id' });
  } catch (e) {
    console.warn('[AuditLogService] Fallback logging error:', e);
  }
}

/**
 * LOG ADMIN ACTION.
 * 
 * Records an auditable trail of administrative operations:
 * - USER_DATA_WIPED
 * - ACCOUNT_DELETED
 * - USER_BLOCKED
 * - USER_UNBLOCKED
 * - FULL_PREMIUM_GRANTED
 * - DAILY_QUERIES_RESET
 */
export async function logAdminAudit(entry: AdminAuditEntry): Promise<AdminAuditEntry> {
  const fullEntry: AdminAuditEntry = {
    id: entry.id || `audit_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    action: entry.action,
    target_user_id: entry.target_user_id || null,
    target_user_name: entry.target_user_name || null,
    admin_id: entry.admin_id || 'admin',
    details: entry.details || null,
    created_at: entry.created_at || new Date().toISOString()
  };

  try {
    const { error } = await supabase.from('admin_audit_log').insert([fullEntry]);
    if (error) {
      await appendSystemAuditLog(fullEntry);
    }
  } catch {
    await appendSystemAuditLog(fullEntry);
  }

  return fullEntry;
}

/**
 * Fetch latest admin audit logs.
 */
export async function fetchAdminAuditLogs(limit: number = 100): Promise<AdminAuditEntry[]> {
  try {
    const { data, error } = await supabase
      .from('admin_audit_log')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (!error && Array.isArray(data) && data.length > 0) {
      return data;
    }
  } catch {}

  // Fallback to moliya_system_audit_logs
  try {
    const { data: sysRow } = await supabase
      .from('users')
      .select('onboarding')
      .eq('id', 'moliya_system_audit_logs')
      .maybeSingle();

    if (Array.isArray(sysRow?.onboarding?.logs)) {
      return sysRow.onboarding.logs.slice(0, limit);
    }
  } catch {}

  return [];
}
