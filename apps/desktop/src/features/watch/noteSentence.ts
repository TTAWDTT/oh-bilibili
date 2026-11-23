import type { CommentAnchor } from './commentTime'

/**
 * 这条时间点所在的那一小句：按换行与分号切开，只保留包含它的那一段，
 * 并把时间点和紧挨着的分 P 标记去掉——它们已经显示在左边了。
 */
export function noteSentence(text: string, anchor: CommentAnchor): string {
  const before = text.slice(0, anchor.start)
  const lineStart = before.lastIndexOf('\n') + 1
  const nextBreak = text.indexOf('\n', anchor.end)
  const lineEnd = nextBreak === -1 ? text.length : nextBreak
  const line = text.slice(lineStart, lineEnd)
  const localStart = anchor.start - lineStart
  const localEnd = anchor.end - lineStart
  const separators = [...line.matchAll(/[；;]/g)].map((match) => match.index ?? 0)
  const from = separators.filter((at) => at < localStart).at(-1)
  const to = separators.find((at) => at >= localEnd)
  return (line.slice(from === undefined ? 0 : from + 1, localStart) +
    line.slice(localEnd, to ?? line.length)).trim().replace(/^[，,、:：]\s*/, '')
}
