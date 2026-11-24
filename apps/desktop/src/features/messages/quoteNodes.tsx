import type * as ipc from '../../shared/lib/ipc'

export function quoteNodes(text: string, mentions: ipc.MessageMention[], emotes: Map<string, string>, onMention?: (mention: ipc.MessageMention) => void): React.ReactNode[] {
  if (mentions.length === 0 && emotes.size === 0) return [text]
  const users = [...mentions].sort((a, b) => b.name.length - a.name.length)
  const nodes: React.ReactNode[] = []
  let buffer = ''
  let index = 0
  const nextClose = new Int32Array(text.length).fill(-1)
  let close = -1
  for (let cursor = text.length - 1; cursor >= 0; cursor -= 1) {
    if (text[cursor] === ']') close = cursor
    nextClose[cursor] = close
  }
  const flush = (): void => {
    if (!buffer) return
    nodes.push(buffer)
    buffer = ''
  }

  while (index < text.length) {
    if (text[index] === '[') {
      const end = nextClose[index] ?? -1
      const code = end > index ? text.slice(index, end + 1) : ''
      const url = code ? emotes.get(code) : undefined
      if (url) {
        flush()
        nodes.push(
          <img
            key={index}
            src={url}
            alt={code}
            title={code}
            referrerPolicy="no-referrer"
            className="mx-[1px] inline-block h-[20px] w-auto align-[-4px]"
          />,
        )
        index = end + 1
        continue
      }
    }
    if (text[index] === '@') {
      const mention = users.find((user) => text.startsWith(user.name, index + 1))
      if (mention) {
        flush()
        nodes.push(
          <button
            key={index}
            type="button"
            onClick={() => onMention?.(mention)}
            className="t text-left text-[var(--accent)] hover:underline"
          >
            @{mention.name}
          </button>,
        )
        index += mention.name.length + 1
        continue
      }
    }
    buffer += text[index]
    index += 1
  }
  flush()
  return nodes
}
