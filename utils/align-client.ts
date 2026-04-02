import type { AlignmentResponse } from '~/types/tts'

export async function alignAudio(
  baseUrl: string,
  audioBlob: Blob,
  text: string,
): Promise<AlignmentResponse> {
  const form = new FormData()
  form.append('audio', audioBlob, 'audio.wav')
  form.append('text', text)
  const res = await fetch(`${baseUrl}/align`, {
    method: 'POST',
    body: form,
  })
  if (!res.ok) throw new Error(`Alignment failed: HTTP ${res.status}`)
  return await res.json()
}
