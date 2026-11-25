import { NextResponse } from "next/server";
import { getEmployeeByEmail, getSupabaseServerClient } from "@/lib/supabaseServer";
import { loadVectorStore } from "@/lib/rag-engine";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const email = new URL(request.url).searchParams.get("email");
    const profile = await getEmployeeByEmail(email || "");
    const supabase = getSupabaseServerClient();
    const { data: session, error: sessionError } = await supabase
      .from("chatbot_sessions")
      .select("*")
      .eq("id", id)
      .eq("user_id", profile.id)
      .maybeSingle();

    if (sessionError) throw new Error(sessionError.message);
    if (!session) throw new Error("Unauthorized: chat session not found.");

    const { data: messages, error: messagesError } = await supabase
      .from("chatbot_messages")
      .select("*")
      .eq("session_id", id)
      .eq("user_id", profile.id)
      .order("created_at", { ascending: true });

    if (messagesError) throw new Error(messagesError.message);

    const vectorStore = loadVectorStore(false);
    const chunksById = new Map(
      vectorStore.map((chunk: { id: string }) => [chunk.id, chunk])
    );
    const hydratedMessages = (messages || []).map((message) => {
      const lightweightChunks = Array.isArray(message.cited_chunks)
        ? message.cited_chunks
        : [];
      return {
        ...message,
        cited_chunks: lightweightChunks.map((item: { id: string; score?: number }) => {
          const chunk = chunksById.get(item.id);
          return chunk
            ? { ...chunk, score: item.score ?? ("score" in chunk ? chunk.score : undefined) }
            : item;
        }),
      };
    });

    return NextResponse.json({ session, messages: hydratedMessages });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load chat.";
    const status = message.toLowerCase().includes("unauthorized") ? 403 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const email = new URL(request.url).searchParams.get("email");
    const profile = await getEmployeeByEmail(email || "");
    const supabase = getSupabaseServerClient();
    const { error } = await supabase
      .from("chatbot_sessions")
      .delete()
      .eq("id", id)
      .eq("user_id", profile.id);

    if (error) throw new Error(error.message);
    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not delete chat.";
    const status = message.toLowerCase().includes("unauthorized") ? 403 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
