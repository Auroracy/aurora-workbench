/* 首页：一眼看清进度，一个大按钮就能开始，字号随时调大 */
var store = require('../../utils/store.js');
var app = getApp();

Page({
  data: {
    fontLevel: 1,
    fontLabels: ['标准', '大字', '超大字'],
    ov: {},
    history: []
  },

  onShow: function () {
    var ov = store.overview();
    var history = ov.history.map(function (h) {
      return { date: h.date, text: '做对 ' + h.right + ' / ' + h.total + ' 题' };
    });
    this.setData({ fontLevel: store.getFont(), ov: ov, history: history });
  },

  startPractice: function () {
    wx.navigateTo({ url: '/pages/quiz/quiz?mode=normal' });
  },

  startWrong: function () {
    if (!store.overview().wrongCount) {
      wx.showToast({ title: '现在没有错题', icon: 'none', duration: 1800 });
      return;
    }
    wx.navigateTo({ url: '/pages/quiz/quiz?mode=wrong' });
  },

  goPoints: function () {
    wx.switchTab({ url: '/pages/points/points' });
  },

  changeFont: function (e) {
    var lv = Number(e.currentTarget.dataset.lv);
    app.setFontLevel(lv);
    this.setData({ fontLevel: lv });
    wx.showToast({ title: '字号已调整', icon: 'none', duration: 1200 });
  },

  clearData: function () {
    var self = this;
    wx.showModal({
      title: '清空学习记录？',
      content: '做过的题、错题本、掌握度会全部清零，字号设置保留。',
      confirmText: '确认清空',
      cancelText: '不清空',
      success: function (r) {
        if (!r.confirm) return;
        var font = store.getFont();
        store.resetAll();
        store.setFont(font);
        self.onShow();
      }
    });
  }
});
