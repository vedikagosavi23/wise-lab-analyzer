// This file is automatically generated. Do not edit it directly.
import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';

const SUPABASE_URL = "https://wewhxpjjrfnbxbkulgwi.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Indld2h4cGpqcmZuYnhia3VsZ3dpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDk4ODI4MDEsImV4cCI6MjA2NTQ1ODgwMX0.DjWgahAH3oYYAEQomzksbFiCEx1MFTTKe3XWnEn6pPs";

// Import the supabase client like this:
// import { supabase } from "@/integrations/supabase/client";

export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);