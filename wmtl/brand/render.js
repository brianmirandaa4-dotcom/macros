const {chromium}=require('playwright');const fs=require('fs');
(async()=>{const b=await chromium.launch();const p=await b.newPage();
const jobs=[['icon.svg',180,'../icons/icon-180.png'],['icon.svg',192,'../icons/icon-192.png'],['icon.svg',512,'../icons/icon-512.png'],['icon-mask.svg',512,'../icons/maskable-512.png'],['seal.svg',64,'../icons/favicon-64.png'],['icon.svg',1024,'icon-1024.png'],['lockup.svg',880,'lockup.png'],['seal.svg',400,'seal.png']];
for(const [f,w,o] of jobs){const svg=fs.readFileSync(f,'utf8');const h=f==='lockup.svg'?w*100/220:w;
await p.setViewportSize({width:w,height:Math.round(h)});await p.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:${w}px;height:${h}px}</style>${svg}`);
await p.screenshot({path:o,omitBackground:true});}
await b.close();})();
