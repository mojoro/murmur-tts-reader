const TTS = process.env.TTS_SERVER_URL || "http://localhost:8000";

export async function GET() {
  const res = await fetch(`${TTS}/tts/voices`);
  if (!res.ok) return Response.json({ error: "TTS offline" }, { status: 502 });
  return Response.json(await res.json());
}
