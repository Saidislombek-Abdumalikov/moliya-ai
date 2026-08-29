// ============================================================
// MOLIYA AI — STRICT DATABASE TYPES & CONTRACTS
// ============================================================

export type TransactionType = 'income' | 'expense' | 'debt' | 'lending';
export type CardBrand = 'humo' | 'uzcard' | 'visa' | 'mastercard' | 'other';
export type TransactionSource =
  | 'web'
  | 'telegram_bot'
  | 'telegram_mini_app'
  | 'ai_voice'
  | 'ai_text'
  | 'import'
  | 'system';

export interface UserProfile {
  id: string; // Canonical ID: 'moliya_user_tg_123456789'
  auth_user_id?: string | null;
  telegram_id?: number | null;
  name: string;
  phone?: string | null;
  telegram?: string | null;
  language: 'uz' | 'uz_cyrl' | 'ru' | 'en';
  is_premium: boolean;
  premium_expires_at?: string | null;
  ai_query_count: number;
  ai_limit_mode: 'default' | 'custom' | 'unlimited';
  custom_ai_limit: number;
  is_blocked: boolean;
  session_token?: string | null;
  session_expires_at?: string | null;
  login_request_status?: string | null;
  device_info?: Record<string, any>;
  onboarding?: Record<string, any>;
  created_at: string;
  updated_at: string;
}

export interface CardItem {
  id: string;
  user_id: string;
  name: string;
  bank: string;
  number: string;
  brand: CardBrand;
  initial_balance: number;
  created_at: string;
  updated_at: string;
}

export interface TransactionItem {
  id: string;
  user_id: string;
  card_id: string | null; // null = Cash
  type: TransactionType;
  amount: number;
  category: string;
  title?: string | null;
  note?: string | null;
  debt_who?: string | null;
  date: string; // ISO 8601 string
  source: TransactionSource;
  deleted_at?: string | null; // Tombstone for sync
  created_at: string;
  updated_at: string;
}

export interface AiKeyRecord {
  id: string;
  name: string;
  model: string;
  api_key: string;
  is_active: boolean;
  daily_limit: number;
  used_today: number;
  error_count: number;
  last_error_at?: string | null;
  last_used_at?: string | null;
  created_at: string;
}

export interface AiLogRecord {
  id: string;
  user_id?: string | null;
  query_type: 'text' | 'voice' | 'receipt';
  prompt_summary?: string | null;
  parsed_result?: Record<string, any> | null;
  status: 'success' | 'quota_exceeded' | 'rate_limited' | 'error';
  model_used?: string | null;
  created_at: string;
}

export interface AppNotification {
  id: string;
  title: string;
  message: string;
  target: 'all' | 'web' | string;
  priority: 'normal' | 'high';
  created_at: string;
}
