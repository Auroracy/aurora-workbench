/* 科目一 · 慢慢练（50 岁+ 大字版）
   纯本地小程序：不联网、不需要云开发、不需要登录 */
const store = require('./utils/store.js');

App({
  globalData: {
    version: '2026-11-06',
    fontLevel: 1        /* 0 标准 / 1 大字（默认） / 2 超大字 */
  },

  onLaunch() {
    const db = store.loadDb();
    this.globalData.fontLevel = db.font;
    this.globalData.db = db;
  },

  setFontLevel(n) {
    const level = Math.max(0, Math.min(2, Number(n)));
    const db = store.loadDb();
    db.font = level;
    store.saveDb(db);
    this.globalData.fontLevel = level;
    return level;
  }
});
