/* 错题本：错过的题留在这里，连着答对 2 次才「毕业」 */
var store = require('../../utils/store.js');

Page({
  data: { fontLevel: 1, list: [], count: 0 },

  onShow: function () {
    var list = store.wrongList();
    this.setData({ fontLevel: store.getFont(), list: list, count: list.length });
  },

  practice: function () {
    if (!this.data.count) {
      wx.showToast({ title: '现在没有错题', icon: 'none', duration: 1800 });
      return;
    }
    wx.navigateTo({ url: '/pages/quiz/quiz?mode=wrong' });
  },

  goPractice: function () { wx.switchTab({ url: '/pages/index/index' }); },

  clearWrong: function () {
    var self = this;
    if (!this.data.count) return;
    wx.showModal({
      title: '清空错题本？',
      content: '已经背下来的题可以清掉，之后做错还会自动加回来。',
      confirmText: '清空',
      cancelText: '再留着',
      success: function (r) {
        if (!r.confirm) return;
        store.clearWrong();
        self.onShow();
      }
    });
  }
});
