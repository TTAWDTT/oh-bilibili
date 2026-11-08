const SHORTCUTS: ReadonlyArray<{ keys: readonly string[]; label: string; detail: string }> = [
  { keys: ['空格'], label: '播放 / 暂停', detail: '输入框里不触发，不会打断打字' },
  { keys: ['←', '→'], label: '快退 / 快进 5 秒', detail: '焦点在进度条上时交给滑块处理' },
  { keys: ['⌘', 'K'], label: '聚焦搜索框', detail: '任何页面都直接回到搜索' },
  { keys: ['Esc'], label: '关闭弹窗', detail: '没有弹窗时收起右栏' },
]

/** 快捷键写进设置页而不是藏在文档里，用户找不到的快捷键等于没有。 */
export function ShortcutTable() {
  return (
    <table className="w-full border-collapse text-left">
      <caption className="sr-only">键盘快捷键</caption>
      <tbody>
        {SHORTCUTS.map((shortcut) => (
          <tr key={shortcut.label} className="border-t border-hairline first:border-t-0">
            <td className="w-[88px] py-1 pr-4 align-middle">
              <span className="flex flex-wrap items-center gap-1">
                {shortcut.keys.map((key) => (
                  <kbd key={key} className="kbd">
                    {key}
                  </kbd>
                ))}
              </span>
            </td>
            <td className="w-[168px] py-1 pr-4 align-middle text-[12px] text-white/85">{shortcut.label}</td>
            <td className="py-1 align-middle text-[11px] text-white/32">{shortcut.detail}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
