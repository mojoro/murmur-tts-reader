"use client";

import { useState, useEffect, useRef } from "react";

type Voice = { id: string; name: string; type: "builtin" | "custom" };

export default function Home() {
  const [text, setText] = useState("");
  const [voices, setVoices] = useState<Voice[]>([]);
  const [voice, setVoice] = useState("alba");
  const [online, setOnline] = useState<boolean | null>(null);
  const [generating, setGenerating] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Clone state
  const [recording, setRecording] = useState(false);
  const [recordSecs, setRecordSecs] = useState(0);
  const mediaRecRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [cloneName, setCloneName] = useState("");
  const [cloneFile, setCloneFile] = useState<File | null>(null);
  const [promptText, setPromptText] = useState("");
  const [cloning, setCloning] = useState(false);
  const [cloneMsg, setCloneMsg] = useState<string | null>(null);

  function refreshVoices() {
    fetch("/api/voices")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data: { builtin: string[]; custom: string[] }) => {
        const list: Voice[] = [
          ...data.builtin.map((n) => ({ id: n, name: n, type: "builtin" as const })),
          ...data.custom.map((n) => ({ id: n, name: n, type: "custom" as const })),
        ];
        setVoices(list);
        if (list.length > 0 && !list.some((v) => v.id === voice)) {
          setVoice(list[0].id);
        }
        setOnline(true);
      })
      .catch(() => setOnline(false));
  }

  useEffect(() => { refreshVoices() }, []);

  async function handleGenerate() {
    if (!text.trim() || generating) return;
    setGenerating(true);
    setError(null);
    if (audioUrl) { URL.revokeObjectURL(audioUrl); setAudioUrl(null); }

    try {
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: text.trim(), voice }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || `HTTP ${res.status}`);
      }
      const blob = await res.blob();
      setAudioUrl(URL.createObjectURL(blob));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Generation failed");
    } finally {
      setGenerating(false);
    }
  }

  function encodeWav(buf: AudioBuffer): File {
    const sr = buf.sampleRate, len = buf.length;
    const samples = new Float32Array(len);
    for (let c = 0; c < buf.numberOfChannels; c++) {
      const ch = buf.getChannelData(c);
      for (let i = 0; i < len; i++) samples[i] += ch[i] / buf.numberOfChannels;
    }
    const pcm = new Int16Array(len);
    for (let i = 0; i < len; i++) pcm[i] = Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32767)));
    const header = new ArrayBuffer(44), v = new DataView(header);
    const w = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
    w(0, "RIFF"); v.setUint32(4, 36 + pcm.byteLength, true); w(8, "WAVE");
    w(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
    v.setUint16(22, 1, true); v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true);
    v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    w(36, "data"); v.setUint32(40, pcm.byteLength, true);
    return new File([header, pcm.buffer], "recording.wav", { type: "audio/wav" });
  }

  async function startRecording() {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mr = new MediaRecorder(stream);
    chunksRef.current = [];
    mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data) };
    mr.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      if (timerRef.current) clearInterval(timerRef.current);
      const blob = new Blob(chunksRef.current, { type: mr.mimeType });
      const audioBuf = await new AudioContext().decodeAudioData(await blob.arrayBuffer());
      setCloneFile(encodeWav(audioBuf));
      setRecording(false);
    };
    mr.start();
    mediaRecRef.current = mr;
    setRecordSecs(0);
    setRecording(true);
    timerRef.current = setInterval(() => setRecordSecs((s) => s + 1), 1000);
  }

  async function handleClone() {
    if (!cloneFile || !cloneName.trim() || cloning) return;
    setCloning(true);
    setCloneMsg(null);
    try {
      const form = new FormData();
      form.append("name", cloneName.trim());
      form.append("file", cloneFile);
      if (promptText.trim()) form.append("prompt_text", promptText.trim());
      const res = await fetch("/api/clone", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Clone failed");
      setCloneMsg(`Voice "${data.voice}" cloned`);
      setCloneName("");
      setCloneFile(null);
      setPromptText("");
      refreshVoices();
    } catch (e) {
      setCloneMsg(e instanceof Error ? e.message : "Clone failed");
    } finally {
      setCloning(false);
    }
  }

  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  const builtin = voices.filter((v) => v.type === "builtin");
  const custom = voices.filter((v) => v.type === "custom");

  return (
    <main style={{ maxWidth: 560, margin: "0 auto", padding: "48px 20px 80px" }}>
      <h1 style={{ fontSize: 28, fontWeight: 800, letterSpacing: "-0.03em", marginBottom: 4 }}>
        pocket-tts
      </h1>
      <p style={{ color: "#666", fontSize: 12, marginBottom: 32, letterSpacing: "0.08em" }}>
        LOCAL VOICE SYNTHESIS
        <span style={{
          display: "inline-block", width: 6, height: 6, borderRadius: "50%", marginLeft: 10,
          background: online === true ? "#4ade80" : online === false ? "#ff5c3a" : "#555",
          boxShadow: online === true ? "0 0 6px rgba(74,222,128,0.4)" : "none",
          verticalAlign: "middle",
        }} />
      </p>

      {/* Text input */}
      <textarea
        rows={6}
        placeholder="Paste your text here..."
        value={text}
        onChange={(e) => setText(e.target.value)}
        style={{
          width: "100%", padding: 14, borderRadius: 12,
          background: "#111", border: "1px solid #222", color: "#e0e0e0",
          fontSize: 14, lineHeight: 1.6, resize: "vertical",
          fontFamily: "inherit", outline: "none",
        }}
      />

      {/* Voice + generate */}
      <div style={{ display: "flex", gap: 10, marginTop: 12, alignItems: "center", flexWrap: "wrap" }}>
        <select
        value={voice}
        onChange={(e) => setVoice(e.target.value)}
        style={{
          padding: "8px 30px 8px 12px", borderRadius: 8, fontSize: 12,
          fontFamily: "inherit", fontWeight: 600,
          background: "#151515", border: "1px solid #2a2a2a", color: "#e0e0e0",
          cursor: "pointer", outline: "none", appearance: "none",
          backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' fill='none'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%23666' stroke-width='1.5' stroke-linecap='round'/%3E%3C/svg%3E")`,
          backgroundRepeat: "no-repeat", backgroundPosition: "right 10px center",
        }}
      >
        {builtin.length > 0 && (
          <optgroup label="Built-in">
            {builtin.map((v) => <option key={v.id} value={v.id}>{cap(v.name)}</option>)}
          </optgroup>
        )}
        {custom.length > 0 && (
          <optgroup label="Cloned">
            {custom.map((v) => <option key={v.id} value={v.id}>{cap(v.name)}</option>)}
          </optgroup>
        )}
      </select>

        <button
          onClick={handleGenerate}
          disabled={generating || !text.trim() || online === false}
          style={{
            padding: "8px 20px", borderRadius: 8, border: "none",
            fontFamily: "inherit", fontWeight: 700, fontSize: 12,
            letterSpacing: "0.06em", cursor: generating ? "wait" : "pointer",
            background: generating || !text.trim() ? "#1a1a1a" : "#e0e0e0",
            color: generating || !text.trim() ? "#555" : "#000",
            transition: "all 0.15s",
          }}
        >
          {generating ? "GENERATING..." : "GENERATE"}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div style={{
          marginTop: 12, padding: "10px 14px", borderRadius: 8,
          background: "rgba(255,92,58,0.08)", border: "1px solid rgba(255,92,58,0.2)",
          color: "#ff8566", fontSize: 12,
        }}>
          {error}
        </div>
      )}

      {/* Audio player */}
      {audioUrl && (
        <div style={{ marginTop: 16 }}>
          <audio controls autoPlay src={audioUrl} style={{ width: "100%", borderRadius: 8, filter: "invert(1) hue-rotate(180deg)" }} />
          <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
            <a
              href={audioUrl}
              download={`tts-${Date.now()}.wav`}
              style={{
                padding: "6px 14px", borderRadius: 6, fontSize: 11,
                fontWeight: 600, fontFamily: "inherit", textDecoration: "none",
                border: "1px solid #2a2a2a", color: "#888",
              }}
            >
              DOWNLOAD WAV
            </a>
          </div>
        </div>
      )}

      {/* Clone voice */}
      <div style={{ marginTop: 40, borderTop: "1px solid #1a1a1a", paddingTop: 24 }}>
        <h2 style={{ fontSize: 14, fontWeight: 700, letterSpacing: "0.08em", color: "#888", marginBottom: 12 }}>
          CLONE VOICE
        </h2>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input
            type="text"
            placeholder="voice name"
            value={cloneName}
            onChange={(e) => setCloneName(e.target.value)}
            style={{
              flex: 1, minWidth: 100, padding: "8px 10px", borderRadius: 8,
              background: "#111", border: "1px solid #222", color: "#e0e0e0",
              fontSize: 12, fontFamily: "inherit", outline: "none",
            }}
          />
          <label style={{
            flex: 2, minWidth: 120, display: "flex", alignItems: "center", gap: 8,
            background: "#111", border: "1px solid #222", borderRadius: 8,
            padding: "8px 10px", cursor: "pointer", fontSize: 12,
            color: cloneFile ? "#e0e0e0" : "#555", overflow: "hidden",
          }}>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {cloneFile ? cloneFile.name : "upload .wav"}
            </span>
            <input
              type="file"
              accept=".wav,audio/wav"
              style={{ display: "none" }}
              onChange={(e) => setCloneFile(e.target.files?.[0] ?? null)}
            />
          </label>
          <button
            onClick={recording ? () => mediaRecRef.current?.stop() : startRecording}
            style={{
              padding: "8px 12px", borderRadius: 8, border: "none",
              fontFamily: "inherit", fontWeight: 600, fontSize: 12, cursor: "pointer",
              background: recording ? "rgba(255,92,58,0.15)" : "#151515",
              color: recording ? "#ff5c3a" : "#888",
              whiteSpace: "nowrap",
            }}
          >
            {recording ? `STOP ${Math.floor(recordSecs / 60)}:${String(recordSecs % 60).padStart(2, "0")}` : "REC"}
          </button>
          <button
            onClick={handleClone}
            disabled={cloning || !cloneFile || !cloneName.trim()}
            style={{
              padding: "8px 16px", borderRadius: 8, border: "none",
              fontFamily: "inherit", fontWeight: 700, fontSize: 12, cursor: "pointer",
              background: cloning || !cloneFile || !cloneName.trim() ? "#1a1a1a" : "#e0e0e0",
              color: cloning || !cloneFile || !cloneName.trim() ? "#555" : "#000",
            }}
          >
            {cloning ? "..." : "CLONE"}
          </button>
        </div>
        <input
          type="text"
          placeholder="transcript of reference audio (optional, improves quality)"
          value={promptText}
          onChange={(e) => setPromptText(e.target.value)}
          style={{
            width: "100%", marginTop: 8, padding: "8px 10px", borderRadius: 8,
            background: "#111", border: "1px solid #222", color: "#e0e0e0",
            fontSize: 11, fontFamily: "inherit", outline: "none",
          }}
        />
        <p style={{ margin: "4px 0 0", fontSize: 10, color: "#444", lineHeight: 1.4 }}>
          Type exactly what is said in the reference clip. Some backends (CosyVoice) use this to improve cloning.
        </p>
        {cloneMsg && (
          <p style={{ marginTop: 8, fontSize: 12, color: cloneMsg.includes("cloned") ? "#4ade80" : "#ff8566" }}>
            {cloneMsg}
          </p>
        )}
      </div>

      {/* Offline hint */}
      {online === false && (
        <div style={{
          marginTop: 24, padding: "12px 14px", borderRadius: 8,
          background: "#111", border: "1px solid #222",
          color: "#888", fontSize: 12, lineHeight: 1.6,
        }}>
          TTS sidecar not detected. Start it:
          <code style={{ display: "block", marginTop: 6, padding: "6px 10px", borderRadius: 6, background: "#0d0d0d", color: "#e0e0e0", fontSize: 11 }}>
            cd tts-server && uv run uvicorn main:app
          </code>
        </div>
      )}

      <p style={{ marginTop: 40, fontSize: 10, color: "#333", letterSpacing: "0.1em" }}>
        ALL PROCESSING RUNS LOCALLY. NO DATA LEAVES YOUR MACHINE.
      </p>
    </main>
  );
}
