import { Component, type ErrorInfo, type ReactNode } from 'react'

/**
 * 渲染出错时把错误显示出来。
 *
 * 没有这层时一个未捕获的异常会把整棵 DOM 卸掉，窗口变成一片白，
 * 用户看到的是「应用坏了」，开发者拿不到任何线索。
 */
export class CrashNote extends Component<
  { children: ReactNode },
  { error: Error | null; componentStack: string }
> {
  state: { error: Error | null; componentStack: string } = { error: null, componentStack: '' }

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('渲染失败', error, info.componentStack)
    this.setState({ componentStack: info.componentStack ?? '' })
  }

  render(): ReactNode {
    const { error, componentStack } = this.state
    if (!error) return this.props.children
    return (
      <div className="flex h-full flex-col gap-2 p-6 text-[13px]">
        <h1 className="text-[15px] font-medium">这个页面渲染失败了</h1>
        <p className="text-[var(--text-2)]">其余页面仍可用。下面的信息是给开发者看的。</p>
        <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words rounded-[6px] bg-[var(--panel-alt)] p-3 text-[12px] text-[var(--text-2)]">
          {[error.name, error.message, String(error), error.stack ?? ''].filter(Boolean).join('\n')}
        </pre>
        <pre className="max-h-[30%] overflow-auto whitespace-pre-wrap break-words rounded-[6px] bg-[var(--panel-alt)] p-3 text-[12px] text-[var(--text-2)]">
          {componentStack}
        </pre>
        <button
          type="button"
          className="t press self-start rounded-[6px] border border-[var(--line)] px-3 py-1.5"
          onClick={() => this.setState({ error: null })}
        >
          重试
        </button>
      </div>
    )
  }
}
