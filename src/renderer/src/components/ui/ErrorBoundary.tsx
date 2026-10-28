import { Component, type ErrorInfo, type ReactNode } from 'react'

interface ErrorBoundaryProps {
  children: ReactNode
  /** Đổi key (ví dụ đường dẫn) để xóa lỗi và vẽ lại nội dung. */
  resetKey?: string
}

interface ErrorBoundaryState {
  error: Error | null
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidUpdate(prev: ErrorBoundaryProps): void {
    if (prev.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null })
    }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[ui]', error, info.componentStack)
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children

    return (
      <div className="panel mx-auto mt-8 max-w-lg p-6 text-center" role="alert">
        <h2 className="font-display text-lg font-semibold text-ink">Màn hình này gặp lỗi</h2>
        <p className="mt-2 text-sm text-ink-muted">
          Phần còn lại của ứng dụng vẫn dùng được. Hãy thử lại, hoặc chuyển sang trang khác.
        </p>
        <p className="mt-2 break-words font-mono text-xs text-danger">{this.state.error.message}</p>
        <button
          type="button"
          className="btn-primary mt-4"
          onClick={() => this.setState({ error: null })}
        >
          Thử lại
        </button>
      </div>
    )
  }
}
