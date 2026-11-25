import { NextResponse } from "next/server";
import { loadVectorStore } from "@/lib/rag-engine";

export async function GET() {
  try {
    const records = loadVectorStore(false);
    const chunkCount = records.length;

    return NextResponse.json(
      {
        status: "ready",
        chunkCount,
        totalChunks: chunkCount,
        totalPages: records[0]?.totalPages || 7,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("Error in GET /api/ingest:", error);
    return NextResponse.json(
      {
        error:
          error?.message || "Failed to load pre-built vector store from data/vector-store.json.",
      },
      { status: 500 }
    );
  }
}

export async function POST() {
  try {
    const records = loadVectorStore(false);
    const chunkCount = records.length;

    return NextResponse.json(
      {
        status: "ready",
        chunkCount,
        totalChunks: chunkCount,
        totalPages: records[0]?.totalPages || 7,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("Error in POST /api/ingest:", error);
    return NextResponse.json(
      {
        error:
          error?.message || "Failed to load pre-built vector store from data/vector-store.json.",
      },
      { status: 500 }
    );
  }
}
