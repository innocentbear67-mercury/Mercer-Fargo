#!/usr/bin/env python3
"""Rebuild assets/gurus/holdings.json from each fund's latest 13F-HR on SEC EDGAR.

Run once a quarter after the 13F deadline (45 days after quarter end):
    python3 scripts/fetch_13f.py
CUSIPs are mapped to tickers with OpenFIGI (keyless: 10 ids a request, 25 requests a minute).
Non-13F investors (Pelosi, Trump) live in assets/gurus/disclosures.json and are merged in unchanged.
"""
import json, os, re, sys, time, urllib.request
import xml.etree.ElementTree as ET

UA = 'MercerFargo research kundi7950@gmail.com'   # SEC asks for a contact in the User-Agent
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'assets', 'gurus', 'holdings.json')
DISC = os.path.join(ROOT, 'assets', 'gurus', 'disclosures.json')
FIGI_CACHE = os.path.join(ROOT, 'scripts', '.figi-cache.json')

FUNDS = {   # investor id -> 13F filer CIK
    'burry': 1649339, 'ackman': 1336528, 'buffett': 1067983, 'wood': 1697748, 'soros': 1029160,
    'dalio': 1350694, 'lilu': 1709323, 'marks': 949509, 'huang': 1045810,
}


def get(url, data=None, ctype=None):
    req = urllib.request.Request(url, data=data, headers={'User-Agent': UA, **({'Content-Type': ctype} if ctype else {})})
    for i in range(5):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code != 429 or i == 4:
                raise
            time.sleep(15)


def latest_13f(cik):
    sub = json.loads(get('https://data.sec.gov/submissions/CIK%010d.json' % cik))
    r = sub['filings']['recent']
    for i, form in enumerate(r['form']):
        if form == '13F-HR':
            return sub['name'], r['accessionNumber'][i], r['reportDate'][i], r['filingDate'][i]
    raise SystemExit('no 13F-HR for CIK %d' % cik)


def info_table(cik, acc):
    base = 'https://www.sec.gov/Archives/edgar/data/%d/%s/' % (cik, acc.replace('-', ''))
    items = json.loads(get(base + 'index.json'))['directory']['item']
    xmls = [it['name'] for it in items if it['name'].endswith('.xml') and it['name'] != 'primary_doc.xml']
    rows = {}
    for name in xmls:
        root = ET.fromstring(get(base + name))
        for el in root.iter():
            if not el.tag.endswith('infoTable'):
                continue
            f = {c.tag.split('}')[1]: c for c in el.iter() if '}' in c.tag}
            txt = lambda k: (f[k].text or '').strip() if k in f else ''
            cusip, pc = txt('cusip').upper(), txt('putCall').capitalize()
            row = rows.setdefault((cusip, pc), {'cusip': cusip, 'name': txt('nameOfIssuer'), 'cls': txt('titleOfClass'),
                                                'put_call': pc, 'value': 0, 'shares': 0})
            row['value'] += int(float(txt('value') or 0))   # dollars since the 2023 form change
            row['shares'] += int(float(txt('sshPrnamt') or 0))
    return list(rows.values())


def figi_map(cusips):
    cache = json.load(open(FIGI_CACHE)) if os.path.exists(FIGI_CACHE) else {}
    todo = [c for c in cusips if c not in cache]
    retry = [c for c in cusips if c in cache and not cache[c]['ticker'] and not cache[c].get('any')]
    for i in range(0, len(todo) + len(retry), 10):
        chunk = (todo + retry)[i:i + 10]
        # US listing first; a miss (foreign issuer, convertible note) retries across all exchanges
        body = json.dumps([dict({'idType': 'ID_CUSIP', 'idValue': c}, **({} if c in retry else {'exchCode': 'US'})) for c in chunk]).encode()
        res = json.loads(get('https://api.openfigi.com/v3/mapping', body, 'application/json'))
        for c, r in zip(chunk, res):
            ds = r.get('data') or [{}]
            d = next((x for x in ds if x.get('marketSector') == 'Equity' and x.get('exchCode') in ('US', 'UN', 'UW', 'UQ')), {} if c in retry else ds[0])
            cache[c] = {'ticker': d.get('ticker') if d.get('marketSector', 'Equity') == 'Equity' else None, 'name': d.get('name'), 'any': c in retry}
        json.dump(cache, open(FIGI_CACHE, 'w'))
        time.sleep(2.5)   # ponytail: keyless OpenFIGI limit; add an X-OPENFIGI-APIKEY header if this gets slow
        print('  figi %d/%d' % (min(i + 10, len(todo) + len(retry)), len(todo) + len(retry)), file=sys.stderr)
    return cache


def norm(s):
    s = re.sub(r'[^A-Z0-9 ]', ' ', s.upper().replace('&', ' AND '))
    s = re.sub(r'\b(INC|CORP|CORPORATION|CO|COMPANY|LTD|PLC|AG|SA|NV|SE|HLDGS|HOLDINGS?|GROUP|GRP|THE|LIMITED|CL A|CLASS A|NEW|N V|S A)\b', ' ', s)
    return re.sub(r'\s+', '', s)


def sec_names():
    m = {}
    for v in json.loads(get('https://www.sec.gov/files/company_tickers.json')).values():
        m.setdefault(norm(v['title']), v['ticker'])
    return m


def main():
    out = {'generated': time.strftime('%Y-%m-%d'), 'investors': {}}
    names = sec_names()
    for gid, cik in FUNDS.items():
        name, acc, period, filed = latest_13f(cik)
        rows = info_table(cik, acc)
        print('%s: %s %s %d rows' % (gid, name, period, len(rows)), file=sys.stderr)
        figi = figi_map(sorted({r['cusip'] for r in rows}))
        total = sum(r['value'] for r in rows) or 1
        hold = []
        for r in sorted(rows, key=lambda r: -r['value']):
            t = (figi.get(r['cusip']) or {}).get('ticker') or names.get(norm(r['name'])) or ''
            note = re.search(r'NOTE|DBCV|SDCV|BOND|DEB', r['cls'].upper())   # convertibles: issuer ticker, flagged
            pc = r['put_call'] or ('Note' if note else '')
            hold.append({'t': t.replace('/', '.').replace('-', '.'), 'n': r['name'].title(), 'v': r['value'], 's': r['shares'],
                         'w': round(r['value'] * 100 / total, 3), **({'pc': pc} if pc else {})})
        out['investors'][gid] = {'source': '13F-HR', 'filer': name, 'cik': cik, 'accession': acc,
                                 'period': period, 'filed': filed, 'total': total, 'holdings': hold}
    if os.path.exists(DISC):
        out['investors'].update(json.load(open(DISC)))
    json.dump(out, open(OUT, 'w'), separators=(',', ':'))
    print('wrote', OUT, os.path.getsize(OUT), 'bytes', file=sys.stderr)


if __name__ == '__main__':
    main()
