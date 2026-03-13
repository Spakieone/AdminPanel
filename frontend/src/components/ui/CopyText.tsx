import { useEffect, useMemo, useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { useToastContext } from '../../contexts/ToastContext'

async function copyToClipboard(text: string) {
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // ignore
  }

  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', 'true')
    ta.style.position = 'fixed'
    ta.style.top = '-1000px'
    ta.style.left = '-1000px'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}

export default function CopyText({
  text,
  label,
  className,
  toastMessage = 'Скопировано',
  showToast = true,
}: {
  text: string
  label?: React.ReactNode
  className?: string
  toastMessage?: string
  showToast?: boolean
}) {
  const toast = useToastContext()
  const [copied, setCopied] = useState(false)
  const safe = useMemo(() => String(text ?? ''), [text])

  useEffect(() => {
    if (!copied) return
    const t = window.setTimeout(() => setCopied(false), 1200)
    return () => window.clearTimeout(t)
  }, [copied])

  return (
    <button
      type="button"
      className={
        className ||
        'inline-flex items-center gap-2 px-2 py-1 rounded-lg border border-default bg-transparent hover:bg-overlay-sm text-xs font-mono text-primary transition-colors'
      }
      onClick={async () => {
        if (!safe) return
        const ok = await copyToClipboard(safe)
        if (!ok) {
          toast.showError('Ошибка', 'Не удалось скопировать', 3000)
          return
        }
        setCopied(true)
        if (showToast) toast.showSuccess('Готово', toastMessage, 1800)
      }}
      title="Скопировать"
      aria-label="Скопировать"
    >
      {copied ? <Check className="w-4 h-4 text-[var(--accent)]" /> : <Copy className="w-4 h-4 text-secondary" />}
      {label ?? (copied ? 'Скопировано' : safe)}
    </button>
  )
}

