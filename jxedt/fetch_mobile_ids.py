# -*- coding: utf-8 -*-
"""用 m.jxedt.com 移动版专项页补齐完整题目 ID（页面内嵌 arrnowids 区间）。"""
import re, json, time, urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

_D = os.path.dirname(os.path.abspath(__file__))

UA_M = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1'
OUT = _D + '/cat_ids_full.json'


def get(url, retry=3):
    for i in range(retry):
        try:
            req = urllib.request.Request(url, headers={
                'User-Agent': UA_M,
                'Referer': 'https://m.jxedt.com/mnks/ckm1/zxlx/',
                'Accept': 'text/html,application/xhtml+xml,*/*',
            })
            with urllib.request.urlopen(req, timeout=25) as r:
                return r.read().decode('utf-8', 'ignore')
        except Exception as e:
            if i == retry - 1:
                return 'ERR:' + str(e)
            time.sleep(1.0 * (i + 1))
    return 'ERR'


def cat_list():
    h = open(_D + '/ckm1_zxlx.html', encoding='utf-8', errors='ignore').read()
    items = re.findall(r'<a href="(\d+)/">\s*<div class="num">(\d+)</div>.*?<div class="name">(.*?)</div>\s*<div class="desc">(\d+)题', h, re.S)
    return [{'cid': int(a), 'name': c.strip(), 'declared': int(d)} for a, b, c, d in items]


def one(cat):
    cid = cat['cid']
    html = get('https://m.jxedt.com/mnks/ckm1/zxlx/{}/'.format(cid))
    if html.startswith('ERR:'):
        return cid, {'name': cat['name'], 'declared': cat['declared'], 'ids': [], 'error': html}
    m = re.search(r'var\s+arrnowids\s*=\s*(\[.*?\]);', html, re.S)
    ids = []
    if m:
        for a, b in re.findall(r"\['(\d+)','(\d+)'\]", m.group(1)):
            ids += list(range(int(a), int(b) + 1))
    return cid, {'name': cat['name'], 'declared': cat['declared'],
                 'ids': [str(x) for x in dict.fromkeys(ids)]}


def main():
    cats = cat_list()
    print('categories:', len(cats), flush=True)
    res = {}
    with ThreadPoolExecutor(max_workers=4) as ex:
        futs = {ex.submit(one, c): c for c in cats}
        for f in as_completed(futs):
            cid, d = f.result()
            res[str(cid)] = d
            ok = 'OK' if len(d['ids']) == d['declared'] else 'DIFF'
            print('{:>4} {:<28} declared={:<4} got={:<4} {} {}'.format(
                cid, d['name'][:26], d['declared'], len(d['ids']), ok, d.get('error', '')), flush=True)
    json.dump(res, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    allids = set()
    for d in res.values():
        allids.update(d['ids'])
    print('TOTAL declared:', sum(c['declared'] for c in cats), flush=True)
    print('TOTAL unique ids:', len(allids), flush=True)
    json.dump(sorted(allids, key=int), open(_D + '/all_ids.json', 'w'), ensure_ascii=False)


if __name__ == '__main__':
    main()
