import os
U=os.environ.get('TRAINER_URL','http://localhost:8790/')
import asyncio,json,datetime,sys
from playwright.async_api import async_playwright
SP=os.path.join(os.path.dirname(os.path.abspath(__file__)),'out')+'/'
T=datetime.date.today().isoformat()
st={'v':1,'days':{},'profile':{'onboarded':True,'name':'B'},'calc':{'sex':'m','age':23,'ht':68,'wt':162,'act':'1.55'},'tplSeeded':True}
FAKE="""window.webkitSpeechRecognition=class{constructor(){window.__rec=this}start(){window.__started=(window.__started||0)+1;setTimeout(()=>{const mk=(t,f)=>{const a=[{transcript:t}];a.isFinal=f;return a};this.onresult&&this.onresult({results:[mk('two eggs',false)]});window.__interim=document.activeElement&&document.querySelector(window.__tgt||'#foodIn').value;setTimeout(()=>{this.onresult&&this.onresult({results:[mk(window.__say||'two eggs and a banana',true)]});this.onend&&this.onend()},300)},200)}stop(){}abort(){}};delete window.SpeechRecognition;"""
DENY="""delete window.SpeechRecognition;window.webkitSpeechRecognition=class{start(){setTimeout(()=>{this.onerror&&this.onerror({error:'not-allowed'});this.onend&&this.onend()},50)}stop(){}abort(){}};"""
NONE="""delete window.SpeechRecognition;delete window.webkitSpeechRecognition;Object.defineProperty(window,'webkitSpeechRecognition',{value:undefined,configurable:true});"""
async def run(p,init,name,tab='today'):
  b=await p.chromium.launch();ctx=await b.new_context(**p.devices['iPhone 14 Pro']);await ctx.add_init_script(init);pg=await ctx.new_page();errs=[];pg.on('pageerror',lambda x:errs.append(str(x)))
  await pg.goto(''+U+'index.html');await pg.evaluate("s=>{localStorage.clear();localStorage.setItem('macros.offline.v1',s);localStorage.setItem('syncope.tour2','1');localStorage.setItem('syncope.dayplan',new Date().toISOString().slice(0,10))}",json.dumps(st));await pg.reload();await pg.wait_for_timeout(1200)
  if tab=='today':
    await pg.tap('#micBtn');await pg.wait_for_timeout(250)
    on=await pg.evaluate("[document.querySelector('#micBtn').className,document.querySelector('#status').textContent,document.querySelector('#foodIn').value]");print(name,'during',on)
    if name=='fake':await pg.screenshot(path=SP+'voice_listen.png',clip={'x':0,'y':0,'width':393,'height':700})
    await pg.wait_for_timeout(1500)
    r=await pg.evaluate(f"[document.querySelector('#micBtn').className,document.querySelector('#status').textContent,document.querySelector('#foodIn').value,document.activeElement.id,JSON.stringify((JSON.parse(localStorage.getItem('macros.offline.v1')).days['{T}']||[]).map(e=>e.n+'|'+e.a))]")
    print(name,'after',r)
  else:
    await pg.tap('#tabsBottom [data-v="foods"]');await pg.wait_for_timeout(600);await pg.evaluate("window.__tgt='#fSearch';window.__say='banana'")
    await pg.tap('#fdMicSlot .fd-mic');await pg.wait_for_timeout(1500)
    print(name,'foods',await pg.evaluate("[document.querySelector('#fSearch').value,document.querySelector('#fSearch').placeholder,document.activeElement.id]"))
    await pg.screenshot(path=SP+'voice_foods.png',clip={'x':0,'y':0,'width':393,'height':400})
  print(name,'errs',errs);await b.close()
async def main():
  async with async_playwright() as p:
    await run(p,FAKE,'fake');await run(p,NONE,'none');await run(p,DENY,'deny');await run(p,FAKE,'fake','foods');await run(p,NONE,'none','foods')
asyncio.run(main())
