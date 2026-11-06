// IndexedDB avoids blocking rendering and localStorage's small quota for large libraries.
async function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('synolink-media', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('libraries')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export async function readMediaCache(key: string): Promise<any[] | null> {
  let db: IDBDatabase | undefined
  try {
    db = await database()
    return await new Promise((resolve, reject) => {
      const request = db!.transaction('libraries').objectStore('libraries').get(key)
      request.onsuccess = () => resolve(Array.isArray(request.result) ? request.result : null)
      request.onerror = () => reject(request.error)
    })
  } catch { return null }
  finally { db?.close() }
}

export async function writeMediaCache(key: string, items: any[]) {
  let db: IDBDatabase | undefined
  try {
    db = await database()
    await new Promise<void>((resolve, reject) => {
      const transaction = db!.transaction('libraries', 'readwrite')
      transaction.objectStore('libraries').put(JSON.parse(JSON.stringify(items)), key)
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error)
    })
  } catch { /* Caching is optional; a full disk must not fail a successful scan. */ }
  finally { db?.close() }
}
