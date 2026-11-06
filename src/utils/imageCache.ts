// Separate database so library-list cache upgrades cannot discard rendered photos.
const LIMIT = 128 * 1024 * 1024
async function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('synolink-images', 1)
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore('images', { keyPath: 'key' })
      store.createIndex('used', 'used')
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export function imageCacheKey(server: string, account: string, path: string, revision: string, variant: string) {
  return JSON.stringify(['heic-jpeg-v1', server.replace(/\/$/, ''), account, path, revision, variant])
}

export async function readImageCache(key: string): Promise<Blob | null> {
  let db: IDBDatabase | undefined
  try {
    db = await open()
    return await new Promise((resolve, reject) => {
      const tx = db!.transaction('images', 'readwrite')
      const store = tx.objectStore('images')
      const request = store.get(key)
      let blob: Blob | null = null
      request.onsuccess = () => {
        const entry = request.result
        if (entry?.blob instanceof Blob && entry.blob.type === 'image/jpeg' && entry.blob.size) {
          blob = entry.blob
          store.put({ ...entry, used: Date.now() })
        }
      }
      tx.oncomplete = () => resolve(blob)
      tx.onerror = tx.onabort = () => reject(tx.error)
    })
  } catch { return null }
  finally { db?.close() }
}

export async function writeImageCache(key: string, blob: Blob) {
  if (!blob.size || blob.size > LIMIT || blob.type !== 'image/jpeg') return
  let db: IDBDatabase | undefined
  try {
    db = await open()
    await new Promise<void>((resolve, reject) => {
      const tx = db!.transaction('images', 'readwrite')
      const store = tx.objectStore('images')
      store.put({ key, blob, size: blob.size, used: Date.now() })
      // Descending LRU cursor retains at most 128 MiB / 2000 entries.
      let bytes = 0, count = 0
      const request = store.index('used').openCursor(null, 'prev')
      request.onsuccess = () => {
        const cursor = request.result
        if (!cursor) return
        bytes += cursor.value.size
        if (bytes > LIMIT || ++count > 2000) cursor.delete()
        cursor.continue()
      }
      tx.oncomplete = () => resolve()
      tx.onerror = tx.onabort = () => reject(tx.error)
    })
  } catch { /* Disk full or unavailable storage must not prevent viewing. */ }
  finally { db?.close() }
}
