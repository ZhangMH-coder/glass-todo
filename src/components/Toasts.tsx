import type { Toast } from '../hooks/useToasts'

interface Props {
  toasts: Toast[]
}

const ICON: Record<Toast['kind'], string> = {
  info: 'ℹ',
  success: '✓',
  error: '⚠'
}

export default function Toasts({ toasts }: Props): React.JSX.Element {
  return (
    <div className="toast-stack" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast--${t.kind}`}>
          <span aria-hidden="true">{ICON[t.kind]}</span>
          <span>{t.message}</span>
        </div>
      ))}
    </div>
  )
}
