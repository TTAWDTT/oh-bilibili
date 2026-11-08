/**
 * 真实 B 站封面。
 *
 * 浏览器预览（npm run web）没有 Rust 侧的真实接口，只能用生成图；但生成图
 * 再怎么画也不像视频缩略图。这里存的是按曲名在 B 站搜出来的首条结果的封面，
 * 是真实数据——真机（npm run dev / .app）走真实接口，不会用到这份表。
 *
 * 取图时不需要 Referer，所以 <img referrerPolicy="no-referrer"> 能直接显示。
 * 链接可能随 B 站清理而失效，失效时自动退回生成图。
 */
export const REAL_COVERS: Readonly<Record<string, string>> = {
  "七里香": "https://i0.hdslb.com/bfs/archive/e31b53d89a624c49f7f7056a9556f10d21de4c2b.jpg",
  "光年之外": "https://i1.hdslb.com/bfs/archive/5a1abf198297a88ca8d1717a33f73505fd72acb0.jpg",
  "关山酒": "https://i0.hdslb.com/bfs/archive/3a25a576d31cc68c002ecab84ae93fc5c1d55cc3.jpg",
  "句号": "https://i0.hdslb.com/bfs/archive/aa38d5f7e6d7050e5bf159c090862f37af0e0b76.jpg",
  "告白气球": "https://i0.hdslb.com/bfs/archive/7648f1df4425381f9a0074576b51020b83cc6e23.jpg",
  "夜空中最亮的星": "https://i0.hdslb.com/bfs/archive/b3e3c2faf8a05d7469c9a38236db8bf7e906fe6e.jpg",
  "大鱼": "https://i1.hdslb.com/bfs/archive/36c54fef7aa6b2844f24df6aea05010f877930d8.jpg",
  "孤勇者": "https://i1.hdslb.com/bfs/archive/baf2c698e753590eb196f61535db1d9e6710ca3f.jpg",
  "孤城": "https://i1.hdslb.com/bfs/archive/0f27b048544bdae73f488103416fffe89e58b7db.jpg",
  "小幸运": "https://i1.hdslb.com/bfs/archive/fee1f0abfac2ad76b39e04d5ea9f852870b0baa3.jpg",
  "少年": "https://i0.hdslb.com/bfs/archive/ac29788ba2ddd38f92d4638440ab7fa78783995a.jpg",
  "山楂树之恋": "https://i1.hdslb.com/bfs/archive/be737469cb31a159796e45e21f896714b4e63fb3.jpg",
  "平凡之路": "https://i2.hdslb.com/bfs/archive/070abdacef0473616bdcf00e67861dd651ce82b9.jpg",
  "成都": "https://i1.hdslb.com/bfs/archive/51e7a16f3524447c4d27b568474e50e073c92864.jpg",
  "我记得": "https://i0.hdslb.com/bfs/archive/ddcaab202134b7fb9c35e3e0a8cf1cd5caba7800.jpg",
  "春庭雪": "https://i1.hdslb.com/bfs/archive/4e384e746e8c0a096125d098523e98fe61037c3d.jpg",
  "晴天": "https://i1.hdslb.com/bfs/archive/6770f3a7d60f21469194251726588cee3b8bdb45.jpg",
  "江南": "https://i0.hdslb.com/bfs/archive/91d29eb68823966581c105221372d1696af9a6b9.jpg",
  "海底": "https://i2.hdslb.com/bfs/archive/ad7175f684f5280bf8eb7048897e8db865002291.jpg",
  "漠河舞厅": "https://i2.hdslb.com/bfs/archive/784923b6ae1ab7c4a2f1a31e0203dcfc647696ff.jpg",
  "稻香": "https://i0.hdslb.com/bfs/archive/2c8a5ccc63b03861971ca9803b4da090b29fb541.jpg",
  "花海": "https://i1.hdslb.com/bfs/archive/01f5fb23306205bdcd3f3ef1cb126858b562a5f3.jpg",
  "说谎": "https://i2.hdslb.com/bfs/archive/9f5025a57b3ea9c26f777ee70c6c0ec3fe12912b.jpg",
  "起风了": "https://i2.hdslb.com/bfs/archive/457945d2d3c9b83ea082607f76802250561151ba.jpg",
  "遇见": "https://i0.hdslb.com/bfs/archive/0a06ccb5297656bcef1ead639e1bb97288691563.jpg",
}
