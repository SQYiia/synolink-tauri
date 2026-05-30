/** 平台判断：以 UA 为主，足够日常分发 */
const UA = typeof navigator !== 'undefined' ? navigator.userAgent : ''

export const isIOS = /iPad|iPhone|iPod/.test(UA) || (UA.includes('Mac') && 'ontouchend' in (globalThis as any))
export const isAndroid = /Android/.test(UA)
export const isMobileUA = isIOS || isAndroid
export const isWindows = /Windows/i.test(UA)
