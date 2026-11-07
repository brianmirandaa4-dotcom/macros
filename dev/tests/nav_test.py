import os
U=os.environ.get('TRAINER_URL','http://localhost:8790/')
import asyncio,json
from playwright.async_api import async_playwright
st={'v':1,'days':{},'profile':{'onboarded':True,'name':'Brian'},'calc':{'sex':'m','age':23,'ht':68,'wt':162,'act':'1.55'},'templates':[],'tplSeeded':True}
SP=os.path.join(os.path.dirname(os.path.abspath(__file__)),'out')+'/'
async def main():
  async with async_playwright() as p:
    b=await p.chromium.launch();ctx=await b.new_context(**p.devices['iPhone 14 Pro']);pg=await ctx.new_page();errs=[];pg.on('pageerror',lambda x:errs.append(str(x)))
    await pg.goto(''+U+'index.html');await pg.evaluate("s=>{localStorage.clear();localStorage.setItem('macros.offline.v1',s);localStorage.setItem('syncope.tour2','1');localStorage.setItem('syncope.dayplan',new Date().toISOString().slice(0,10))}",json.dumps(st));await pg.reload();await pg.wait_for_timeout(1200)
    print('tabs',(await pg.locator('#tabsBottom').inner_text()).replace('\n',' '))
    await pg.tap('#tabsBottom [data-v="progress"]');await pg.wait_for_timeout(400)
    print('progress seg',(await pg.locator('#v-week .seg2').first.inner_text()).replace('\n',' '))
    await pg.tap('#v-week [data-goto="plan"]');await pg.wait_for_timeout(500)
    print('plan visible',await pg.is_visible('#v-plan'),'progress tab current',await pg.get_attribute('#tabsBottom [data-v="progress"]','aria-current'))
    await pg.screenshot(path=SP+'nav_plan.png')
    await pg.tap('#v-plan [data-goto="month"]');await pg.wait_for_timeout(400);print('month visible',await pg.is_visible('#v-month'))
    await pg.tap('#tabsBottom [data-v="today"]');await pg.wait_for_timeout(300);await pg.tap('[data-goto="plan"]');await pg.wait_for_timeout(400);print('hero pill -> plan',await pg.is_visible('#v-plan'))
    print('errs',errs);await b.close()
asyncio.run(main())
