import { createClient } from '@supabase/supabase-js';

export const SUPABASE_URL = 'https://qjumnjzbgjldbwwluggr.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFqdW1uanpiZ2psZGJ3d2x1Z2dyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY5Nzc0ODIsImV4cCI6MjEwMjU1MzQ4Mn0.zHMIbL50xmrlhtpkpGdewvcWvsBJUAHyo5lS1hdU910';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
