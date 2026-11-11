// Separate database so library-list cache upgrades cannot discard rendered photos.
const LIMIT = 128 * 1024 * 1024
async function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('synolink-images', 2)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains('images')) {
        const store = request.result.createObjectStore('images', { keyPath: 'key' })
        store.createIndex('used', 'used')
      }
      request.result.createObjectStore('meta')
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
          if (Date.now() - entry.used > 60_000) store.put({ ...entry, used: Date.now() })
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
      const tx = db!.transaction(['images', 'meta'], 'readwrite')
      const store = tx.objectStore('images')
      const meta = tx.objectStore('meta')
      const stats = meta.get('usage')
      function insert(bytes: number, count: number) {
        const old = store.get(key)
        old.onsuccess = () => {
          bytes += blob.size - (old.result?.size ?? 0)
          if (!old.result) count++
          store.put({ key, blob, size: blob.size, used: Date.now() })
          if (bytes <= LIMIT && count <= 2000) {
            meta.put({ bytes, count }, 'usage')
            return
          }
          const oldest = store.index('used').openCursor()
          oldest.onsuccess = () => {
            const cursor = oldest.result
            if (cursor && (bytes > LIMIT || count > 2000)) {
              bytes -= cursor.value.size
              count--
              cursor.delete()
              cursor.continue()
            } else meta.put({ bytes, count }, 'usage')
          }
        }
      }
      stats.onsuccess = () => {
        if (stats.result) return insert(stats.result.bytes, stats.result.count)
        // Count legacy entries once. All later writes maintain totals in the same transaction.
        let bytes = 0, count = 0
        const entries = store.openCursor()
        entries.onsuccess = () => {
          const cursor = entries.result
          if (!cursor) return insert(bytes, count)
          bytes += cursor.value.size
          count++
          cursor.continue()
        }
      }
      tx.oncomplete = () => resolve()
      tx.onerror = tx.onabort = () => reject(tx.error)
    })
  } catch { /* Disk full or unavailable storage must not prevent viewing. */ }
  finally { db?.close() }
}
