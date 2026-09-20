const store = require('./utils/store.js');

/* ===== 云开发环境 ID =====
 * 只有「联网模块」需要（行情 / 新闻联播 / 定投均线）。
 * 纯本地模块不用管这里。
 *
 * 获取方式：开发者工具顶部「云开发」→ 开通 → 创建环境 →
 *          环境设置里复制「环境 ID」（形如 aurora-1g8xxxxx），粘贴到下面。
 */
const CLOUD_ENV = 'cloud1-d0ga4s8mm02f4c83a';

App({
  globalData: {
    version: { date: '2026-09-20', desc: '微信小程序版首版：英语每日单词' },
    cloudReady: false
  },

  onLaunch() {
    // 首次启动初始化本地库（与网页版 localStorage 数据结构保持一致，便于迁移）
    const db = store.loadDb();
    store.saveDb(db);

    // 云开发：填了环境 ID 才启用
    if (CLOUD_ENV && wx.cloud) {
      try {
        wx.cloud.init({ env: CLOUD_ENV, traceUser: true });
        this.globalData.cloudReady = true;
      } catch (e) {
        console.warn('[Aurora] 云开发初始化失败', e);
      }
    }
    console.log('[Aurora] 工作台小程序启动', JSON.stringify(this.globalData.version),
      '云开发：' + (this.globalData.cloudReady ? '已启用' : '未启用（仅本地模块可用）'));
  },

  onShow() {},
  onHide() {}
});
