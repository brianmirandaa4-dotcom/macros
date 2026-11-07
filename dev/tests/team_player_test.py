import os
U=os.environ.get('TRAINER_URL','http://localhost:8790/')
import asyncio,json,datetime,urllib.request,random,sys
from playwright.async_api import async_playwright
SP=os.path.join(os.path.dirname(os.path.abspath(__file__)),'out')+'/'
BASE=''+U+'index.html'
T=datetime.date.today().isoformat()
def req(path,body=None,auth=None,method=None):
    r=urllib.request.Request('http://localhost:8791'+path,data=None if body is None else json.dumps(body).encode(),method=method or ('POST' if body is not None else 'GET'),headers={'Content-Type':'application/json',**({'Authorization':'Bearer '+auth} if auth else {})})
    return json.loads(urllib.request.urlopen(r).read())
R=str(random.randint(1000,99999))
reg=req('/api/register',{});CA=reg['uid']+'.'+reg['token']
req('/api/acct-set',{'username':'coach'+R,'password':'Coach2026!'},CA)
cr=req('/api/team/create',{'name':'Blue Hens Football','school':'University of Delaware','sport':'Football','coachName':'Coach Smith','role':'Head coach','roster':90,'settings':{'meals':4,'weighDays':[0,1,2,3,4,5,6],'weighBy':'10:00','prePost':True}},CA)
CODE=cr['code'];print('team code',CODE)
res=[]
def chk(n,c):res.append((n,bool(c)));print(('PASS ' if c else 'FAIL ')+n)
async def route(rt):
    u=rt.request.url.replace('https://macros-sync.brianmirandaa4.workers.dev','http://localhost:8791')
    try:
        resp=await rt.fetch(url=u);await rt.fulfill(response=resp)
    except Exception as e:await rt.abort()
async def fresh(b,url=BASE,seed=None):
    ctx=await b.new_context(viewport={'width':390,'height':844},is_mobile=True,has_touch=True);pg=await ctx.new_page();errs=[];pg.on('pageerror',lambda x:errs.append(str(x)))
    await pg.route('https://macros-sync.brianmirandaa4.workers.dev/**',route)
    if seed:
        await pg.goto(BASE);await pg.evaluate("s=>{localStorage.clear();localStorage.setItem('macros.offline.v1',s);localStorage.setItem('syncope.tour2','1');localStorage.setItem('syncope.dayplan',new Date().toISOString().slice(0,10));localStorage.setItem('syncope.acctask','1')}",json.dumps(seed))
    await pg.goto(url);await pg.wait_for_timeout(1300);return ctx,pg,errs
async def main():
  async with async_playwright() as p:
    b=await p.chromium.launch(executable_path='/usr/bin/google-chrome',args=['--no-sandbox'])
    # 1. role picker
    ctx,pg,errs=await fresh(b)
    roles=await pg.locator('[data-role]').all_inner_texts()
    chk('role picker shows 3 choices',len(roles)==3 and 'Just me' in roles[0] and 'Join my team' in roles[1] and 'coach' in roles[2])
    chk('Just me is the default',await pg.get_attribute('[data-role="solo"]','aria-pressed')=='true')
    await pg.screenshot(path=SP+'tp_role.png')
    await pg.click('[data-role="coach"]');await pg.click('#obNext');await pg.wait_for_timeout(400)
    chk('coach sets flag and hands off',await pg.evaluate("localStorage.getItem('syncope.role')")=='coach' and ('Coach setup coming' in await pg.inner_text('#toastRoot') or await pg.evaluate("typeof window.openCoachSetup==='function'")))
    await ctx.close()
    # 2. join via link during onboarding, consent required, account created
    ctx,pg,errs=await fresh(b,BASE+'?team='+CODE.lower())
    chk('?team link pre-selects Join',await pg.get_attribute('[data-role="team"]','aria-pressed')=='true' and await pg.input_value('#obTeam')==CODE)
    chk('link removed from URL','team=' not in pg.url)
    await pg.click('#obNext');await pg.wait_for_timeout(900)
    chk('lookup shows team, school, coach','Blue Hens Football' in (t:=await pg.inner_text('#tjTeam')) and 'Delaware' in t and 'Coach Smith' in t)
    await pg.screenshot(path=SP+'tp_join.png')
    await pg.click('#tjGo');await pg.wait_for_timeout(200)
    chk('consent required (no boxes)',not await pg.locator('#tjE').is_hidden() and await pg.locator('#acU').count()==0)
    await pg.check('#tjAdult');await pg.click('#tjGo');await pg.wait_for_timeout(200)
    chk('consent required (18+ only)',await pg.locator('#acU').count()==0)
    await pg.check('#tjOk');await pg.click('#tjGo');await pg.wait_for_timeout(400)
    chk('account step opens',await pg.locator('#acU').count()==1)
    await pg.fill('#acU','ath'+R);await pg.fill('#acP','Lift2026!');await pg.fill('#acP2','Lift2026!');await pg.click('#acGo');await pg.wait_for_timeout(2500)
    tm=await pg.evaluate("JSON.parse(localStorage.getItem('syncope.team')||'null')")
    chk('joined after account',tm and tm['name']=='Blue Hens Football')
    chk('onboarding continues (name step)',await pg.locator('#obName').count()==1)
    chk('no JS errors (onboarding)',not errs);print(errs) if errs else None
    await ctx.close()
    # 3. already-onboarded user with data, link opens join sheet directly
    seed={'v':1,'days':{T:[{'id':'e1','n':'Eggs','a':'3','k':215,'p':19,'c':1,'f':15,'meal':'breakfast','src':'typed','t':1},
        {'id':'e2','n':'Chicken bowl','a':'1','k':650,'p':50,'c':70,'f':15,'meal':'lunch','src':'scan','t':2},
        {'id':'e3','n':'Apple','a':'1','k':95,'p':0,'c':25,'f':0,'meal':'snack','src':'db','t':3},
        {'id':'e4','n':'Coffee','a':'12 oz','k':5,'p':0,'c':0,'f':0,'meal':'drinks','src':'db','t':4},
        {'id':'e5','n':'Workout burn','a':'','k':0,'p':0,'c':0,'f':0,'meal':'snack','src':'whoop','t':5}]},
        'goals':{'p':180,'c':250,'f':70},'calc':{'sex':'m','age':21,'ht':72,'wt':215,'act':'1.725'},'custom':[],'weights':{},
        'profile':{'name':'Jay','onboarded':True},'workouts':[],'templates':[],'tplSeeded':True,
        'health':{T:{'recovery':71,'sleep':7.4,'hrv':88,'rhr':49,'steps':9000,'weight':214.2}},'dev':{'days':{T:{'steps':9000}},'workouts':[]},'prefs':{},'hyd':{'log':{},'bottles':[],'day':{}}}
    ctx,pg,errs=await fresh(b,BASE+'?team='+CODE,seed)
    pushes=[];pg.on('request',lambda r:pushes.append(r.post_data) if '/api/team/push' in r.url else None)
    chk('onboarded user: link opens join sheet',await pg.locator('#tjTeam .tm-team').count()==1)
    await pg.check('#tjAdult');await pg.check('#tjOk');await pg.click('#tjGo');await pg.wait_for_timeout(400)
    await pg.fill('#acU','ath2'+R);await pg.fill('#acP','Lift2026!');await pg.fill('#acP2','Lift2026!');await pg.click('#acGo');await pg.wait_for_timeout(2500)
    chk('onboarded user joined, log kept',await pg.evaluate("!!localStorage.getItem('syncope.team')") and await pg.evaluate("JSON.parse(localStorage.getItem('macros.offline.v1')).days[Object.keys(JSON.parse(localStorage.getItem('macros.offline.v1')).days)[0]].length")==5)
    card=await pg.inner_text('#teamCard')
    chk('team card: meal check-ins 3 of 4 (snack yes, drinks no)','Meal check-ins 3 of 4' in card)
    chk('team card: weigh-in due by 10','Weigh-in due by 10' in card)
    await pg.screenshot(path=SP+'tp_today.png')
    # morning + pre/post weigh-ins from the Team page
    await pg.click('#teamCard .tm-c');await pg.wait_for_timeout(500)
    chk('team page opens with requirements','4 a day' in await pg.inner_text('#pg-team'))
    await pg.click('#tmWeigh');await pg.wait_for_timeout(300)
    await pg.click('[data-wk="am"]');await pg.fill('#qwIn','214.2');await pg.click('#qwOk');await pg.wait_for_timeout(300)
    await pg.click('#tmWeigh');await pg.wait_for_timeout(300)
    chk('weigh sheet defaults to pre-practice after morning',await pg.get_attribute('[data-wk="pre"]','aria-pressed')=='true')
    await pg.fill('#qwIn','216.0');await pg.click('#qwOk');await pg.wait_for_timeout(300)
    await pg.click('#tmWeigh');await pg.wait_for_timeout(300);await pg.click('[data-wk="post"]');await pg.wait_for_timeout(200)
    await pg.fill('#qwIn','212.5');await pg.click('#qwOk');await pg.wait_for_timeout(400)
    sw=await pg.inner_text('.sheet')
    chk('post-practice shows sweat loss 3.5 lb and ~84 oz','3.5 lb' in sw and '~84 oz' in sw)
    await pg.screenshot(path=SP+'tp_sweat.png')
    await pg.click('#wiAdd');await pg.wait_for_timeout(300)
    st=await pg.evaluate("JSON.parse(localStorage.getItem('macros.offline.v1'))")
    chk('weighIns stored separately, weights untouched',st['weights'].get(T)==214.2 and [x['kind'] for x in st['weighIns'][T]]==['am','pre','post'])
    chk('rehydration added to water plan',st['hyd']['day'][T].get('rehydOz')==84)
    pt=await pg.inner_text('#pg-team');chk('team page shows sweat line','Sweat loss' in pt)
    await pg.screenshot(path=SP+'tp_team.png',full_page=True)
    # force a push via app-hide
    await pg.evaluate("Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>'hidden'});document.dispatchEvent(new Event('visibilitychange'))");await pg.wait_for_timeout(1200)
    await pg.evaluate("Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>'visible'})")
    body=json.loads([x for x in pushes if x][-1]) if [x for x in pushes if x] else {}
    s=json.dumps(body).lower()
    bad=[w for w in ['recovery','sleep','hrv','rhr','steps','health','"dev"','whoop','oura','garmin','workout burn'] if w in s]
    chk('push sent with meals and weigh-ins',body.get('days') and body['days'][-1]['checkins']==3 and len(body['days'][-1]['meals'])==4 and len(body['weighIns'].get(T,[]))==3)
    chk('push contains no wearable fields ('+(','.join(bad) or 'none')+')',not bad)
    # backup includes weighIns
    async with pg.expect_download() as dl:
        await pg.evaluate("document.getElementById('exportJson').click()")
    bk=json.loads(open(await (await dl.value).path()).read());chk('full backup includes weighIns',T in bk.get('weighIns',{}))
    # leave
    await pg.click('#tmLeave');await pg.wait_for_timeout(200);await pg.click('#tlYes');await pg.wait_for_timeout(1200)
    me=await pg.evaluate("(async()=>{const c=JSON.parse(localStorage.getItem('macros.sync.v1')||localStorage.getItem('syncope.sync')||'{}');return null})()")
    chk('left team: local cleared, card hidden',not await pg.evaluate("localStorage.getItem('syncope.team')") and await pg.locator('#teamCard').is_hidden())
    chk('no JS errors (player)',not errs);print(errs) if errs else None
    await ctx.close()
    # server: coach roster empty after leave (first athlete still there)
    r=req('/api/team/me',None,CA);chk('server roster after leave = 1 member',len(r.get('roster',[]))==1)
    await b.close()
  print('ALL PASS' if all(c for _,c in res) else 'SOME FAIL')
asyncio.run(main())
