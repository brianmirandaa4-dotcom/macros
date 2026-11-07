import os
U=os.environ.get('TRAINER_URL','http://localhost:8790/')
# Batch verifier: old data survives update, old backup restores, offline load, views render, corruption recovery.
import asyncio, json, datetime, sys
from playwright.async_api import async_playwright
BASE=U
t=datetime.date.today().isoformat(); y=(datetime.date.today()-datetime.timedelta(days=1)).isoformat()
# data in the oldest app format (first MACROS version fields only)
OLD={'v':1,'days':{y:[{'id':'a1','n':'Chicken breast','a':'6 oz','g':170,'k':280,'p':52,'c':0,'f':6,'src':'db','t':1,'meal':'lunch'}],t:[{'id':'a2','n':'Eggs','a':'3','g':150,'k':215,'p':19,'c':1,'f':15,'src':'db','t':2,'meal':'breakfast'}]},
 'goals':{'p':150,'c':250,'f':70},'calc':{'sex':'m','age':23,'ht':70,'wt':165,'act':'1.55'},'custom':[{'id':'c1','name':'My shake','k':300,'p':40,'c':20,'f':5,'sg':0}],'weights':{y:166.2},
 'meals':[{'id':'m1','name':'Usual lunch','items':[{'id':'i1','n':'Rice','a':'1 cup','g':158,'k':205,'p':4,'c':45,'f':0,'src':'db','t':3}]}],'checkins':{y:{'energy':4,'note':'felt good'}},
 'profile':{'name':'Brian','onboarded':True},'workouts':[{'id':'w1','name':'Push','date':y,'start':1,'end':3600001,'ex':[{'n':'Bench press','sets':[{'w':185,'r':8}]}],'prs':[]}]}
BACKUP={'app':'MACROS','v':1,'exported':'2026-10-01T00:00:00Z','days':{'2026-09-30':[{'id':'b1','n':'Oats','a':'1 cup','g':80,'k':300,'p':10,'c':54,'f':5,'src':'db','t':1,'meal':'breakfast'}]},'goals':{'p':140,'c':240,'f':70},'custom':[],'weights':{'2026-09-30':170}}
async def main():
  ok=True;res=[]
  async with async_playwright() as p:
    b=await p.chromium.launch(executable_path='/usr/bin/google-chrome',args=['--no-sandbox'])
    ctx=await b.new_context(viewport={'width':390,'height':844},is_mobile=True,has_touch=True)
    pg=await ctx.new_page();errs=[];pg.on('pageerror',lambda e:errs.append(str(e)))
    await pg.goto(BASE);await pg.evaluate("s=>{localStorage.clear();localStorage.setItem('macros.offline.v1',s);localStorage.setItem('macros.appver','old')}",json.dumps(OLD))
    await pg.reload();await pg.wait_for_timeout(900)
    st=await pg.evaluate("JSON.parse(localStorage.getItem('macros.offline.v1'))")
    c1=len(st['days'].get(y,[]))==1 and len(st['days'].get(t,[]))==1 and st['weights'].get(y)==166.2 and len(st['workouts'])==1 and st['custom'][0]['name']=='My shake' and st['meals'][0]['name']=='Usual lunch' and st['checkins'][y]['note']=='felt good'
    snap=await pg.evaluate("!!localStorage.getItem('macros.offline.v1.update')")
    res.append(('old data kept after update',c1));res.append(('pre-update safety copy made',snap))
    for v in ['today','train','plan','friends','week','month','foods']:
      await pg.evaluate(f"location.hash='{v}'");await pg.wait_for_timeout(350)
      vis=await pg.evaluate(f"!document.getElementById('v-{v}').hidden&&document.getElementById('v-{v}').innerText.length>40")
      res.append((f'{v} renders',vis))
    # restore old backup (replace)
    await pg.evaluate("location.hash='plan'");await pg.wait_for_timeout(200)
    await pg.set_input_files('#importJson',files=[{'name':'old.json','mimeType':'application/json','buffer':json.dumps(BACKUP).encode()}]);await pg.wait_for_timeout(400)
    await pg.click('#rReplace');await pg.wait_for_timeout(500)
    st=await pg.evaluate("JSON.parse(localStorage.getItem('macros.offline.v1'))")
    res.append(('old backup restores',st['days'].get('2026-09-30',[{}])[0].get('n')=='Oats' and st['weights'].get('2026-09-30')==170))
    # corruption recovery
    await pg.evaluate("s=>{localStorage.setItem('macros.offline.v1.safe',s);localStorage.setItem('macros.offline.v1','{broken')}",json.dumps(OLD));await pg.reload();await pg.wait_for_timeout(800)
    st=await pg.evaluate("JSON.parse(localStorage.getItem('macros.offline.v1'))")
    res.append(('recovers from corrupted save',len(st['workouts'])==1))
    # empty-overwrite guard
    blocked=await pg.evaluate("()=>{const before=localStorage.getItem('macros.offline.v1').length;return before}")
    # offline
    await pg.wait_for_timeout(1500)
    await ctx.set_offline(True);await pg.reload();await pg.wait_for_timeout(1200)
    off=await pg.evaluate("!!document.getElementById('v-today')&&document.body.innerText.length>200")
    res.append(('loads offline',off));await ctx.set_offline(False)
    res.append(('no JS errors',not [e for e in errs if 'Failed to fetch' not in e]))
    await b.close()
  for n,v in res:print(('PASS ' if v else 'FAIL ')+n)
  if errs:print('errors:',errs[:5])
asyncio.run(main())
