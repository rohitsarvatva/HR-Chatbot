import { NextResponse } from "next/server";
import { getEmployeeByEmail, getSupabaseServerClient } from "@/lib/supabaseServer";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const profile = await getEmployeeByEmail(String(body?.email || ""));
    const supabase = getSupabaseServerClient();
    const now = new Date().toISOString();
    const { data, error } = await supabase
      .from("chatbot_sessions")
      .insert({
        user_id: profile.id,
        title: "New Conversation",
        created_at: now,
        updated_at: now,
      })
      .select("*")
      .single();

    if (error) throw new Error(error.message);
    return NextResponse.json({ session: data, employee: profile });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not create chat.";
    const status = message.toLowerCase().includes("unauthorized") ? 403 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
