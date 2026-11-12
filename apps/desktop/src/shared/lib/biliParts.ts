/** B 站排行榜的分区 rid。0 是全站，其余对应网页端那一排频道。 */
export const PARTS: { rid: number; name: string }[] = [
  { rid: 0, name: '全站' },
  { rid: 1, name: '动画' },
  { rid: 3, name: '音乐' },
  { rid: 129, name: '舞蹈' },
  { rid: 4, name: '游戏' },
  { rid: 36, name: '知识' },
  { rid: 188, name: '科技' },
  { rid: 160, name: '生活' },
  { rid: 211, name: '美食' },
  { rid: 119, name: '鬼畜' },
  { rid: 5, name: '娱乐' },
  { rid: 181, name: '影视' },
]
