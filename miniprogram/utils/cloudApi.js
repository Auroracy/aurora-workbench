/* ===== 联网请求封装 =====
 * 小程序端不要直接用 wx.request 打第三方接口（会被域名白名单拦），
 * 统一走云函数 auroraProxy 中转到服务端再请求。
 *
 * 用法：
 *   const api = require('../../utils/cloudApi.js');
 *   api.text('https://hq.sinajs.cn/list=sh000001', 'gbk').then(t => ...)
 */
const FN = 'auroraProxy';

/* 云开发是否已启用（app.js 里填了环境 ID 才会 init） */
function ready() {
  return !!(wx.cloud && typeof wx.cloud.callFunction === 'function' && wx.cloud.envReady !== false);
}

function call(url, headers, encoding) {
  return new Promise(function (resolve, reject) {
    if (!ready()) {
      reject(new Error('云开发未启用：请先在开发者工具开通云开发，并把环境 ID 填进 app.js 的 CLOUD_ENV'));
      return;
    }
    wx.cloud.callFunction({
      name: FN,
      data: { url: url, headers: headers || {}, encoding: encoding || '' }
    }).then(function (r) {
      const res = r && r.result;
      if (res && res.ok) resolve(res.body);
      else reject(new Error((res && res.error) || '云函数返回异常'));
    }).catch(function (e) {
      reject(new Error(String((e && e.errMsg) || e)));
    });
  });
}

/* 取文本（encoding 传 'gbk' 时云函数会做转码） */
function text(url, encoding, headers) {
  return call(url, headers, encoding);
}

/* 取 JSON（自动解析；新浪那种 JS 变量赋值格式请用 text 自行处理） */
function json(url, headers) {
  return call(url, headers, '').then(function (t) {
    try { return JSON.parse(t); } catch (e) { throw new Error('返回不是合法 JSON'); }
  });
}

module.exports = { ready, text, json, call };
