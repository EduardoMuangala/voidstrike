import { createClient } from '@supabase/supabase-js';

// The anon key is safe to ship client-side: it only grants what Row Level
// Security policies in the project allow.
const URL = 'https://ohrzahtzcjpezmmchwwo.supabase.co';
const ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9ocnphaHR6Y2pwZXptbWNod3dvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ2NzIyMjMsImV4cCI6MjExMDI0ODIyM30.eby9mzM1kRDuZ2_vyS1i-1UBZ_xxmwBbIBM7gMipAio';

export const supabase = createClient(URL, ANON_KEY);
