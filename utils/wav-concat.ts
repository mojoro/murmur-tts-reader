export async function concatWavBlobs(blobs: Blob[]): Promise<Blob> {
  if (blobs.length === 0) throw new Error('No audio to export')
  if (blobs.length === 1) return blobs[0]

  const buffers = await Promise.all(blobs.map((b) => b.arrayBuffer()))

  // Read format info from the first WAV header
  const firstView = new DataView(buffers[0])
  const numChannels = firstView.getUint16(22, true)
  const sampleRate = firstView.getUint32(24, true)
  const bitsPerSample = firstView.getUint16(34, true)

  // Calculate total PCM data size (skip 44-byte header from each)
  let totalDataSize = 0
  for (const buf of buffers) {
    totalDataSize += buf.byteLength - 44
  }

  // Create new WAV with combined header + all PCM data
  const output = new ArrayBuffer(44 + totalDataSize)
  const view = new DataView(output)
  const bytes = new Uint8Array(output)

  // RIFF header
  writeString(view, 0, 'RIFF')
  view.setUint32(4, 36 + totalDataSize, true)
  writeString(view, 8, 'WAVE')

  // fmt chunk
  writeString(view, 12, 'fmt ')
  view.setUint32(16, 16, true) // chunk size
  view.setUint16(20, 1, true) // PCM format
  view.setUint16(22, numChannels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * numChannels * (bitsPerSample / 8), true)
  view.setUint16(32, numChannels * (bitsPerSample / 8), true)
  view.setUint16(34, bitsPerSample, true)

  // data chunk
  writeString(view, 36, 'data')
  view.setUint32(40, totalDataSize, true)

  // Copy PCM data from each buffer (skip 44-byte headers)
  let offset = 44
  for (const buf of buffers) {
    bytes.set(new Uint8Array(buf, 44), offset)
    offset += buf.byteLength - 44
  }

  return new Blob([output], { type: 'audio/wav' })
}

function writeString(view: DataView, offset: number, str: string) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i))
  }
}
