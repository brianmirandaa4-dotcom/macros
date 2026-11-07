import os
U=os.environ.get('TRAINER_URL','http://localhost:8790/')
"""Crawl every screen of Trainer and flag overlap, truncation, squished/broken words and horizontal overflow.
usage: python3 layout_audit.py [phone|desktop] [--shots]"""
import asyncio, json, sys, datetime, os
from playwright.async_api import async_playwright
SP = os.path.join(os.path.dirname(os.path.abspath(__file__)),'out')+'/'
MODE = sys.argv[1] if len(sys.argv) > 1 else 'phone'
SHOTS = '--shots' in sys.argv
OUT = SP + f'audit_{MODE}/'; os.makedirs(OUT, exist_ok=True)
T = datetime.date.today(); d = lambda i: (T - datetime.timedelta(days=i)).isoformat(); t = d(0)
E1 = lambda n, a, k, p, c, f, m, day=t: {'id': n + a + day, 'n': n, 'a': a, 'k': k, 'p': p, 'c': c, 'f': f, 'meal': m, 't': 1, 'src': 'db'}
days = {t: [E1('Eggs', '3 eggs', 215, 19, 1, 15, 'breakfast'), E1('Oats', '1 cup', 300, 10, 54, 5, 'breakfast'), E1('Chicken rice bowl with extra avocado and salsa verde', '1 large bowl', 680, 52, 78, 16, 'lunch')]}
for i in range(1, 9): days[d(i)] = [E1('Greek yogurt', '1 cup', 220, 20, 9, 11, 'breakfast', d(i)), E1('Steak and potatoes', '1 plate', 900, 60, 70, 35, 'dinner', d(i))]
dev = {'workouts': [{'src': 'WHOOP', 'id': 'w1', 'date': t, 'name': 'Weightlifting', 'min': 67, 'kcal': 420, 'strain': 11.2}], 'skip': [], 'days': {t: {'w': {'recovery': 54, 'sleepH': 6.2, 'hrv': 61, 'rhr': 56, 'strain': 11.2, 'steps': 2920}}}}
st = {'v': 1, 'days': days, 'profile': {'onboarded': True, 'name': 'Brian'}, 'calc': {'sex': 'm', 'age': 23, 'ht': 68, 'wt': 162, 'act': '1.55'},
      'weights': {t: 162, d(3): 161.4, d(7): 160.8}, 'templates': [{'id': 't1', 'name': 'Push', 'ex': ['Bench Press', 'Overhead Press', 'Triceps Pushdown']}], 'tplSeeded': True,
      'workouts': [{'id': 'wk1', 'name': 'Push', 'date': d(2), 'ex': [{'n': 'Bench Press', 'sets': [{'w': 185, 'r': 8, 'done': True}, {'w': 185, 'r': 7, 'done': True}]}]}],
      'dev': dev, 'hyd': {'log': {t: [{'id': 'h', 't': 1, 'oz': 44, 'kind': 'water'}]}, 'day': {t: {'types': ['lift']}}},
      'plan': {'type': 'bulk', 'lbs': 10, 'dur': 5, 'unit': 'months', 'start': d(2), 'style': 'gradual', 'pro': 'auto'}}
CHECK = r"""
() => {
  const W = innerWidth, out = [];
  const vis = el => { const r = el.getBoundingClientRect(); if (r.width < 2 || r.height < 2) return null; const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || +cs.opacity === 0) return null; for (let p = el; p; p = p.parentElement) { const c = getComputedStyle(p); if (c.display === 'none') return null } return r };
  const inFixed = el => { for (let p = el; p; p = p.parentElement) { const c = getComputedStyle(p); if (c.position === 'fixed' || c.position === 'sticky') return true } return false };
  const inHScroll = el => { for (let p = el.parentElement; p; p = p.parentElement) { const c = getComputedStyle(p); if (/(auto|scroll)/.test(c.overflowX) && p.scrollWidth > p.clientWidth + 2) return true } return false };
  const name = el => { let s = el.tagName.toLowerCase(); if (el.id) s += '#' + el.id; else if (el.className && typeof el.className === 'string') s += '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.');
    const t = (el.innerText || el.value || el.placeholder || '').trim().replace(/\s+/g, ' ').slice(0, 40); return s + (t ? ` "${t}"` : '') };
  const root = document.querySelector('.sheet-wrap:not([hidden]) .sheet, .scrim:not([hidden]) .sheet') && [...document.querySelectorAll('.sheet')].find(s => vis(s)) || (!document.getElementById('pageRoot').hidden ? document.getElementById('pageRoot') : document.querySelector('main'));
  const leaves = [];
  root.querySelectorAll('*').forEach(el => {
    if (['SCRIPT', 'STYLE', 'svg', 'path', 'circle', 'rect', 'line', 'text', 'g', 'OPTION'].includes(el.tagName)) return;
    const own = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()) || ['INPUT', 'BUTTON', 'SELECT', 'TEXTAREA'].includes(el.tagName);
    if (!own) return; const r = vis(el); if (!r) return; leaves.push([el, r]);
    const cs = getComputedStyle(el), fs = parseFloat(cs.fontSize);
    if (fs < 10.5) out.push(['tiny-text', name(el), fs + 'px']);
    // truncated with ellipsis or clipped
    if (el.scrollWidth > el.clientWidth + 2 && el.clientWidth > 0 && (cs.textOverflow === 'ellipsis' || cs.overflowX === 'hidden' || cs.overflow === 'hidden') && el.tagName !== 'INPUT') out.push(['truncated', name(el), `${el.scrollWidth}>${el.clientWidth}`]);
    if (cs.webkitLineClamp && cs.webkitLineClamp !== 'none' && el.scrollHeight > el.clientHeight + 2) out.push(['clamped', name(el), '']);
    // a single word broken across lines (squished)
    const txt = [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join('').trim();
    if (txt && !/\s/.test(txt) && txt.length > 2) { const tn=[...el.childNodes].find(n=>n.nodeType===3&&n.textContent.trim()); const rg=document.createRange(); rg.selectNodeContents(tn); const tops=new Set([...rg.getClientRects()].filter(q=>q.width>0).map(q=>Math.round(q.top))); if (tops.size>1) out.push(['word-broken', name(el), tops.size+' lines']) }
    // stretched or squeezed fonts
    if (cs.fontStretch && cs.fontStretch !== '100%' && cs.fontStretch !== 'normal') out.push(['font-stretch', name(el), cs.fontStretch]);
    if (cs.transform && cs.transform !== 'none') { const m = cs.transform.match(/matrix\(([^)]+)\)/); if (m) { const [a, b, c, dd] = m[1].split(',').map(Number); if (Math.abs(Math.abs(a) - Math.abs(dd)) > .05) out.push(['scaled-text', name(el), cs.transform]) } }
    if (!inFixed(el) && !inHScroll(el) && (r.right > W + 1 || r.left < -1)) out.push(['off-screen', name(el), `${Math.round(r.left)}..${Math.round(r.right)} of ${W}`]);
  });
  // overlaps between unrelated text leaves
  const L = leaves.filter(([el]) => !inFixed(el) || root.id !== 'pageRoot' && root.tagName !== 'MAIN');
  for (let i = 0; i < L.length; i++) for (let j = i + 1; j < L.length; j++) {
    const [a, ra] = L[i], [b, rb] = L[j]; if (a.contains(b) || b.contains(a)) continue;
    const ix = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left), iy = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
    if (ix > 3 && iy > 3 && ix * iy > 40) out.push(['overlap', name(a), name(b)]);
  }
  // main content hidden under fixed bars
  return out;
}"""
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        ctx = await (b.new_context(**p.devices['iPhone 14 Pro']) if MODE == 'phone' else b.new_context(viewport={'width': 1280, 'height': 860}))
        pg = await ctx.new_page(); errs = []; pg.on('pageerror', lambda x: errs.append(str(x)+' @ '+(x.stack or '').split('\n')[1:3].__str__()))
        url = ''+U+'index.html' + ('' if MODE == 'phone' else '?desktop=1')
        await pg.goto(url); await pg.evaluate("s=>{localStorage.clear();localStorage.setItem('macros.offline.v1',s);localStorage.setItem('syncope.tour2','1');localStorage.setItem('syncope.dayplan',new Date().toISOString().slice(0,10))}", json.dumps(st))
        await pg.reload(); await pg.wait_for_timeout(1500)
        report = {}
        async def run(label):
            await pg.wait_for_timeout(450)
            r = await pg.evaluate(CHECK)
            seen = set(); r2 = []
            for x in r:
                k = tuple(x)
                if k not in seen: seen.add(k); r2.append(x)
            report[label] = r2
            if SHOTS: await pg.screenshot(path=OUT + label.replace('/', '_') + '.png', full_page=True)
        async def reset():
            await pg.evaluate("()=>{document.querySelectorAll('.sheet-wrap,.scrim').forEach(s=>{const x=s.querySelector('[data-close],.sheet-x');});}")
            await pg.keyboard.press('Escape'); await pg.wait_for_timeout(150)
            await pg.evaluate("()=>{try{while(!document.getElementById('pageRoot').hidden){const b=document.querySelector('#pageRoot .page-back');if(!b)break;b.click()}}catch(e){}}")
        tabs = ['today', 'foods', 'train', 'progress']
        for v in tabs:
            await pg.evaluate("v=>{const b=document.querySelector(`#tabsBottom [data-v=\"${v}\"]`)||document.querySelector(`.tabs [data-v=\"${v}\"]`);b&&b.click()}", v)
            await run('tab/' + v)
        for sgm in ['month', 'plan', 'friends']:
            await pg.evaluate("g=>{const b=[...document.querySelectorAll('[data-goto]')].find(x=>x.dataset.goto===g&&x.offsetParent);b&&b.click()}", sgm)
            await run('progress/' + sgm)
        await pg.evaluate("()=>document.querySelector('#tabsBottom [data-v=\"today\"]')?.click()")
        pages = ['me', 'account', 'body', 'checkin', 'conn', 'data', 'fuel', 'health', 'hyd', 'ideas', 'lifts', 'member', 'method', 'muscle', 'prefs', 'prep', 'progs', 'report', 'scan', 'strength', 'targets', 'tlog', 'weigh', 'ftpl', 'cook', 'help']
        for pgid in pages:
            ok = await pg.evaluate("id=>{if(!document.getElementById('pg-'+id))return false;const b=document.createElement('button');b.dataset.pg=id;b.style.display='none';document.body.appendChild(b);b.click();b.remove();return true}", pgid)
            if ok: await run('page/' + pgid)
            await reset()
        for ga in ['signin', 'account2', 'recover', 'privacy']:
            await pg.evaluate("g=>{const b=document.createElement('button');b.dataset.ga=g;b.style.display='none';document.body.appendChild(b);b.click();b.remove()}", ga)
            await run('sheet/' + ga); await reset()
        for sid, label in [("hHow", 'sheet/setup'), ("scShort", 'sheet/applewatch')]:
            await pg.evaluate("i=>document.getElementById(i)?.click()", sid); await run(label)
        await reset()
        # active workout
        await pg.evaluate("()=>document.querySelector('#tabsBottom [data-v=\"train\"]')?.click()")
        await pg.wait_for_timeout(300)
        await pg.evaluate("()=>{const c=document.querySelector('#tplGrid [data-tpl],#tplGrid .tpl,#tplGrid button');c&&c.click()}")
        await pg.wait_for_timeout(600)
        await pg.evaluate("()=>{const b=[...document.querySelectorAll('.sheet button,.sheet .primary')].find(x=>/start/i.test(x.textContent));b&&b.click()}")
        await run('train/active')
        json.dump({'report': report, 'errs': errs}, open(OUT + 'report.json', 'w'), indent=1)
        tot = 0
        for k, v in report.items():
            if v: print(f'## {k} ({len(v)})'); [print('  ', *x) for x in v[:14]]; tot += len(v)
        print('TOTAL', tot, 'errs', errs[:3]); await b.close()
asyncio.run(main())
