import { readerHost } from '../host'
import { Component, type ReactNode } from 'react'

export class ErrorBoundary extends Component<
  { children: ReactNode; onClose?: () => void; onRetry?: () => void; application?: boolean },
  { failed: boolean; attempt: number }
> {
  state = { failed: false, attempt: 0 }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    if (this.state.failed)
      return (
        <div className="document-state" role="alert">
          <h2>
            {this.props.application
              ? 'The reader encountered a problem'
              : 'This paper encountered a problem'}
          </h2>
          <p>Your saved reading positions are still available.</p>
          <button
            autoFocus
            className="primary-button"
            onClick={() => {
              this.props.onRetry?.()
              this.setState({ failed: false, attempt: this.state.attempt + 1 })
            }}
          >
            Try again
          </button>
          {this.props.onClose && (
            <button className="text-button" onClick={this.props.onClose}>
              Close tab
            </button>
          )}
          {this.props.application && readerHost().restart && (
            <button className="text-button" onClick={() => void readerHost().restart?.()}>
              Reopen safely
            </button>
          )}
        </div>
      )
    return (
      <div className="boundary-content" key={this.state.attempt}>
        {this.props.children}
      </div>
    )
  }
}
