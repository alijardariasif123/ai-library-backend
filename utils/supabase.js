const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY; // 🔥 service role key

if (!SUPABASE_URL || !SUPABASE_KEY) {
  throw new Error('Supabase env variables missing');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

module.exports = supabase;