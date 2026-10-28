import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  return target.isContentEditable
}

function isDialogOpen(): boolean {
  return Boolean(document.querySelector('[role="dialog"], [role="alertdialog"]'))
}

export function useAppShortcuts(onHelp: () => void): void {
  const navigate = useNavigate()

  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      const ctrl = e.ctrlKey || e.metaKey
      if (!ctrl) {
        if (e.key === 'F1') {
          e.preventDefault()
          onHelp()
        }
        return
      }

      const typing = isTypingTarget(e.target)
      const key = e.key.toLowerCase()

      if (key === '/' || key === '?') {
        e.preventDefault()
        onHelp()
        return
      }

      // Không điều hướng / mở / đóng khi đang ở hộp thoại — tránh mất dữ liệu đang nhập.
      if (isDialogOpen()) return

      if (key === ',') {
        e.preventDefault()
        navigate('/settings')
        return
      }
      if (key === '1') {
        e.preventDefault()
        navigate('/')
        return
      }
      if (key === '2') {
        e.preventDefault()
        navigate('/profiles')
        return
      }
      if (key === '3') {
        e.preventDefault()
        navigate('/groups')
        return
      }
      if (key === '4') {
        e.preventDefault()
        navigate('/gmail')
        return
      }
      if (key === '5') {
        e.preventDefault()
        navigate('/links')
        return
      }
      if (key === '6') {
        e.preventDefault()
        navigate('/settings')
        return
      }
      if (key === 'f') {
        e.preventDefault()
        navigate('/profiles')
        requestAnimationFrame(() => {
          document.getElementById('profile-search')?.focus()
        })
        return
      }
      if (typing) return
      if (key === 'n') {
        e.preventDefault()
        navigate('/profiles')
        window.dispatchEvent(new Event('cm:new-profile'))
        return
      }
      if (key === 'enter' && e.shiftKey) {
        e.preventDefault()
        window.dispatchEvent(new Event('cm:stop-selected'))
        return
      }
      if (key === 'enter') {
        e.preventDefault()
        window.dispatchEvent(new Event('cm:launch-selected'))
      }
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navigate, onHelp])
}
