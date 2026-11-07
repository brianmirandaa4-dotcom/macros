import w from '/home/claude/macros/sync-server/worker.js';
import http from 'http';
const store=new Map();
const db={prepare(sql){return {bind(...a){return {async first(){if(/SELECT v/.test(sql)){const r=store.get(a[0]);return r?{v:r}:null}return null},async run(){if(/INSERT/.test(sql))store.set(a[0],a[1]);if(/DELETE/.test(sql))store.delete(a[0]);return {}},async all(){return {results:[]}}}},async run(){return {}}}},exec:async()=>{},batch:async()=>[]};
const env={DB:db,MACROS_KV:{get:async()=>null,put:async()=>{},delete:async()=>{},list:async()=>({keys:[]})},APP_URL:'http://localhost:8790/macros/',ALLOWED_ORIGINS:'*'};
http.createServer(async(q,r)=>{let body=[];for await(const c of q)body.push(c);body=Buffer.concat(body);
  const req=new Request('https://macros-sync.brianmirandaa4.workers.dev'+q.url,{method:q.method,headers:q.headers,body:['GET','HEAD'].includes(q.method)?undefined:body});
  const res=await w.fetch(req,env,{waitUntil(){}});const h={};res.headers.forEach((v,k)=>h[k]=v);h['access-control-allow-origin']='*';h['access-control-allow-headers']='*';r.writeHead(res.status,h);r.end(Buffer.from(await res.arrayBuffer()))}).listen(8791,()=>console.log('mock up'));
