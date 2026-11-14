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
  /* 12 个：6 列网格正好两行排满。少一个的话第二行只有 5 个，右边短一截，
     整条频道带看起来就是「没对齐」。B 站首页这一排也是 6+6。
     「资讯」在排行榜接口里不存在（rid=202 返回 -400），这里用实测有效的 223。 */
  { rid: 223, name: '汽车' },
]

/** B 站各分区的代表色，用于分区标签与频道圆点。 */
export function partColor(name: string): string {
  const table: Record<string, string> = {
    音乐: '#fca39a',
    舞蹈: '#ff6699',
    游戏: '#53b6ff',
    鬼畜: '#ff8f6b',
    动画: '#ffa3b6',
    生活: '#ffb027',
    影视: '#ffa0a0',
    电影: '#ff8f9c',
    电视剧: '#ff8fa3',
    搞笑: '#ffd05b',
    科技: '#00aeec',
    数码: '#00aeec',
    美食: '#f6c34a',
    动物: '#8bd28b',
    时尚: '#ff9ec4',
    娱乐: '#ff9ec4',
  }
  return table[name] ?? '#9499a0'
}
