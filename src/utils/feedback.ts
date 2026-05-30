import { ElMessage, ElMessageBox } from 'element-plus'
import {
  showToast,
  showSuccessToast,
  showFailToast,
  showLoadingToast,
  showConfirmDialog,
  showDialog,
  closeToast,
} from 'vant'
import { useIsMobile } from '../composables/useIsMobile'

type ToastType = 'success' | 'warning' | 'error' | 'info'

function isMobile() {
  return useIsMobile().value
}

export function toast(message: string, type: ToastType = 'info') {
  if (isMobile()) {
    if (type === 'success') showSuccessToast(message)
    else if (type === 'error') showFailToast(message)
    else showToast(message)
    return
  }
  ElMessage({ message, type })
}

export function toastLoading(message = '加载中...') {
  if (isMobile()) {
    return showLoadingToast({ message, forbidClick: true, duration: 0 })
  }
  return ElMessage({ message, type: 'info', duration: 0 })
}

export function closeLoading() {
  if (isMobile()) closeToast()
}

export async function confirm(
  message: string,
  title = '确认',
  opts: { confirmText?: string; cancelText?: string; danger?: boolean } = {}
): Promise<boolean> {
  if (isMobile()) {
    try {
      await showConfirmDialog({
        title,
        message,
        confirmButtonText: opts.confirmText ?? '确定',
        cancelButtonText: opts.cancelText ?? '取消',
        confirmButtonColor: opts.danger ? '#EF4444' : undefined,
      })
      return true
    } catch {
      return false
    }
  }
  try {
    await ElMessageBox.confirm(message, title, {
      confirmButtonText: opts.confirmText ?? '确定',
      cancelButtonText: opts.cancelText ?? '取消',
      type: opts.danger ? 'warning' : 'info',
    })
    return true
  } catch {
    return false
  }
}

export async function prompt(
  message: string,
  title = '输入',
  opts: { inputType?: 'text' | 'password' | 'digit'; placeholder?: string; defaultValue?: string; pattern?: RegExp; patternError?: string } = {}
): Promise<string | null> {
  if (isMobile()) {
    // Vant 没有现成的 prompt，自己用 Dialog + 自定义内容包一下
    const { reactive } = await import('vue')
    const state = reactive({ value: opts.defaultValue ?? '' })
    return new Promise<string | null>((resolve) => {
      showDialog({
        title,
        message,
        showCancelButton: true,
        confirmButtonText: '确定',
        cancelButtonText: '取消',
        // Vant 的 message 可以是 string 也可以是 VNode；这里简化为只展示提示文字，
        // 实际输入用浏览器 prompt 兜底（iOS WebView 支持）
        beforeClose: () => true,
      }).then(() => {
        const v = window.prompt(message, opts.defaultValue ?? '')
        if (v === null) resolve(null)
        else if (opts.pattern && !opts.pattern.test(v)) {
          toast(opts.patternError ?? '格式错误', 'error')
          resolve(null)
        } else resolve(v)
      }).catch(() => resolve(null))
      void state
    })
  }
  try {
    const r = await ElMessageBox.prompt(message, title, {
      inputType: opts.inputType === 'digit' ? 'text' : opts.inputType,
      inputPattern: opts.pattern,
      inputErrorMessage: opts.patternError,
      inputPlaceholder: opts.placeholder,
      inputValue: opts.defaultValue,
    })
    return r.value
  } catch {
    return null
  }
}
