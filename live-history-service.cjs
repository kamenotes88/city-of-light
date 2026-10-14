'use strict';
// Local documentary synchronization. Only the exact selected config is read;
// one worker retains the incremental reader cache and owns the output writer.
const fs=require('node:fs'),path=require('node:path');
const {Worker,isMainThread,parentPort,workerData}=require('node:worker_threads');
const reader=require('./history-source.cjs');
// Aggregate limits are imported from the reader; per-feed responses stay 2 MiB.
const FORMAT='city-light-live-manifest',MAX_CLIENTS=8,MAX_FEED_BYTES=2*1024*1024,MAX_CLIENT_BUFFER=128*1024,CLIENT_DRAIN_MS=30000;
const fingerprint=value=>reader.hash(JSON.stringify(reader.canonical(value)));
const errorCode=error=>/^[A-Z][A-Z0-9_]{0,100}$/.test(error?.code||'')?error.code:/^[A-Z][A-Z0-9_]{0,100}(?::|$)/.test(error?.message||'')?error.message.split(':')[0]:'HISTORY_READ_FAILED';
const fail=(code,status=400)=>{const error=Error(code);error.code=code;error.status=status;throw error;};
const utc=()=>new Date().toISOString();
function sameCursor(a,b){return a.id===b.id&&a.revision===b.revision&&a.fingerprint===b.fingerprint;}
function generation(worldId,sources){return fingerprint({version:1,worldId,sources:sources.map(({id,revision,fingerprint:hash})=>({id,revision,fingerprint:hash}))});}

function workerMain(options){
  const loaded=reader.loadConfig(options.configPath);
  if(loaded.configDigest!==options.configDigest)fail('HISTORY_CONFIG_CHANGED_RESTART_REQUIRED');
  const config=loaded.config,cache=new Map(),watchers=new Map(),selected=new Map();
  for(const file of [loaded.configPath,...config.sources.map(source=>source.path),config.output]){
    const parent=path.dirname(file),name=path.basename(file),key=process.platform==='win32'?name.toLowerCase():name;
    if(!selected.has(parent))selected.set(parent,new Set());selected.get(parent).add(key);
  }
  let stopped=false,busy=false,queued=false,debounce,prior=new Map(),outputDigest=null,watchFailure=false,refreshId=0;
  const post=value=>parentPort.postMessage(value);
  function publishOutput(output,status,error,checkedAt,diagnostics=[]){
    if(!output.read)fail('HISTORY_OUTPUT_MISSING');
    const next=new Map(),sources=[],changed=[];
    for(const feed of output.container.feeds){
      const bytes=JSON.stringify(feed),hash=fingerprint(feed),size=Buffer.byteLength(bytes);
      if(size>MAX_FEED_BYTES)fail('HISTORY_FEED_TOO_LARGE');
      const metadata={id:feed.source.id,revision:feed.source.revision,fingerprint:hash,records:feed.records.length,bytes:size,updatedAt:feed.source.updatedAt};
      const old=prior.get(metadata.id);
      if(old&&(metadata.revision<old.revision||metadata.revision===old.revision&&metadata.fingerprint!==old.fingerprint||Date.parse(metadata.updatedAt)<Date.parse(old.updatedAt)))fail('HISTORY_LINEAGE_CONFLICT');
      sources.push(metadata);next.set(metadata.id,metadata);
      if(!old||!sameCursor(old,metadata))changed.push({id:metadata.id,bytes});
    }
    if([...prior.keys()].some(id=>!next.has(id)))fail('HISTORY_SOURCE_DISAPPEARED');
    sources.sort((a,b)=>a.id.localeCompare(b.id));prior=next;outputDigest=reader.hash(output.read.bytes);
    post({type:'snapshot',sources,changed,checkedAt,status,error,diagnostics,refreshId});
  }
  function schedule(){if(stopped)return;if(busy){queued=true;return;}if(!debounce)debounce=setTimeout(()=>{debounce=null;reconcile();},150);}
  function repairWatchers(){
    let failed=false;
    for(const [parent,names] of selected){
      if(watchers.has(parent))continue;
      try{
        reader.noLinks(parent);
        const watcher=fs.watch(parent,(_event,name)=>{
          if(name===null||name===undefined){schedule();return;}
          const value=String(name),key=process.platform==='win32'?value.toLowerCase():value;
          if(names.has(key))schedule();
        });
        watcher.on('error',()=>{watcher.close();watchers.delete(parent);watchFailure=true;post({type:'failure',code:'HISTORY_WATCH_FAILED',checkedAt:utc()});});
        watchers.set(parent,watcher);
      }catch{failed=true;}
    }
    watchFailure=failed||watchers.size!==selected.size;
  }
  function reconcile(){
    if(stopped)return;if(busy){queued=true;return;}busy=true;
    post({type:'reading'});
    try{
      if(reader.hash(reader.readBounded(loaded.configPath,reader.MAX_CONFIG).bytes)!==loaded.configDigest)fail('HISTORY_CONFIG_CHANGED_RESTART_REQUIRED');
      if(outputDigest!==null){
        const bytes=reader.readBounded(config.output,reader.MAX_CONTAINER).bytes;
        if(reader.hash(bytes)!==outputDigest)fail('OUTPUT_CHANGED_REFUSED');
      }
      const result=reader.runOnce(config,cache),output=reader.previousOutput(config);
      publishOutput(output,watchFailure?'stale':'ready',watchFailure?{code:'HISTORY_WATCH_FAILED'}:null,utc(),result.diagnostics.map(({sourceId,mode,bytesRead})=>({sourceId,mode,bytesRead})));
    }catch(error){post({type:'failure',code:errorCode(error),checkedAt:utc()});}
    finally{busy=false;if(queued){queued=false;schedule();}}
  }
  // Restart can serve its validated last-known generation even if a selected
  // transcript is temporarily missing, malformed or needs an explicit migration.
  if(fs.existsSync(config.output))try{publishOutput(reader.previousOutput(config),'warming',null,null);}catch(error){post({type:'failure',code:errorCode(error),checkedAt:utc()});}
  repairWatchers();reconcile();
  const fallback=setInterval(()=>{repairWatchers();schedule();},config.intervalSeconds*1000);
  parentPort.on('message',message=>{
    if(message?.type==='refresh'&&Number.isSafeInteger(message.refreshId)&&message.refreshId>refreshId){refreshId=message.refreshId;schedule();}
    else if(message?.type==='close'){stopped=true;clearInterval(fallback);clearTimeout(debounce);for(const watcher of watchers.values())watcher.close();watchers.clear();parentPort.close();}
  });
}

function createLiveHistory(options){
  if(!isMainThread)fail('MAIN_THREAD_REQUIRED');
  if(typeof options?.worldId!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,109}$/.test(options.worldId))fail('INVALID_HISTORY_WORLD');
  const loaded=reader.loadConfig(options.configPath),release=reader.claimWriter(loaded.config,loaded.configPath);
  const worldId=options.worldId,clients=new Map(),feeds=new Map();let closed=false,timeout,active=false,lastRefresh=0,requestedRefresh=0,refreshTimer,fatalError=null;
  let current={format:FORMAT,version:1,worldId,generation:generation(worldId,[]),status:'warming',sources:[],checkedAt:null,error:null};
  let diagnostics=[];
  const worker=new Worker(__filename,{workerData:{kind:'city-light-history-worker',configPath:loaded.configPath,configDigest:loaded.configDigest}});
  function removeClient(client,destroy=false){
    const state=clients.get(client);if(!state)return;clients.delete(client);clearTimeout(state.timer);if(state.drain)client.removeListener('drain',state.drain);state.pending=null;
    if(destroy)client.destroy();
  }
  function writeClient(client,frame){
    const state=clients.get(client);if(!state)return;
    if(client.destroyed||client.writableLength>MAX_CLIENT_BUFFER||Buffer.byteLength(frame)>MAX_CLIENT_BUFFER){removeClient(client,true);return;}
    // A false write is ordinary backpressure, not a failed connection. Keep at
    // most one queued snapshot; newer generations replace that pending frame.
    if(state.drain){state.pending=frame;return;}
    if(client.write(frame))return;
    state.drain=()=>{clearTimeout(state.timer);state.timer=null;state.drain=null;const pending=state.pending;state.pending=null;if(pending)writeClient(client,pending);};
    client.once('drain',state.drain);state.timer=setTimeout(()=>removeClient(client,true),CLIENT_DRAIN_MS);
  }
  const snapshotFrame=()=> 'event: snapshot\nid: '+current.generation+'\ndata: '+JSON.stringify(current)+'\n\n';
  const notify=()=>{const frame=snapshotFrame();for(const client of [...clients.keys()])writeClient(client,frame);};
  const stale=code=>{if(closed)return;clearTimeout(timeout);active=false;current={...current,status:'stale',checkedAt:utc(),error:{code}};notify();};
  const fatal=code=>{fatalError=fatalError||code;clearTimeout(refreshTimer);refreshTimer=null;stale(fatalError);};
  worker.on('message',message=>{
    if(closed||fatalError)return;
    if(message?.type==='reading'){
      active=true;clearTimeout(timeout);timeout=setTimeout(()=>{fatal('HISTORY_PASS_TIME_LIMIT');worker.terminate().catch(()=>{});},60000);return;
    }
    clearTimeout(timeout);active=false;
    if(message?.type==='failure'){stale(message.code);return;}
    if(message?.type!=='snapshot')return;
    try{
      if(!Number.isSafeInteger(message.refreshId)||message.refreshId<0||message.refreshId>requestedRefresh)fail('HISTORY_REFRESH_SEQUENCE_INVALID');
      if(!Array.isArray(message.sources)||message.sources.length>reader.MAX_FEEDS||message.sources.reduce((sum,source)=>sum+source.records,0)>reader.MAX_RECORDS||message.sources.reduce((sum,source)=>sum+source.bytes,0)>reader.MAX_CONTAINER)fail('HISTORY_AGGREGATE_LIMIT');
      for(const feed of message.changed)feeds.set(feed.id,feed.bytes);
      if(message.sources.some(source=>!feeds.has(source.id)))fail('HISTORY_SNAPSHOT_INCOMPLETE');
      const awaitingRefresh=message.status==='ready'&&message.refreshId<requestedRefresh;
      current={format:FORMAT,version:1,worldId,generation:generation(worldId,message.sources),status:awaitingRefresh?'warming':message.status,sources:message.sources,checkedAt:awaitingRefresh?current.checkedAt:message.checkedAt,error:message.error};
      diagnostics=message.diagnostics;notify();
    }catch(error){stale(errorCode(error));}
  });
  worker.on('error',()=>fatal('HISTORY_WORKER_FAILED'));
  worker.on('exit',()=>{if(!closed)fatal('HISTORY_WORKER_STOPPED');});
  const heartbeat=setInterval(()=>{for(const [client,state] of [...clients]){if(client.destroyed||client.writableLength>MAX_CLIENT_BUFFER){removeClient(client,true);continue;}if(!state.drain)writeClient(client,': keepalive\n\n');}},15000);
  const snapshot=()=>JSON.parse(JSON.stringify(current));
  const refresh=()=>{
    if(closed)fail('HISTORY_SERVICE_CLOSED',503);if(fatalError)return snapshot();
    requestedRefresh++;current={...current,status:'warming',error:null};notify();
    const send=()=>{refreshTimer=null;lastRefresh=Date.now();worker.postMessage({type:'refresh',refreshId:requestedRefresh});};
    if(!refreshTimer){const delay=Math.max(0,250-(Date.now()-lastRefresh));if(delay)refreshTimer=setTimeout(send,delay);else send();}
    return snapshot();
  };
  function subscribe(req,res,headers){
    if(closed)fail('HISTORY_SERVICE_CLOSED',503);if(clients.size>=MAX_CLIENTS)fail('HISTORY_CLIENT_LIMIT',429);
    res.writeHead(200,{...headers,'Content-Type':'text/event-stream; charset=utf-8','Connection':'keep-alive','X-Accel-Buffering':'no'});
    res.flushHeaders();clients.set(res,{pending:null,drain:null,timer:null});
    req.on('close',()=>removeClient(res));res.on('close',()=>removeClient(res));res.on('error',()=>removeClient(res,true));writeClient(res,snapshotFrame());
  }
  function feed(query){
    const entries=[...query.entries()],names=['id','revision','fingerprint','generation'];
    if(entries.length!==names.length||new Set(entries.map(([key])=>key)).size!==names.length||entries.some(([key])=>!names.includes(key)))fail('INVALID_HISTORY_FEED_QUERY');
    const source=current.sources.find(source=>source.id===query.get('id'));
    if(!source)fail('HISTORY_SOURCE_NOT_FOUND',404);
    if(query.get('generation')!==current.generation||query.get('revision')!==String(source.revision)||query.get('fingerprint')!==source.fingerprint)fail('HISTORY_GENERATION_MOVED',409);
    return feeds.get(source.id);
  }
  const close=async()=>{if(closed)return;closed=true;clearInterval(heartbeat);clearTimeout(timeout);clearTimeout(refreshTimer);for(const client of [...clients.keys()]){removeClient(client);client.end();}await worker.terminate();release();};
  return {snapshot,refresh,subscribe,feed,close,configPath:loaded.configPath,projectIds:[...new Set(loaded.config.sources.map(source=>source.projectId))],diagnostics:()=>JSON.parse(JSON.stringify(diagnostics)),get active(){return active;}};
}
module.exports={createLiveHistory,fingerprint,generation,sameCursor,FORMAT};
if(!isMainThread&&workerData?.kind==='city-light-history-worker'){
  try{workerMain(workerData);}catch(error){parentPort.postMessage({type:'failure',code:errorCode(error),checkedAt:utc()});parentPort.close();}
}
