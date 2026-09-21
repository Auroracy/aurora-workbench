const store = require('../../utils/store.js');

/* 预设课程（与网页版一致） */
const EE_COURSES = ['乐高搭建', '启蒙英语', '生活王国', '大树思维', '创意百科', 'BC全脑', '运动感统', '悦芽音乐', '奇妙音乐'];
const PAGE_SIZE = 10;

function todayStr() {
  const d = new Date();
  const p = function (n) { return (n < 10 ? '0' : '') + n; };
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

Page({
  data: {
    totalHours: 48,
    consumed: 0,
    remaining: 48,
    remainingClass: 'green',
    pct: 0,
    progressPct: 0,
    detailCount: 0,
    detailList: [],
    page: 1,
    totalPages: 1,

    /* 弹窗表单 */
    showModal: false,
    modalTitle: '新增课时记录',
    editIdx: -1,
    selDate: '',
    selHours: 1,
    hoursOptions: [1, 1.5, 2],
    courseOptions: [],
    courseIndex: 0,
    courseValue: '',
    notes: ''
  },

  db: null,

  onLoad() {
    this.db = store.loadDb();
    this.buildCourseOptions();
    this.render();
  },
  onShow() {
    if (this.db) {
      this.db = store.loadDb();
      this.render();
    }
  },

  buildCourseOptions() {
    const opts = EE_COURSES.slice();
    (this.db.earlyEd.customCourses || []).forEach(function (c) { opts.push(c); });
    this.setData({ courseOptions: opts });
  },

  /* 汇总统计 + 列表分页 */
  render() {
    const db = this.db;
    const total = db.earlyEd.totalHours || 0;
    let consumed = 0;
    db.earlyEd.records.forEach(function (r) { consumed += (r.hours || 0); });
    const remaining = total - consumed;

    let rclass = 'green';
    if (remaining <= 5) rclass = 'red';
    else if (remaining <= 10) rclass = 'amber';

    const pct = total > 0 ? Math.round(remaining / total * 100) : 0;
    const progressPct = total > 0 ? Math.min(100, consumed / total * 100) : 0;

    const sorted = db.earlyEd.records
      .map(function (r, i) { return { r: r, idx: i }; })
      .sort(function (a, b) {
        if (a.r.date && b.r.date && a.r.date !== b.r.date) {
          return a.r.date < b.r.date ? 1 : -1;
        }
        return (b.r.ts || 0) - (a.r.ts || 0);
      });

    const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
    let page = this.data.page;
    if (page < 1) page = 1;
    if (page > totalPages) page = totalPages;
    const start = (page - 1) * PAGE_SIZE;
    const items = sorted.slice(start, start + PAGE_SIZE).map(function (it) {
      return {
        idx: it.idx,
        date: it.r.date,
        hours: it.r.hours,
        course: it.r.course || '',
        notes: it.r.notes || ''
      };
    });

    this.setData({
      totalHours: total,
      consumed: consumed,
      remaining: remaining,
      remainingClass: rclass,
      pct: pct,
      progressPct: progressPct,
      detailCount: sorted.length,
      detailList: items,
      page: page,
      totalPages: totalPages
    });
  },

  /* ===== 弹窗 ===== */
  openModal(e) {
    this.buildCourseOptions();
    const idx = e && e.currentTarget ? e.currentTarget.dataset.idx : undefined;
    if (idx !== undefined && idx >= 0 && this.db.earlyEd.records[idx]) {
      const r = this.db.earlyEd.records[idx];
      const opts = this.data.courseOptions;
      let ci = r.course ? opts.indexOf(r.course) : 0;
      if (ci < 0) ci = 0;
      this.setData({
        showModal: true,
        modalTitle: '编辑课时记录',
        editIdx: idx,
        selDate: r.date || todayStr(),
        selHours: r.hours || 1,
        courseIndex: ci,
        courseValue: r.course || '',
        notes: r.notes || ''
      });
    } else {
      this.setData({
        showModal: true,
        modalTitle: '新增课时记录',
        editIdx: -1,
        selDate: todayStr(),
        selHours: 1,
        courseIndex: 0,
        courseValue: '',
        notes: ''
      });
    }
  },
  closeModal() {
    this.setData({ showModal: false, editIdx: -1 });
  },
  noop() {},

  onDateChange(e) { this.setData({ selDate: e.detail.value }); },
  selHours(e) { this.setData({ selHours: parseFloat(e.currentTarget.dataset.val) }); },
  onCourseChange(e) {
    const i = e.detail.value;
    this.setData({ courseIndex: i, courseValue: this.data.courseOptions[i] });
  },
  onNotesInput(e) { this.setData({ notes: e.detail.value }); },

  addCustomCourse() {
    const self = this;
    wx.showModal({
      title: '自定义课程',
      editable: true,
      placeholderText: '请输入课程名称',
      success: function (res) {
        if (res.confirm && res.content) {
          const name = res.content.trim();
          if (!name) return;
          const db = self.db;
          if (!db.earlyEd.customCourses) db.earlyEd.customCourses = [];
          if (db.earlyEd.customCourses.indexOf(name) !== -1) {
            wx.showToast({ title: '课程已存在', icon: 'none' });
            return;
          }
          db.earlyEd.customCourses.push(name);
          store.saveDb(db);
          self.buildCourseOptions();
          const ci = self.data.courseOptions.length - 1;
          self.setData({ courseIndex: ci, courseValue: name });
          wx.showToast({ title: '已添加：' + name, icon: 'none' });
        }
      }
    });
  },

  saveRecord() {
    const d = this.data;
    const notes = (d.notes || '').trim();
    const course = d.courseValue || '';
    if (!notes && !course) {
      wx.showToast({ title: '请输入课程或课堂情况', icon: 'none' });
      return;
    }
    const db = this.db;
    if (d.editIdx >= 0 && db.earlyEd.records[d.editIdx]) {
      const r = db.earlyEd.records[d.editIdx];
      r.date = d.selDate;
      r.hours = d.selHours;
      r.notes = notes;
      r.course = course;
      wx.showToast({ title: '记录已更新', icon: 'success' });
    } else {
      db.earlyEd.records.unshift({
        date: d.selDate, hours: d.selHours, notes: notes, course: course, ts: Date.now()
      });
      this.setData({ page: 1 });
    }
    store.saveDb(db);
    this.closeModal();
    this.render();
  },

  deleteRecord(e) {
    const idx = e.currentTarget.dataset.idx;
    const self = this;
    wx.showModal({
      title: '删除记录',
      content: '确定删除这条记录吗？',
      confirmColor: '#DB6B6B',
      success: function (res) {
        if (res.confirm) {
          self.db.earlyEd.records.splice(idx, 1);
          store.saveDb(self.db);
          self.render();
        }
      }
    });
  },

  editTotal() {
    const self = this;
    wx.showModal({
      title: '修改总购买课时',
      editable: true,
      placeholderText: String(this.db.earlyEd.totalHours),
      success: function (res) {
        if (res.confirm && res.content) {
          const n = parseFloat(res.content);
          if (!isNaN(n) && n >= 0) {
            self.db.earlyEd.totalHours = n;
            store.saveDb(self.db);
            self.render();
            wx.showToast({ title: '已更新总课时', icon: 'none' });
          }
        }
      }
    });
  },

  prevPage() {
    if (this.data.page > 1) {
      this.setData({ page: this.data.page - 1 });
      this.render();
    }
  },
  nextPage() {
    if (this.data.page < this.data.totalPages) {
      this.setData({ page: this.data.page + 1 });
      this.render();
    }
  }
});
