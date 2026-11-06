# -*- coding: utf-8 -*-
"""抓取驾校一点通 科目一 专项练习 各分类页，提取题目 data-id。"""
import re, json, os, sys, time
import urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor, as_completed

_D = os.path.dirname(os.path.abspath(__file__))

BASE = 'https://mnks.jxedt.com/ckm1/zxlx/{}/'
UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'
OUT = _D + '/cat_ids.json'

def get(url, referer=None, retry=3):
    for i in range(retry):
        try:
            req = urllib.request.Request(url, headers={
                'User-Agent': UA,
                'Referer': referer or 'https://mnks.jxedt.com/ckm1/zxlx/',
                'Accept': 'text/html,application/xhtml+xml,application/json,*/*',
                'X-Requested-With': 'XMLHttpRequest',
            })
            with urllib.request.urlopen(req, timeout=20) as r:
                return r.read().decode('utf-8', 'ignore')
        except Exception as e:
            if i == retry - 1:
                return 'ERR:' + str(e)
            time.sleep(0.6 * (i + 1))
    return 'ERR'

def parse_cat_list():
    h = open(_D + '/ckm1_zxlx.html', encoding='utf-8', errors='ignore').read()
    blocks = re.findall(r'<a[^>]+href="//mnks\.jxedt\.com/ckm1/zxlx/(\d+)/"[^>]*>(.*?)</a>', h, re.S)
    out = []
    for cid, inner in blocks:
        txt = re.sub(r'<[^>]+>', ' ', inner)
        txt = re.sub(r'\s+', ' ', txt).strip()
        out.append({'cid': int(cid), 'name': txt})
    return out

def one(cat):
    cid = cat['cid']
    html = get(BASE.format(cid), 'https://mnks.jxedt.com/ckm1/zxlx/')
    if html.startswith('ERR:'):
        return cid, {'error': html}
    ids = re.findall(r'<li[^>]+data-id="(\d+)"', html)
    if not ids:
        ids = re.findall(r'data-id="(\d+)"', html)
    # 分类名从页面 title 兜底
    return cid, {'name': cat['name'], 'ids': list(dict.fromkeys(ids))}

def main():
    cats = parse_cat_list()
    print('categories:', len(cats), flush=True)
    res = {}
    with ThreadPoolExecutor(max_workers=6) as ex:
        futs = {ex.submit(one, c): c['cid'] for c in cats}
        for f in as_completed(futs):
            cid, data = f.result()
            res[str(cid)] = data
            print(cid, data.get('name'), len(data.get('ids', [])), data.get('error', ''), flush=True)
    json.dump(res, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    allids = set()
    for d in res.values():
        allids.update(d.get('ids', []))
    print('TOTAL unique ids:', len(allids), flush=True)

if __name__ == '__main__':
    main()
