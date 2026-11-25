import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type EmployeeProfile = {
  id: string;
  full_name: string;
  email: string;
  department: string | null;
};

let cachedClient: SupabaseClient | null = null;

export function getSupabaseServerClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment configuration."
    );
  }

  if (!cachedClient) {
    cachedClient = createClient(url, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return cachedClient;
}

export async function getEmployeeByEmail(
  email: string
): Promise<EmployeeProfile> {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (!normalizedEmail) {
    throw new Error("A registered Archemist employee email is required.");
  }

  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("user_profiles")
    .select("id, full_name, email, department")
    .ilike("email", normalizedEmail)
    .maybeSingle();

  if (error) {
    throw new Error(`Employee lookup failed: ${error.message}`);
  }
  if (!data) {
    throw new Error("Unauthorized: email not found in Archemist staff profiles.");
  }

  return data as EmployeeProfile;
}
