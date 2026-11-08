export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

export function str(args: Record<string, unknown>, key: string): string {
  const value = args[key]
  if (typeof value !== 'string') throw new Error(`mock 参数 ${key} 不合法`)
  return value
}

export function num(args: Record<string, unknown>, key: string): number {
  const value = args[key]
  if (typeof value !== 'number' || Number.isNaN(value)) throw new Error(`mock 参数 ${key} 不合法`)
  return value
}

export function bool(args: Record<string, unknown>, key: string): boolean {
  const value = args[key]
  if (typeof value !== 'boolean') throw new Error(`mock 参数 ${key} 不合法`)
  return value
}

export function strArray(args: Record<string, unknown>, key: string): string[] {
  const value = args[key]
  if (!Array.isArray(value)) throw new Error(`mock 参数 ${key} 不合法`)
  return value.filter((item): item is string => typeof item === 'string')
}
