// v4 uuids that work in every browser we serve. `crypto.randomUUID` only exists from Safari 15.4 / Chrome 92 and
// throws "is not a function" on older iPhones and Android WebViews; getRandomValues is far older.
function format(bytes) {
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

// For credentials (the guest-chat token): CSPRNG only, never Math.random. Returns null when the browser has no
// secure generator, so the caller can fail closed instead of minting a guessable secret.
export function newSecureUuid() {
  const cryptoApi = globalThis.crypto
  if (typeof cryptoApi?.randomUUID === 'function') return cryptoApi.randomUUID()
  if (typeof cryptoApi?.getRandomValues !== 'function') return null
  return format(cryptoApi.getRandomValues(new Uint8Array(16)))
}

// For non-secret ids (analytics viewer id): falls back to Math.random as a last resort.
export function newUuid() {
  const secure = newSecureUuid()
  if (secure) return secure
  const bytes = new Uint8Array(16)
  for (let i = 0; i < 16; i += 1) bytes[i] = Math.floor(Math.random() * 256)
  return format(bytes)
}
