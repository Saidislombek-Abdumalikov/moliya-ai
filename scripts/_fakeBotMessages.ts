// In-memory stand-in for public.moliya_bot_messages and moliya_log_bot_message
// (migration 25). Wraps supabase.from/rpc so a test can keep assigning its own
// mocks for every other table: only the message table and its RPC are faked.
export type FakeBotMessages = {
  rows: Map<string, any[]>;            // user_id -> entries, oldest first
  of(userId: string): any[];
  set(userId: string, entries: any[]): void;
  fail: boolean;                       // simulate a store outage
};

const TABLE = 'moliya_bot_messages';

export function installFakeBotMessages(supabase: any): FakeBotMessages {
  const fake: FakeBotMessages = {
    rows: new Map(), fail: false,
    of(userId) { return fake.rows.get(userId) || []; },
    set(userId, entries) { fake.rows.set(userId, entries.map(e => structuredClone(e))); },
  };
  const outage = { data: null, error: { message: 'offline', code: 'TEST' } };

  const builder = () => {
    const filters: [string, any][] = []; let op = 'select'; let payload: any = null; let limit = Infinity; let single = false;
    const run = () => {
      if (fake.fail) return outage;
      const userId = filters.find(([k]) => k === 'user_id')?.[1];
      const match = (e: any) => filters.every(([k, v]) => k === 'user_id' || (k === 'id' ? String(e.id) === String(v) :
        k === 'message_id' ? Number(e.message_id ?? e.messageId) === Number(v) : true));
      if (op === 'upsert') {
        const list = fake.of(payload.user_id).filter(e => String(e.id) !== String(payload.id));
        fake.rows.set(payload.user_id, [...list, structuredClone(payload.entry)]);
        return { data: null, error: null };
      }
      if (op === 'delete') {
        fake.rows.set(userId, fake.of(userId).filter(e => !(filters.length > 1 ? match(e) : true)));
        return { data: null, error: null };
      }
      const pairs = userId == null
        ? [...fake.rows].flatMap(([u, list]) => list.map(entry => ({ user_id: u, entry })))
        : fake.of(userId).filter(match).map(entry => ({ user_id: userId, entry }));
      const newest = pairs.reverse().slice(0, limit).map(p => structuredClone(p));
      return single ? { data: newest[0] ?? null, error: null } : { data: newest, error: null };
    };
    const q: any = {
      select() { return q; }, order() { return q; },
      eq(k: string, v: any) { filters.push([k, v]); return q; },
      limit(n: number) { limit = n; return q; },
      upsert(row: any) { op = 'upsert'; payload = row; return q; },
      delete() { op = 'delete'; return q; },
      async maybeSingle() { single = true; return run(); },
      then(resolve: any, reject: any) { return Promise.resolve(run()).then(resolve, reject); },
    };
    return q;
  };

  // Same merge rules as the SQL function in migration 25.
  const logMessage = (userId: string, entry: any) => {
    if (fake.fail) return outage;
    const list = fake.of(userId);
    const i = list.findIndex(m => (entry.update_id && m.update_id === entry.update_id) ||
      (Number(m.message_id) === Number(entry.message_id) && m.direction === entry.direction && String(m.chat_id) === String(entry.chat_id)) ||
      String(m.id) === String(entry.id));
    if (i >= 0) {
      const old = list[i];
      list[i] = { ...old, ...entry, text: entry.text || old.text, caption: entry.caption || old.caption,
        type: entry.type || old.type, metadata: { ...(old.metadata || {}), ...(entry.metadata || {}) } };
      fake.rows.set(userId, list);
    } else fake.rows.set(userId, [...list, structuredClone(entry)].slice(-500));
    return { data: null, error: null };
  };

  let innerFrom = supabase.from?.bind(supabase);
  let innerRpc = supabase.rpc?.bind(supabase);
  Object.defineProperty(supabase, 'from', { configurable: true,
    get: () => (table: string) => table === TABLE ? builder() : innerFrom(table),
    set: (fn: any) => { innerFrom = fn; } });
  Object.defineProperty(supabase, 'rpc', { configurable: true,
    get: () => (name: string, args: any) => name === 'moliya_log_bot_message'
      ? Promise.resolve(logMessage(args.p_user_id, args.p_entry)) : innerRpc(name, args),
    set: (fn: any) => { innerRpc = fn; } });
  return fake;
}
