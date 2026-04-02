const DB_NAME = 'pocket-tts-audio'
const DB_STORE = 'blobs'

function openIDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => {
      request.result.createObjectStore(DB_STORE)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function audioKey(readId: number, segmentIndex: number): string {
  return `${readId}:${segmentIndex}`
}

async function saveAudio(readId: number, segmentIndex: number, blob: Blob): Promise<void> {
  const idb = await openIDB()
  return new Promise((resolve, reject) => {
    const tx = idb.transaction(DB_STORE, 'readwrite')
    tx.objectStore(DB_STORE).put(blob, audioKey(readId, segmentIndex))
    tx.oncomplete = () => {
      idb.close()
      resolve()
    }
    tx.onerror = () => reject(tx.error)
  })
}

async function loadAudio(readId: number, segmentIndex: number): Promise<Blob | null> {
  const idb = await openIDB()
  return new Promise((resolve, reject) => {
    const tx = idb.transaction(DB_STORE, 'readonly')
    const request = tx.objectStore(DB_STORE).get(audioKey(readId, segmentIndex))
    request.onsuccess = () => resolve(request.result ?? null)
    request.onerror = () => reject(request.error)
    tx.oncomplete = () => idb.close()
  })
}

async function deleteAudioForRead(readId: number): Promise<void> {
  const idb = await openIDB()
  return new Promise((resolve, reject) => {
    const tx = idb.transaction(DB_STORE, 'readwrite')
    const store = tx.objectStore(DB_STORE)
    const request = store.openCursor()
    request.onsuccess = () => {
      const cursor = request.result
      if (cursor) {
        if (typeof cursor.key === 'string' && cursor.key.startsWith(`${readId}:`)) {
          cursor.delete()
        }
        cursor.continue()
      }
    }
    request.onerror = () => reject(request.error)
    tx.oncomplete = () => {
      idb.close()
      resolve()
    }
    tx.onerror = () => reject(tx.error)
  })
}

function audioUrl(blob: Blob): string {
  return URL.createObjectURL(blob)
}

export function useAudioStorage() {
  return {
    saveAudio,
    loadAudio,
    deleteAudioForRead,
    audioUrl,
  }
}
