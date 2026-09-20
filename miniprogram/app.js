const store = require('./utils/store.js');

App({
  globalData: {
    version: { date: '2026-09-20', desc: '微信小程序版首版：英语每日单词' }
  },

  onLaunch() {
    // 首次启动初始化本地库（与网页版 localStorage 数据结构保持一致，便于迁移）
    const db = store.loadDb();
    store.saveDb(db);
    console.log('[Aurora] 工作台小程序启动', JSON.stringify(this.globalData.version));
  },

  onShow() {},
  onHide() {}
});
