const APP_SALT = 'synolink-2024-x9k'

function deriveKey(seed: string): number[] {
  const combined = APP_SALT + seed
  const key: number[] = []
  for (let i = 0; i < 32; i++) {
    let h = 0
    for (let j = 0; j < combined.length; j++) {
      h = ((h << 5) - h + combined.charCodeAt((j + i) % combined.length)) | 0
    }
    key.push(Math.abs(h) % 256)
  }
  return key
}

export function encodePassword(password: string, serverId: string): string {
  const key = deriveKey(serverId)
  const bytes = new TextEncoder().encode(password)
  const encoded = new Uint8Array(bytes.length)
  for (let i = 0; i < bytes.length; i++) {
    encoded[i] = bytes[i] ^ key[i % key.length]
  }
  return btoa(String.fromCharCode(...encoded))
}

export function decodePassword(encoded: string, serverId: string): string {
  const key = deriveKey(serverId)
  const raw = atob(encoded)
  const bytes = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) {
    bytes[i] = raw.charCodeAt(i) ^ key[i % key.length]
  }
  return new TextDecoder().decode(bytes)
}
