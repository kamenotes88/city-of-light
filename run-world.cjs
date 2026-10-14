'use strict';
// Foreground loopback runner. No installation, startup service or account changes.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const {randomBytes,timingSafeEqual}=require('node:crypto'),{spawn}=require('node:child_process');
const core=require('./native-bridge-core.cjs'),{createCodex}=require('./native-bridge-codex.cjs');
const {createLiveHistory}=require('./live-history-service.cjs');
const HELP='City of Light local runner\n\nnode run-world.cjs --world <absolute.html> --world-id <id> --workspace <absolute-folder> [--codex <absolute-executable>] [--history-config <absolute-config.json>] [--port 8899] [--open] [--read-only]\n\nUses an existing Codex login/runtime. No provider inference starts until an explicit game action. Only game-created chats in this process can run. Existing Desktop chats remain navigation-only. The optional exact history config watches selected files without model calls; its output must be dedicated to this runner. Ctrl+C stops the runner; interrupted execution is never automatically repeated.\n';
function args(argv){
  const result={port:8899};const names=new Map([['--world','world'],['--world-id','worldId'],['--workspace','workspace'],['--codex','executable'],['--history-config','historyConfig'],['--port','port']]);
  for(let i=0;i<argv.length;i++){
    const key=argv[i];if(key==='--help'||key==='-h')return {help:true};
    if(['--read-only','--read-only-work','--open'].includes(key)){const k={'--read-only':'readOnly','--read-only-work':'readOnlyWork','--open':'open'}[key];if(result[k])core.fail('DUPLICATE_OPTION');result[k]=true;continue;}
    if(!names.has(key)||!argv[i+1]||argv[i+1].startsWith('--'))core.fail('UNKNOWN_OR_MISSING_OPTION');const name=names.get(key);if(name!=='port'&&Object.hasOwn(result,name)||name==='port'&&result.portSeen)core.fail('DUPLICATE_OPTION');result[name]=argv[++i];if(name==='port')result.portSeen=true;
  }
  if(!result.world||!result.worldId||!result.workspace)core.fail('WORLD_ID_WORKSPACE_REQUIRED');
  result.port=Number(result.port);if(!Number.isSafeInteger(result.port)||result.port<1024||result.port>65535)core.fail('INVALID_PORT');delete result.portSeen;return result;
}
function lock(file){
  core.noLinks(file);let prior;
  if(fs.existsSync(file)){
    prior=core.parse(core.readFile(file,1024),1024);
    if(!Number.isSafeInteger(prior.pid)||prior.pid<1||typeof prior.nonce!=='string')core.fail('INVALID_RUNTIME_LOCK',409);
    let running=true;try{process.kill(prior.pid,0);}catch(error){if(error.code==='ESRCH')running=false;}
    if(running)core.fail('WORLD_RUNTIME_ALREADY_RUNNING',409);
    const checked=fs.readFileSync(file,'utf8');if(checked!==JSON.stringify(prior)+'\n')core.fail('RUNTIME_LOCK_CHANGED',409);core.noLinks(file);fs.unlinkSync(file);
  }
  const value={pid:process.pid,nonce:randomBytes(16).toString('hex')},raw=JSON.stringify(value)+'\n';let fd=fs.openSync(file,'wx',0o600);fs.writeFileSync(fd,raw);fs.fsyncSync(fd);fs.closeSync(fd);
  return ()=>{try{core.noLinks(file);if(fs.readFileSync(file,'utf8')===raw)fs.unlinkSync(file);}catch{}};
}
function openBrowser(url){
  const executable=process.platform==='win32'?'C:\\Windows\\System32\\rundll32.exe':process.platform==='darwin'?'/usr/bin/open':'/usr/bin/xdg-open';
  const params=process.platform==='win32'?['url.dll,FileProtocolHandler',url]:[url];
  if(!fs.existsSync(executable))return false;
  const child=spawn(executable,params,{windowsHide:true,shell:false,stdio:'ignore'});child.on('error',()=>{});child.unref();return true;
}
async function startServer(options){
  const world=core.localPath(options.world,false),workspace=core.localPath(options.workspace,true);
  const token=randomBytes(32).toString('hex'),host='127.0.0.1:'+options.port,origin='http://'+host;
  const releaseLock=options.noLockForTest?()=>{}:lock(path.join(path.dirname(world),'.city-light-native-'+core.hash(options.worldId).slice(0,16)+'.lock'));
  let adapter=options.adapter,providerError;
  if(!adapter&&!options.readOnly)try{adapter=createCodex({executable:options.executable,workspace,readOnlyWork:options.readOnlyWork});}catch(error){providerError=error.code||'CODEX_UNAVAILABLE';}
  let bridge,history;try{bridge=core.createBridge({...options,world,workspace,adapter,readOnly:options.readOnly||!adapter});if(options.historyConfig)history=createLiveHistory({configPath:options.historyConfig,worldId:options.worldId});}catch(error){bridge?.close();releaseLock();throw error;}
  const config={baseUrl:'/api/bridge',token,workspace,worldId:options.worldId,managedOnly:true};
  const historyConfig=history?{version:1,baseUrl:'/api/history',worldId:options.worldId,token}:null;
  const security={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Frame-Options':'DENY','Content-Security-Policy':"frame-ancestors 'none'"};
  const json=(res,status,value)=>{const body=JSON.stringify(value);res.writeHead(status,{...security,'Content-Type':'application/json; charset=utf-8','Content-Length':Buffer.byteLength(body)});res.end(body);};
  const authenticate=req=>{
    if(req.headers.host!==host||req.socket.remoteAddress!=='127.0.0.1')core.fail('INVALID_LOCAL_HOST',403);
    const header=req.headers.authorization;if(typeof header!=='string'||!/^Bearer [a-f0-9]{64}$/.test(header)||!timingSafeEqual(Buffer.from(header.slice(7)),Buffer.from(token)))core.fail('AUTH_REQUIRED',401);
    if(req.headers.origin!==undefined){if(req.headers.origin!==origin)core.fail('ORIGIN_REFUSED',403);}
    else if(req.method!=='GET'||req.headers['sec-fetch-site']!=='same-origin')core.fail('ORIGIN_REQUIRED',403);
  };
  const server=http.createServer(async(req,res)=>{
    try{
      if(req.headers.host!==host||req.socket.remoteAddress!=='127.0.0.1')core.fail('INVALID_LOCAL_HOST',403);
      const url=new URL(req.url,origin);if(url.origin!==origin||url.username||url.password||url.hash)core.fail('INVALID_URL');
      if(url.pathname.startsWith('/api/history/')){
        authenticate(req);if(req.method!=='GET')core.fail('READ_ROUTE_REQUIRED',405);if(!history)core.fail('HISTORY_NOT_CONFIGURED',503);
        if(url.pathname==='/api/history/feed'){
          const body=history.feed(url.searchParams);res.writeHead(200,{...security,'Content-Type':'application/json; charset=utf-8','Content-Length':Buffer.byteLength(body)});res.end(body);return;
        }
        if(url.pathname==='/api/history/events'){if(url.search)core.fail('INVALID_HISTORY_QUERY');history.subscribe(req,res,security);return;}
        if(url.pathname==='/api/history/snapshot'){if(url.search)core.fail('INVALID_HISTORY_QUERY');json(res,200,history.snapshot());return;}
        if(url.pathname==='/api/history/status'){
          if(url.search&&url.search!=='?refresh=1')core.fail('INVALID_HISTORY_QUERY');json(res,200,url.search?history.refresh():history.snapshot());return;
        }
        core.fail('NOT_FOUND',404);
      }
      if(url.pathname==='/api/bridge/info'){
        authenticate(req);if(req.method!=='GET'||url.search)core.fail('READ_ROUTE_REQUIRED',405);
        json(res,200,{...bridge.info(),...(providerError?{reason:providerError}:{})});return;
      }
      if(url.pathname==='/api/bridge/status'){
        authenticate(req);if(req.method!=='GET')core.fail('READ_ROUTE_REQUIRED',405);
        const entries=[...url.searchParams.entries()];if(entries.some(([k])=>!['projectId','commandId','kind'].includes(k))||new Set(entries.map(([k])=>k)).size!==entries.length||url.searchParams.has('kind')&&!['work','plan'].includes(url.searchParams.get('kind')))core.fail('INVALID_STATUS_QUERY');
        json(res,200,bridge.status(url.searchParams.get('projectId'),url.searchParams.get('commandId')||undefined,url.searchParams.get('kind')||'work'));return;
      }
      if(['/api/bridge/start','/api/bridge/plan'].includes(url.pathname)){
        authenticate(req);if(req.method!=='POST'||url.search)core.fail('POST_ROUTE_REQUIRED',405);
        if(!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers['content-type']||''))core.fail('JSON_CONTENT_TYPE_REQUIRED',415);
        const length=Number(req.headers['content-length']);if(Number.isFinite(length)&&length>core.MAX_REQUEST)core.fail('JSON_SIZE_LIMIT',413);
        req.setTimeout(5000,()=>req.destroy());const chunks=[];let size=0;
        for await(const bytes of req){size+=bytes.length;if(size>core.MAX_REQUEST)core.fail('JSON_SIZE_LIMIT',413);chunks.push(bytes);}
        const input=core.parse(Buffer.concat(chunks));if(url.pathname==='/api/bridge/plan'&&typeof bridge.planStart!=='function')core.fail('PLANNING_NOT_AVAILABLE',503);
        const result=url.pathname==='/api/bridge/plan'?bridge.planStart(input):bridge.start(input);json(res,result.duplicate?200:202,result);return;
      }
      if(!['GET','HEAD'].includes(req.method)||!['/','/City-of-Light.html'].includes(url.pathname)||url.search)core.fail('NOT_FOUND',404);
      if(req.headers.origin!==undefined&&req.headers.origin!==origin)core.fail('ORIGIN_REFUSED',403);
      const bytes=core.readFile(world,50*1024*1024),html=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
      if(!/<head(?:\s[^>]*)?>/i.test(html))core.fail('HTML_HEAD_REQUIRED');
      const script='<script>window.TownNativeBridgeConfig='+JSON.stringify(config).replace(/</g,'\\u003c')+';'+(historyConfig?'window.TownHistoryLiveConfig='+JSON.stringify(historyConfig).replace(/</g,'\\u003c')+';':'')+'</script>';
      const body=html.replace(/<head(?:\s[^>]*)?>/i,match=>match+script);res.writeHead(200,{...security,'Content-Type':'text/html; charset=utf-8','Content-Length':Buffer.byteLength(body)});res.end(req.method==='HEAD'?undefined:body);
    }catch(error){if(!res.headersSent)json(res,error.status||500,{error:{code:error.code||'LOCAL_RUNTIME_ERROR',message:error.code||'The local runtime refused the request.'}});else res.destroy();}
  });
  server.requestTimeout=10000;server.headersTimeout=10000;
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(options.port,'127.0.0.1',resolve);}).catch(async error=>{bridge.close();await history?.close();releaseLock();throw error;});
  let stopped=false;const close=async()=>{if(stopped)return;stopped=true;bridge.close();await history?.close();await new Promise(resolve=>server.close(resolve));releaseLock();};
  return {server,bridge,history,close,url:origin+'/City-of-Light.html',origin,token};
}
async function main(argv){
  const options=args(argv);if(options.help){console.log(HELP);return;}
  const runtime=await startServer(options);console.log('City of Light: '+runtime.url);
  if(!runtime.bridge.info().canStart)console.log('Native execution is unavailable or read-only. The local game and manual workflow remain available.');
  if(options.open)openBrowser(runtime.url);
  const close=()=>runtime.close().then(()=>process.exit(0));process.once('SIGINT',close);process.once('SIGTERM',close);
}
module.exports={args,startServer,openBrowser,HELP};
if(require.main===module)main(process.argv.slice(2)).catch(error=>{console.error('City of Light runner: '+(error.code||'START_FAILED'));process.exitCode=1;});
