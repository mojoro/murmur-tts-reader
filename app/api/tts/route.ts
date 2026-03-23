const TTS = process.env.TTS_SERVER_URL || "http://localhost:8000";

export async function POST(req: Request) {
  const { text, voice } = await req.json();
  if (!text) return Response.json({ error: "Missing text" }, { status: 400 });

  const res = await fetch(`${TTS}/tts/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, voice: voice || "alba" }),
  });

  if (!res.ok) {
    const msg = await res.text().catch(() => `HTTP ${res.status}`);
    return Response.json({ error: msg }, { status: 502 });
  }

  const wav = await res.arrayBuffer();
  return new Response(wav, {
    headers: { "Content-Type": "audio/wav" },
  });
}
