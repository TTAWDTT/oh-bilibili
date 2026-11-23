/** 合并计数的时间窗：从第一条起算，后来的重复不延长。 */
export const MERGE_WINDOW_MS = 2000

/**
 * 同句合并的分组记录。
 *
 * 只记每句最近一条的颜色/模式都相同的「组长」：后来的同句落在组长
 * 起算的 2 秒窗内才算一次重复，到窗口外就另起一组。
 * 成员被车道淘汰后组长失效，下一条同句会重新起飞。
 */
export class DanmakuMergeGroups {
  private leaders = new Map<string, { at: number; flightId: number }>()

  clear(): void {
    this.leaders.clear()
  }

  /** 这条同句该并到哪一条上；没有可用的组就返回空。 */
  leaderFor(text: string, at: number, alive: ReadonlySet<number>): number | null {
    const group = this.leaders.get(text)
    if (!group) return null
    if (at < group.at || at >= group.at + MERGE_WINDOW_MS) return null
    return alive.has(group.flightId) ? group.flightId : null
  }

  remember(text: string, at: number, flightId: number): void {
    this.leaders.set(text, { at, flightId })
  }

  /** 组长被淘汰：把它摘掉，别让后面的同句并进一条已经不在屏幕上的条目。 */
  forget(flightId: number): void {
    for (const [text, group] of this.leaders) {
      if (group.flightId === flightId) this.leaders.delete(text)
    }
  }
}
