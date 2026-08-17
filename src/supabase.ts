import { createClient } from '@supabase/supabase-js';

export const SUPABASE_URL = 'https://qjumnjzbgjldbwwluggr.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFqdW1uanpiZ2psZGJ3d2x1Z2dyIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4Njk3NzQ4MiwiZXhwIjoyMTAyNTUzNDgyfQ.o3TVPhK7fLP4yGh26GPne3gdozYJh9fAdfzRPz8IU5Y';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
