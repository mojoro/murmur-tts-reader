const TTS = process.env.TTS_SERVER_URL || "http://localhost:8000";

export async function POST(req: Request) {
  const form = await req.formData();
  const res = await fetch(`${TTS}/tts/clone-voice`, { method: "POST", body: form });
  if (!res.ok) {
    const msg = await res.text().catch(() => `HTTP ${res.status}`);
    return Response.json({ error: msg }, { status: 502 });
  }
  return Response.json(await res.json());
}
