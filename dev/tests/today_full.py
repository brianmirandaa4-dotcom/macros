import os
U=os.environ.get('TRAINER_URL','http://localhost:8790/')
import asyncio,json,datetime,sys
from playwright.async_api import async_playwright
SP=os.path.join(os.path.dirname(os.path.abspath(__file__)),'out')+'/'
T=datetime.date.today();d=lambda i:(T-datetime.timedelta(days=i)).isoformat();t=d(0)
E1=lambda n,a,k,p,c,f,m:{'id':n+a,'n':n,'a':a,'k':k,'p':p,'c':c,'f':f,'meal':m,'t':1,'src':'db'}
days={t:[E1('Eggs','3 eggs',215,19,1,15,'breakfast'),E1('Oats','1 cup',300,10,54,5,'breakfast'),E1('Chicken rice bowl','1 bowl',680,52,78,16,'lunch')]}
dev={'workouts':[{'src':'WHOOP','id':'w1','date':t,'name':'Weightlifting','min':67,'kcal':420,'strain':11.2}],'skip':[],'days':{t:{'w':{'recovery':54,'sleepH':6.2,'hrv':61,'rhr':56,'strain':11.2,'steps':2920}}}}
st={'v':1,'days':days,'profile':{'onboarded':True,'name':'Brian'},'calc':{'sex':'m','age':23,'ht':68,'wt':162,'act':'1.55'},'weights':{t:162},'templates':[{'id':'t1','name':'Push','ex':['Bench Press']}],'tplSeeded':True,'dev':dev,'hyd':{'log':{t:[{'id':'h','t':1,'oz':44,'kind':'water'}]},'day':{t:{'types':['lift']}}}}
async def main():
  async with async_playwright() as p:
    b=await p.chromium.launch();ctx=await b.new_context(**p.devices['iPhone 14 Pro']);pg=await ctx.new_page();errs=[];pg.on('pageerror',lambda x:errs.append(str(x)))
    await pg.goto(''+U+'index.html');await pg.evaluate("s=>{localStorage.clear();localStorage.setItem('macros.offline.v1',s);localStorage.setItem('syncope.tour2','1');localStorage.setItem('syncope.dayplan',new Date().toISOString().slice(0,10))}",json.dumps(st));await pg.reload();await pg.wait_for_timeout(1500)
    view=sys.argv[1] if len(sys.argv)>1 else 'today'
    if view!='today':await pg.tap(f'#tabsBottom [data-v="{view}"]');await pg.wait_for_timeout(700)
    h=await pg.evaluate("document.documentElement.scrollHeight");print('height',h)
    await pg.screenshot(path=SP+f'full_{view}.png',full_page=True);print('errs',errs);await b.close()
asyncio.run(main())
