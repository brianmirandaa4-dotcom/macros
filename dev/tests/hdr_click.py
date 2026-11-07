import os
U=os.environ.get('TRAINER_URL','http://localhost:8790/')
import asyncio,json,datetime
from playwright.async_api import async_playwright
t=datetime.date.today().isoformat()
st={'v':1,'days':{t:[{'id':'a','n':'Eggs','a':'3','k':215,'p':19,'c':1,'f':15,'meal':'breakfast'}]},'profile':{'onboarded':True,'name':'Brian'},'calc':{'sex':'m','age':23,'ht':68,'wt':162,'act':'1.55'},'templates':[],'tplSeeded':True}
async def main():
  async with async_playwright() as p:
    b=await p.chromium.launch();ctx=await b.new_context(**p.devices['iPhone 14 Pro']);pg=await ctx.new_page();errs=[];pg.on('pageerror',lambda x:errs.append(str(x)))
    async def fresh():
      await pg.goto(''+U+'index.html');await pg.evaluate("s=>{localStorage.clear();localStorage.setItem('macros.offline.v1',s);localStorage.setItem('syncope.tour2','1');localStorage.setItem('syncope.dayplan',new Date().toISOString().slice(0,10))}",json.dumps(st));await pg.reload();await pg.wait_for_timeout(1200)
    await fresh();await pg.tap('#profBtn');await pg.wait_for_timeout(600);print('profile ->',await pg.locator('#pgTitle').inner_text(),await pg.is_visible('#pg-me'))
    await fresh();await pg.tap('#helpBtn');await pg.wait_for_timeout(600);print('help -> coach',await pg.locator('#pgTitle').inner_text(),await pg.is_visible('#pg-coach'),await pg.get_attribute('#helpBtn','aria-label'))
    await fresh();await pg.tap('#findBtn');await pg.wait_for_timeout(600);print('search ->',await pg.locator('#sheetRoot .sheet input').count())
    await fresh();await pg.tap('#hpBtn');await pg.wait_for_timeout(600);print('heart ->',await pg.locator('.hp-rows').count())
    print('errs',errs);await b.close()
asyncio.run(main())
