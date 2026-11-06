# -*- coding: utf-8 -*-
"""抓取 /get_question 详情，全量 + 断点续抓；失败回退移动版 g.asp。"""
import json, os, re, sys, time, urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

_D = os.path.dirname(os.path.abspath(__file__))

RAW = _D + '/questions_raw.json'
IDS = _D + '/all_ids.json'
UA_PC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
UA_M = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1'


def fetch(url, ua, referer, timeout=20):
    req = urllib.request.Request(url, headers={
        'User-Agent': ua, 'Referer': referer,
        'Accept': 'application/json,text/plain,*/*',
        'X-Requested-With': 'XMLHttpRequest',
    })
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode('utf-8', 'ignore')


def pc_detail(qid):
    txt = fetch('https://mnks.jxedt.com/get_question?index=' + qid, UA_PC,
                'https://mnks.jxedt.com/ckm1/zxlx/')
    d = json.loads(txt)
    if not d.get('question'):
        raise ValueError('empty question')
    return d


def m_detail(qid):
    txt = fetch('https://m.jxedt.com/mnksnew/g.asp?id=' + qid, UA_M,
                'https://m.jxedt.com/mnks/ckm1/zxlx/')
    d = json.loads(txt)
    if not d.get('question') or str(d.get('id', '')).startswith('$'):
        raise ValueError('empty/template question')
    return {
        'id': int(qid), 'question': d.get('question', ''),
        'a': d.get('an1', ''), 'b': d.get('an2', ''), 'c': d.get('an3', ''),
        'd': d.get('an4', ''), 'e': '', 'f': '', 'g': '',
        'right': d.get('answertrue', ''), 'ta': d.get('answertrue', ''),
        'type': d.get('type', ''), 'chapter': d.get('chapterid', ''),
        'imageurl': d.get('imageurl', '') or '',
        'bestanswer': d.get('explain', '') or '',
        'bestanswerid': d.get('bestanswerid', ''),
        'skillInfo': d.get('skillInfo', '') or '',
        'options': '', '_src': 'mobile',
    }


def one(qid):
    last = None
    for attempt in range(4):
        try:
            return qid, pc_detail(qid), None
        except Exception as e:
            last = e
        try:
            return qid, m_detail(qid), None
        except Exception as e:
            last = e
        time.sleep(0.5 * (attempt + 1))
    return qid, None, str(last)


def main():
    ids = json.load(open(IDS))
    data = {}
    if os.path.exists(RAW):
        data = json.load(open(RAW, encoding='utf-8'))
    todo = [q for q in ids if q not in data]
    print('total ids {} already {} todo {}'.format(len(ids), len(data), len(todo)), flush=True)
    done = 0
    fails = []
    t0 = time.time()
    with ThreadPoolExecutor(max_workers=6) as ex:
        futs = [ex.submit(one, q) for q in todo]
        for f in as_completed(futs):
            qid, d, err = f.result()
            if d:
                data[qid] = d
            else:
                fails.append(qid)
            done += 1
            if done % 100 == 0:
                json.dump(data, open(RAW, 'w', encoding='utf-8'), ensure_ascii=False)
                print('{}/{} got={} fail={} {:.0f}s'.format(
                    done, len(todo), len(data), len(fails), time.time() - t0), flush=True)
    json.dump(data, open(RAW, 'w', encoding='utf-8'), ensure_ascii=False)
    print('DONE got={} fail={} elapsed={:.0f}s'.format(len(data), len(fails), time.time() - t0), flush=True)
    print('FAILS', fails[:40], flush=True)


if __name__ == '__main__':
    main()
