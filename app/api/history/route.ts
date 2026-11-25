import { NextResponse } from "next/server";
import { getEmployeeByEmail, getSupabaseServerClient } from "@/lib/supabaseServer";

export async function GET(request: Request) {
  try {
    const email = new URL(request.url).searchParams.get("email");
    const profile = await getEmployeeByEmail(email || "");
    const supabase = getSupabaseServerClient();
    const { data, error } = await supabase
      .from("chatbot_sessions")
      .select("*")
      .eq("user_id", profile.id)
      .order("updated_at", { ascending: false });

    if (error) throw new Error(error.message);
    return NextResponse.json({ sessions: data || [], employee: profile });
  } catch (error) {
    const message = error instanceof Error ? error.message : "History unavailable.";
    const status = message.toLowerCase().includes("unauthorized") ? 403 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
