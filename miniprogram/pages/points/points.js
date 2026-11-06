/* 考点页：13 类考点，点开看大字口诀，点「练这组」只练这一类 */
var store = require('../../utils/store.js');

Page({
  data: {
    fontLevel: 1,
    cats: [],
    expandId: ''
  },

  onShow: function () {
    this.setData({
      fontLevel: store.getFont(),
      cats: store.catList()
    });
  },

  toggleNote: function (e) {
    var id = e.currentTarget.dataset.id;
    this.setData({ expandId: this.data.expandId === id ? '' : id });
  },

  practiceCat: function (e) {
    var cat = e.currentTarget.dataset.cat;
    wx.navigateTo({ url: '/pages/quiz/quiz?mode=cat&cat=' + cat });
  },

  practiceAll: function () {
    wx.navigateTo({ url: '/pages/quiz/quiz?mode=normal' });
  }
});
