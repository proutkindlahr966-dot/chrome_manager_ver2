import { Keyboard } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'

const ROWS: Array<{ keys: string; action: string }> = [
  { keys: 'Ctrl + 1', action: 'Tổng quan' },
  { keys: 'Ctrl + 2', action: 'Hồ sơ' },
  { keys: 'Ctrl + 3', action: 'Nhóm' },
  { keys: 'Ctrl + 4', action: 'Gmail' },
  { keys: 'Ctrl + 5', action: 'Link web' },
  { keys: 'Ctrl + 6 / Ctrl + ,', action: 'Cài đặt' },
  { keys: 'Ctrl + N', action: 'Tạo hồ sơ mới' },
  { keys: 'Ctrl + F', action: 'Tìm hồ sơ' },
  { keys: 'Ctrl + Enter', action: 'Mở hồ sơ đang chọn' },
  { keys: 'Ctrl + Shift + Enter', action: 'Đóng hồ sơ đang chọn' },
  { keys: 'F1 / Ctrl + /', action: 'Bảng phím tắt này' }
]

interface ShortcutsHelpModalProps {
  open: boolean
  onClose: () => void
}

export function ShortcutsHelpModal({ open, onClose }: ShortcutsHelpModalProps): JSX.Element | null {
  return (
    <Modal open={open} onClose={onClose} title="Phím tắt" description="Dùng khi cửa sổ app đang được focus.">
      <ul className="space-y-1.5 text-sm">
        {ROWS.map((row) => (
          <li
            key={row.keys}
            className="flex items-center justify-between gap-3 rounded-lg border border-line px-3 py-2"
          >
            <span className="text-ink-soft">{row.action}</span>
            <kbd className="shrink-0 rounded-md bg-surface-muted px-2 py-0.5 font-mono text-[11px] text-ink">
              {row.keys}
            </kbd>
          </li>
        ))}
      </ul>
      <p className="mt-3 flex items-center gap-1.5 text-xs text-ink-muted">
        <Keyboard size={12} />
        Ctrl trên Windows là phím điều khiển.
      </p>
    </Modal>
  )
}
