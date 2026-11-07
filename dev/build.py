import os
R=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
s=open(os.path.join(R,'dev','Trainer.html')).read()
head_add='''<meta name="description" content="Track food, water and training in one place. Fill your heart and win the day.">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Trainer">
<meta property="og:title" content="Trainer">
<meta property="og:description" content="Track food, water and training in one place. Fill your heart and win the day.">
<meta property="og:url" content="https://brianmirandaa4-dotcom.github.io/macros/">
<meta property="og:image" content="https://brianmirandaa4-dotcom.github.io/macros/heart-512.png">
<meta property="og:image:width" content="512">
<meta property="og:image:height" content="512">
<meta property="og:image:alt" content="Trainer heart logo">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="Trainer">
<meta name="twitter:image" content="https://brianmirandaa4-dotcom.github.io/macros/heart-512.png">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="Trainer">
<meta name="format-detection" content="telephone=no">
<link rel="manifest" href="manifest.webmanifest">
<link rel="apple-touch-icon" href="heart-180.png">
<link rel="icon" type="image/png" href="heart-192.png">
'''
a='<title>Trainer</title>\n'; assert a in s; s=s.replace(a,a+head_add,1)
a='html,body{background:var(--bg);margin:0}'; assert a in s
s=s.replace(a,a+'\nhtml{-webkit-text-size-adjust:100%;overscroll-behavior-y:none}\nbody{-webkit-tap-highlight-color:transparent}\nbutton,.tab,.chip{-webkit-user-select:none;user-select:none;touch-action:manipulation}',1)
a='/* ---------- start ---------- */'; assert a in s
s=s.replace(a,a+"\nif('serviceWorker' in navigator&&/^https?:$/.test(location.protocol)){window.addEventListener('load',()=>{navigator.serviceWorker.register('sw.js').then(reg=>{document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')reg.update().catch(()=>{})});setInterval(()=>reg.update().catch(()=>{}),30*60000)}).catch(()=>{});let hadCtl=!!navigator.serviceWorker.controller,reloaded=false;navigator.serviceWorker.addEventListener('controllerchange',()=>{if(!hadCtl){hadCtl=true;return}if(reloaded)return;reloaded=true;try{sessionStorage.setItem('syncope.updated','1')}catch(e){}location.reload()})})}",1)
s=s.replace("/* ---------- start ---------- */","/* ---------- start ---------- */\ntry{if(sessionStorage.getItem('syncope.updated')){sessionStorage.removeItem('syncope.updated');setTimeout(()=>toast('Trainer updated to the latest version'),1200)}}catch(e){}",1)
open(os.path.join(R,'index.html'),'w').write(s)
print('built')
