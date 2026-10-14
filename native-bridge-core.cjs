'use strict';
// Bounded local transport receipts. Project acceptance remains in the world.
const fs = require('node:fs'), path = require('node:path');
const {createHash, randomBytes} = require('node:crypto');
const reportCore = require('./work-report-core.js');
const MAX_REQUEST = 64 * 1024, MAX_RECEIPTS = 256, MAX_STORE = 16 * 1024 * 1024;
const STATES = new Set(['starting','running','report_ready','proposal_ready','failed','needs_owner','unknown']);
const UNRESOLVED = new Set(['starting','running','unknown']);
const ID = /^[A-Za-z0-9_.:-]{1,140}$/, UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
function fail(code, status = 400) { const error = new Error(code); error.code = code; error.status = status; throw error; }
const plain = value => value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype,null].includes(Object.getPrototypeOf(value));
function inspect(value, depth = 0) {
  if (depth > 30) fail('JSON_DEPTH_LIMIT');
  if (value === null || ['boolean','string'].includes(typeof value)) return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (!plain(value) && !Array.isArray(value)) fail('JSON_DATA_REQUIRED');
  for (const key of Object.keys(value)) {
    if (['__proto__','constructor','prototype'].includes(key) || /^(api.?key|access.?token|refresh.?token|password|secret|authorizationToken)$/i.test(key)) fail('UNSAFE_JSON_FIELD');
    inspect(value[key],depth+1);
  }
}
function keys(value, required, optional = []) {
  if (!plain(value) || required.some(key => !Object.hasOwn(value,key)) || Object.keys(value).some(key => !required.includes(key) && !optional.includes(key))) fail('UNEXPECTED_FIELDS');
}
function parse(bytes, limit = MAX_REQUEST) {
  if (bytes.length > limit) fail('JSON_SIZE_LIMIT',413);
  let value; try { value = JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)); } catch { fail('INVALID_UTF8_JSON'); }
  inspect(value); return value;
}
function canonical(value) { return Array.isArray(value) ? value.map(canonical) : plain(value) ? Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])) : value; }
const hash = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(canonical(value))).digest('hex');
const clone = value => JSON.parse(JSON.stringify(value));
function text(value, maximum, empty = false) { if (typeof value !== 'string' || value.length > maximum || !empty && !value.trim() || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)) fail('INVALID_TEXT'); }
function id(value) { if (typeof value !== 'string' || !ID.test(value)) fail('INVALID_ID'); }
function noLinks(file) {
  for (let current=file;;current=path.dirname(current)) {
    let stat; try { stat=fs.lstatSync(current); } catch(error) { if(error.code!=='ENOENT')throw error; }
    if (stat?.isSymbolicLink()) fail('SYMLINK_OR_JUNCTION_REFUSED');
    if (stat && current!==file && !stat.isDirectory()) fail('DIRECTORY_REQUIRED');
    if(path.dirname(current)===current)break;
  }
}
function localPath(value, directory = false) {
  if (typeof value!=='string' || !path.isAbsolute(value) || /[\x00-\x1f]/.test(value) || /^(?:\\\\|\/\/|[a-z][a-z0-9+.-]*:\/\/)/i.test(value)) fail('ABSOLUTE_LOCAL_PATH_REQUIRED');
  const file=path.resolve(value); noLinks(file);
  const stat=fs.lstatSync(file); if(directory?!stat.isDirectory():!stat.isFile())fail(directory?'DIRECTORY_REQUIRED':'REGULAR_FILE_REQUIRED');
  return fs.realpathSync.native(file);
}
const pathKey = file => process.platform==='win32' ? file.toLowerCase() : file;
const signature = stat => [stat.dev,stat.ino,stat.size,stat.mtimeMs,stat.ctimeMs].join(':');
function readFile(file, limit) {
  noLinks(file);const before=fs.lstatSync(file);
  if(!before.isFile() || before.size>limit)fail('BOUNDED_REGULAR_FILE_REQUIRED');
  const fd=fs.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));
  try { const stat=fs.fstatSync(fd);if(signature(before)!==signature(stat))fail('FILE_CHANGED');
    const bytes=fs.readFileSync(fd);noLinks(file);if(bytes.length>limit || signature(stat)!==signature(fs.fstatSync(fd)) || signature(stat)!==signature(fs.lstatSync(file)))fail('FILE_CHANGED');return bytes;
  } finally { fs.closeSync(fd); }
}
function atomicWrite(file,value,expected) {
  noLinks(file); let before=null;
  try { before=signature(fs.lstatSync(file)); } catch(error) { if(error.code!=='ENOENT')throw error; }
  if(expected!==undefined && expected!==before)fail('RECEIPTS_CHANGED',409);
  const bytes=Buffer.from(JSON.stringify(value,null,2)+'\n');if(bytes.length>MAX_STORE)fail('TRANSPORT_STORAGE_LIMIT',409);
  const temp=file+'.tmp-'+randomBytes(12).toString('hex');let fd;
  try {fd=fs.openSync(temp,'wx',0o600);fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;
    noLinks(file);let current=null;try{current=signature(fs.lstatSync(file));}catch(error){if(error.code!=='ENOENT')throw error;}
    if(current!==before)fail('RECEIPTS_CHANGED',409);fs.renameSync(temp,file);return signature(fs.lstatSync(file));
  } finally {if(fd!==undefined)fs.closeSync(fd);try{fs.unlinkSync(temp);}catch(error){if(error.code!=='ENOENT')throw error;}}
}
function validateRequest(input, options) {
  inspect(input);if(Buffer.byteLength(JSON.stringify(input))>MAX_REQUEST)fail('JSON_SIZE_LIMIT',413);
  keys(input,['commandId','launch','work','confirmed','authorization'],['reconnect']);id(input.commandId);if(input.commandId.length>80)fail('INVALID_COMMAND_ID');
  if(input.confirmed!==true)fail('OWNER_CONFIRMATION_REQUIRED',403);
  keys(input.authorization,['localProject','planApproved']);if(input.authorization.localProject!==true || input.authorization.planApproved!==true)fail('LOCAL_APPROVED_PROJECT_REQUIRED',403);
  const l=input.launch,w=input.work;
  keys(l,['format','version','worldId','projectId','goalVersion','planVersion','name','goal','criterion','planStatus','stages','nextStep','destination','parentContext','existingChat','requestId'],['stageDetails','planStageId']);
  keys(w,['format','version','worldId','projectId','goalVersion','planVersion','name','goal','criterion','nextStep','blocker'],['planStageId']);
  if(l.format!=='city-of-light-chat-launch' || l.version!==1 || w.format!=='city-of-light-work-request' || w.version!==1)fail('UNSUPPORTED_REQUEST');
  for(const k of ['worldId','projectId','requestId'])id(l[k]);
  if(l.worldId!==options.worldId)fail('WORLD_MISMATCH',409);
  for(const k of ['goalVersion','planVersion'])if(!Number.isSafeInteger(l[k])||l[k]<1)fail('INVALID_VERSION');
  for(const k of ['worldId','projectId','goalVersion','planVersion','name','goal','criterion','nextStep'])if(l[k]!==w[k])fail('WORK_LAUNCH_MISMATCH',409);
  text(l.name,100);text(l.goal,600);text(l.criterion,800,true);text(l.nextStep,500);text(w.blocker,1000,true);
  if(l.planStatus!=='approved_local')fail('APPROVED_PLAN_REQUIRED',403);
  if(!Array.isArray(l.stages)||!l.stages.length||l.stages.length>128)fail('PLAN_STAGES_REQUIRED');for(const s of l.stages)text(s,300);
  if(l.stageDetails!==undefined)stageDetails(l.stageDetails);
  if(l.planStageId!==undefined&&l.planStageId!==w.planStageId)fail('WORK_STAGE_MISMATCH');
  if(w.planStageId!==undefined){stageId(w.planStageId);if(!l.stageDetails?.some(d=>d.id===w.planStageId))fail('APPROVED_STAGE_REQUIRED');}
  keys(l.destination,['version','provider','mode','role','workspace','hostProjectId']);
  const d=l.destination;if(d.version!==1||d.provider!=='codex'||!['assistant_create','existing'].includes(d.mode)||d.role!=='executor')fail('UNSUPPORTED_DESTINATION');
  text(d.hostProjectId,140,true);if(d.hostProjectId)id(d.hostProjectId);
  if(pathKey(localPath(d.workspace,true))!==pathKey(options.workspace))fail('WORKSPACE_MISMATCH',403);
  if(l.parentContext!==null){keys(l.parentContext,['projectId','name','goal','goalVersion','planVersion','sourceUrl']);id(l.parentContext.projectId);text(l.parentContext.name,100);text(l.parentContext.goal,600);text(l.parentContext.sourceUrl,2048,true);for(const k of ['goalVersion','planVersion'])if(!Number.isSafeInteger(l.parentContext[k])||l.parentContext[k]<1)fail('INVALID_PARENT_CONTEXT');}
  let threadId=null;
  if(d.mode==='existing'){
    keys(l.existingChat,['role','title','href','connection']);text(l.existingChat.title,300,true);
    if(l.existingChat.role!=='executor'||l.existingChat.connection!=='navigation_only'||typeof l.existingChat.href!=='string')fail('MANAGED_CHAT_REQUIRED',409);
    threadId=l.existingChat.href.replace(/^codex:\/\/threads\//,'');if(!UUID.test(threadId)||l.existingChat.href!=='codex://threads/'+threadId)fail('MANAGED_CHAT_REQUIRED',409);
  }else if(l.existingChat!==null)fail('UNEXPECTED_EXISTING_CHAT');
  if(input.reconnect!==undefined){
    const r=input.reconnect;keys(r,['priorCommandId','priorThreadId','priorContextDigest']);id(r.priorCommandId);
    if(!UUID.test(r.priorThreadId)||!/^[a-f0-9]{64}$/.test(r.priorContextDigest)||d.mode!=='existing'||threadId!==r.priorThreadId)fail('INVALID_RECONNECT_REQUEST',409);
  }
  return {input:clone(input),threadId,contextDigest:hash({launch:l,work:w,authorization:input.authorization,...(input.reconnect===undefined?{}:{reconnect:input.reconnect})}),intentDigest:hash({work:w,stages:l.stages,parentContext:l.parentContext,destination:{provider:d.provider,role:d.role,workspace:options.workspace},...(l.stageDetails===undefined?{}:{stageDetails:l.stageDetails})})};
}
function stageId(value){if(typeof value!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(value)||['__proto__','constructor','prototype'].includes(value))fail('INVALID_PLAN_STAGE_ID');}
function stageDetails(value){
  if(!Array.isArray(value)||value.length>128)fail('PLAN_STAGE_DETAILS_REQUIRED');const seen=new Set();
  for(const d of value){keys(d,['id','label','criterion','steps']);stageId(d.id);if(seen.has(d.id))fail('DUPLICATE_PLAN_STAGE');seen.add(d.id);text(d.label,120);text(d.criterion,800);if(!Array.isArray(d.steps)||d.steps.length>12)fail('PLAN_STEPS_LIMIT');for(const step of d.steps)text(step,300);}
}
function planCore(){
  const file=path.join(__dirname,'plan-proposal-core.js');if(!fs.existsSync(file))fail('PLAN_PROPOSAL_CORE_UNAVAILABLE',503);
  const api=require(file);if(typeof api.validateProposal!=='function')fail('PLAN_PROPOSAL_CORE_UNAVAILABLE',503);return api;
}
function validatePlanRequest(input,options){
  inspect(input);if(Buffer.byteLength(JSON.stringify(input))>MAX_REQUEST)fail('JSON_SIZE_LIMIT',413);
  keys(input,['commandId','plan','confirmed','authorization']);if(typeof input.commandId!=='string'||!UUID.test(input.commandId))fail('PLAN_COMMAND_UUID_REQUIRED');
  if(input.confirmed!==true)fail('OWNER_CONFIRMATION_REQUIRED',403);keys(input.authorization,['planningOnly']);if(input.authorization.planningOnly!==true)fail('PLANNING_ONLY_REQUIRED',403);
  const p=input.plan;keys(p,['format','version','worldId','projectId','goalVersion','planVersion','basePlanDigest','name','goal','criterion','nextStep','limits','mode','stages'],['stageDetails']);
  if(p.format!=='city-of-light-plan-request'||p.version!==1)fail('UNSUPPORTED_PLAN_REQUEST');for(const k of ['worldId','projectId'])id(p[k]);if(p.worldId!==options.worldId)fail('WORLD_MISMATCH',409);
  for(const k of ['goalVersion','planVersion'])if(!Number.isSafeInteger(p[k])||p[k]<1)fail('INVALID_VERSION');if(typeof p.basePlanDigest!=='string'||!/^[a-f0-9]{64}$/.test(p.basePlanDigest))fail('BASE_PLAN_DIGEST_REQUIRED');
  text(p.name,100);text(p.goal,600);text(p.criterion,800,true);text(p.nextStep,500,true);text(p.limits,3000,true);if(!['suggest','improve'].includes(p.mode))fail('PLAN_MODE_REQUIRED');
  if(!Array.isArray(p.stages)||p.stages.length>128)fail('PLAN_STAGES_REQUIRED');for(const stage of p.stages)text(stage,300);if(p.stageDetails!==undefined)stageDetails(p.stageDetails);
  return {input:clone(input),contextDigest:hash({kind:'plan',plan:p,authorization:input.authorization}),intentDigest:hash({kind:'plan',plan:p,workspace:options.workspace})};
}
function validateProposal(input,request){
  inspect(input);if(Buffer.byteLength(JSON.stringify(input))>MAX_REQUEST)fail('JSON_SIZE_LIMIT',413);const proposal=planCore().validateProposal(input),p=request.plan;
  for(const [key,field] of [['worldId','worldId'],['projectId','projectId'],['baseGoalVersion','goalVersion'],['basePlanVersion','planVersion'],['basePlanDigest','basePlanDigest']])if(proposal[key]!==p[field])fail('PROPOSAL_BINDING_MISMATCH');
  if(proposal.proposalId!=='native-plan-'+hash(request.commandId).slice(0,48))fail('PROPOSAL_ID_MISMATCH');return proposal;
}
function validateReport(input, request, threadId) {
  const r=reportCore.validateReport(input),w=request.work;
  for(const k of ['worldId','projectId','goalVersion','planVersion'])if(r[k]!==w[k])fail('REPORT_BINDING_MISMATCH');
  if(w.planStageId!==undefined&&r.planStageId!==w.planStageId)fail('REPORT_STAGE_MISMATCH');
  if(r.reportId!=='native-'+hash(request.commandId).slice(0,48))fail('REPORT_ID_MISMATCH');
  if(!r.evidence.some(e=>e.href==='codex://threads/'+threadId))fail('REPORT_THREAD_EVIDENCE_REQUIRED');
  return r;
}
function validateStore(input,options){
  keys(options,['worldId','workspace']);id(options.worldId);
  if(typeof options.workspace!=='string'||!path.isAbsolute(options.workspace)||/[\x00-\x1f]/.test(options.workspace)||/^(?:\\\\|\/\/|[a-z][a-z0-9+.-]*:\/\/)/i.test(options.workspace))fail('ABSOLUTE_LOCAL_PATH_REQUIRED');
  inspect(input);if(Buffer.byteLength(JSON.stringify(input))>MAX_STORE)fail('JSON_SIZE_LIMIT',413);const receipts=clone(input),workspace=options.workspace;
  if(typeof receipts.workspace!=='string')fail('INVALID_TRANSPORT_STORE');
    keys(receipts,['format','version','worldId','workspace','commands']);
    if(receipts.format!=='city-of-light-native-transport'||receipts.version!==1||receipts.worldId!==options.worldId||pathKey(receipts.workspace)!==pathKey(workspace)||!Array.isArray(receipts.commands)||receipts.commands.length>MAX_RECEIPTS)fail('INVALID_TRANSPORT_STORE');
    const seen=new Set();for(const j of receipts.commands){
      keys(j,['commandId','requestId','projectId','goalVersion','planVersion','contextDigest','intentDigest','state','title','receivedAt','updatedAt'],['threadId','href','turnId','error','report','proposal','nativeTerminal','kind','basePlanDigest','mode','planStageId','replacedCommandId','replacedThreadId','replacedContextDigest']);
      for(const k of ['commandId','requestId','projectId'])id(j[k]);text(j.title,300);
      if(seen.has(j.commandId)||!STATES.has(j.state)||!['contextDigest','intentDigest'].every(k=>/^[a-f0-9]{64}$/.test(j[k]))||!['goalVersion','planVersion'].every(k=>Number.isSafeInteger(j[k])&&j[k]>0)||!['receivedAt','updatedAt'].every(k=>typeof j[k]==='string'&&/^\d{4}-\d{2}-\d{2}T/.test(j[k])&&Number.isFinite(Date.parse(j[k]))))fail('INVALID_TRANSPORT_JOB');
      if(j.kind!==undefined&&!['work','plan'].includes(j.kind))fail('INVALID_TRANSPORT_KIND');
      if(j.planStageId!==undefined)stageId(j.planStageId);
      if(j.kind==='plan'){
        if(!UUID.test(j.commandId)||j.requestId!==j.commandId||!/^[a-f0-9]{64}$/.test(j.basePlanDigest)||!['suggest','improve'].includes(j.mode)||j.report!==undefined||j.planStageId!==undefined)fail('INVALID_STORED_PLAN');
        if(j.proposal)validateProposal(j.proposal,{commandId:j.commandId,plan:{worldId:options.worldId,projectId:j.projectId,goalVersion:j.goalVersion,planVersion:j.planVersion,basePlanDigest:j.basePlanDigest}});
      }else if(j.proposal!==undefined||j.basePlanDigest!==undefined||j.mode!==undefined||j.state==='proposal_ready')fail('INVALID_TRANSPORT_KIND');
      if(j.kind==='plan'&&j.state==='report_ready'||j.state==='proposal_ready'&&!j.proposal)fail('INVALID_STORED_PLAN');
      if(j.threadId!==undefined&&(!UUID.test(j.threadId)||j.href!=='codex://threads/'+j.threadId)||j.href!==undefined&&!j.threadId||j.turnId!==undefined&&!UUID.test(j.turnId)||j.nativeTerminal!==undefined&&typeof j.nativeTerminal!=='boolean')fail('INVALID_TRANSPORT_JOB');
      if(j.error){keys(j.error,['code','message']);text(j.error.code,100);text(j.error.message,1000);}
      if(j.state==='report_ready'&&!j.report)fail('INVALID_STORED_REPORT');
      if(j.report){const r=reportCore.validateReport(j.report);if(j.planStageId!==undefined&&r.planStageId!==j.planStageId)fail('INVALID_STORED_REPORT_STAGE');if(r.worldId!==options.worldId||r.projectId!==j.projectId||r.goalVersion!==j.goalVersion||r.planVersion!==j.planVersion)fail('INVALID_STORED_REPORT');}
      if(['replacedCommandId','replacedThreadId','replacedContextDigest'].some(k=>j[k]!==undefined)){
        if(j.kind!=='work')fail('INVALID_RECONNECT_RECEIPT');id(j.replacedCommandId);
        if(!UUID.test(j.replacedThreadId)||!/^[a-f0-9]{64}$/.test(j.replacedContextDigest))fail('INVALID_RECONNECT_RECEIPT');
        const prior=receipts.commands.find(k=>k.commandId===j.replacedCommandId);
        if(!prior||receipts.commands.indexOf(prior)>=receipts.commands.indexOf(j)||(prior.kind||'work')!=='work'||prior.projectId!==j.projectId||prior.threadId!==j.replacedThreadId||prior.contextDigest!==j.replacedContextDigest||prior.nativeTerminal!==true||!['report_ready','failed','needs_owner'].includes(prior.state)||j.threadId===j.replacedThreadId)fail('INVALID_RECONNECT_RECEIPT');
      }
      seen.add(j.commandId);
    }

  return receipts;
}
function createBridge(options) {
  id(options.worldId);const workspace=localPath(options.workspace,true),world=localPath(options.world,false),adapter=options.adapter;
  const store=options.receiptPath||path.join(path.dirname(world),'.city-light-native-'+hash(options.worldId).slice(0,16)+'.json');
  if(!path.isAbsolute(store)||pathKey(path.dirname(path.resolve(store)))!==pathKey(path.dirname(world)))fail('RECEIPT_LOCATION_REQUIRED');noLinks(store);
  let receipts={format:'city-of-light-native-transport',version:1,worldId:options.worldId,workspace,commands:[]},storeSignature=null,restarted=false;
  if(fs.existsSync(store)){
    receipts=validateStore(parse(readFile(store,MAX_STORE),MAX_STORE),{worldId:options.worldId,workspace});
    storeSignature=signature(fs.lstatSync(store));
    for(const j of receipts.commands)if(['starting','running'].includes(j.state)||j.state==='needs_owner'&&j.nativeTerminal!==true){restarted=true;j.state='unknown';j.error={code:'RUNTIME_RESTARTED',message:'Previous execution needs inspection. It will not be repeated.'};}
  }
  function save(){storeSignature=atomicWrite(store,receipts,storeSignature);}
  if(restarted)save();
  let closed=false,active=null;
  const info=()=>({version:1,provider:'codex',workspace,worldId:options.worldId,managedOnly:true,canStart:options.readOnly!==true,canPlan:options.readOnly!==true&&typeof adapter?.plan==='function'&&(()=>{try{planCore();return true;}catch{return false;}})(),readOnly:options.readOnly===true,connected:adapter?.connected===true});
  const kindOf=j=>j.kind||'work';
  const runtimeOwns=j=>!!j?.threadId&&adapter?.owns?.(j.threadId,kindOf(j))===true;
  const canReconnect=j=>options.readOnly!==true&&typeof adapter?.run==='function'&&!active&&!receipts.commands.some(k=>UNRESOLVED.has(k.state))&&j===receipts.commands.findLast(k=>kindOf(k)==='work'&&k.projectId===j?.projectId)&&!!j?.threadId&&j.nativeTerminal===true&&['report_ready','failed','needs_owner'].includes(j.state)&&!runtimeOwns(j);
  function status(projectId,commandId,kind='work'){id(projectId);if(commandId)id(commandId);if(!['work','plan'].includes(kind))fail('INVALID_TRANSPORT_KIND');const job=receipts.commands.find(j=>j.commandId===commandId&&j.projectId===projectId&&kindOf(j)===kind)||(commandId?null:receipts.commands.findLast(j=>j.projectId===projectId&&kindOf(j)===kind));return {version:1,worldId:options.worldId,projectId,checkedAt:new Date().toISOString(),managed:!!job,runtimeOwned:runtimeOwns(job),canReconnect:!!canReconnect(job),job:job?clone(job):null};}
  function update(job, fields){if(closed)return;const before=clone(job);Object.assign(job,fields,{updatedAt:new Date().toISOString()});try{save();}catch(error){Object.assign(job,before,{state:'unknown',error:{code:'RECEIPT_WRITE_FAILED',message:'Execution status could not be saved; inspect the chat before continuing.'}});throw error;}}
  async function execute(job,request,threadId){
    try{
      const planning=job.kind==='plan';
      const result=await (planning?adapter.plan:adapter.run).call(adapter,planning?{plan:request.plan,commandId:request.commandId,threadId,workspace}:{launch:request.launch,work:request.work,commandId:request.commandId,threadId,workspace},event=>{
        if(event.threadId&&(!UUID.test(event.threadId)||!adapter.owns(event.threadId,kindOf(job))))fail('UNMANAGED_PROVIDER_THREAD');
        if(event.threadId&&event.threadId===job.replacedThreadId)fail('RECONNECT_THREAD_REUSED');
        const fields={};for(const k of ['threadId','turnId','title'])if(event[k])fields[k]=String(event[k]).slice(0,300);
        if(fields.threadId)fields.href='codex://threads/'+fields.threadId;
        if(event.state&&STATES.has(event.state))fields.state=event.state;
        if(event.error)fields.error={code:event.error.code||'OWNER_ACTION_REQUIRED',message:String(event.error.message||'An explicit owner action is required.').slice(0,1000)};
        update(job,fields);
      });
      if(closed)return;
      if(planning&&result.proposal){const proposal=validateProposal(result.proposal,request);update(job,{state:'proposal_ready',proposal,nativeTerminal:true});}
      else if(!planning&&result.report){const report=validateReport(result.report,request,job.threadId);update(job,{state:'report_ready',report,nativeTerminal:true});}
      else update(job,{state:result.needsOwner?'needs_owner':'failed',nativeTerminal:true,error:{code:result.error?.code||(planning?'PROPOSAL_NOT_RETURNED':'REPORT_NOT_RETURNED'),message:result.error?.message||(planning?'No valid proposal was returned. No plan was applied.':'No valid work report was returned. No achievement was accepted.')}});
    }catch(error){if(!closed){const state=error.unknown===true?'unknown':'failed';try{update(job,{state,error:{code:error.code||'NATIVE_RUN_FAILED',message:'The native run did not return a verified report. Inspect its chat before another action.'}});}catch{job.state='unknown';}}}
    finally{if(active===job)active=null;}
  }
  function start(input){
    if(closed)fail('BRIDGE_CLOSED',503);const checked=validateRequest(input,{worldId:options.worldId,workspace});
    const previous=receipts.commands.find(j=>j.commandId===input.commandId);
    if(previous){if(kindOf(previous)!=='work'||previous.contextDigest!==checked.contextDigest)fail('COMMAND_ID_CONFLICT',409);return {duplicate:true,...status(previous.projectId,previous.commandId)};}
    const sameIntent=receipts.commands.find(j=>kindOf(j)==='work'&&j.intentDigest===checked.intentDigest);
    if(sameIntent)return {duplicate:true,...status(sameIntent.projectId,sameIntent.commandId)};
    if(options.readOnly===true)fail('READ_ONLY_RUNTIME',403);
    if(!adapter?.run)fail('CODEX_UNAVAILABLE',503);
    if(active||receipts.commands.some(j=>UNRESOLVED.has(j.state)))fail('PREVIOUS_RUN_UNRESOLVED',409);
    const prior=receipts.commands.findLast(j=>kindOf(j)==='work'&&j.projectId===input.work.projectId&&j.threadId);
    let threadId=checked.threadId;
    const reconnect=checked.input.reconnect;
    if(reconnect){
      if(!canReconnect(prior)||prior.commandId!==reconnect.priorCommandId||prior.threadId!==reconnect.priorThreadId||prior.contextDigest!==reconnect.priorContextDigest)fail('RECONNECT_RECEIPT_MISMATCH',409);
      threadId=null;
    }else{
      if(threadId&&(!adapter.owns(threadId,'work')||!prior||prior.threadId!==threadId))fail('MANAGED_CHAT_REQUIRED',409);
      if(!threadId&&prior){if(!adapter.owns(prior.threadId,'work'))fail('MANAGED_SESSION_ENDED',409);threadId=prior.threadId;}
    }
    if(receipts.commands.length>=MAX_RECEIPTS)fail('TRANSPORT_HISTORY_LIMIT',409);
    const job={kind:'work',...(input.work.planStageId===undefined?{}:{planStageId:input.work.planStageId}),commandId:input.commandId,requestId:input.launch.requestId,projectId:input.work.projectId,goalVersion:input.work.goalVersion,planVersion:input.work.planVersion,contextDigest:checked.contextDigest,intentDigest:checked.intentDigest,state:'starting',title:input.work.name,receivedAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
    if(reconnect)Object.assign(job,{replacedCommandId:prior.commandId,replacedThreadId:prior.threadId,replacedContextDigest:prior.contextDigest});
    receipts.commands.push(job);try{save();}catch(error){receipts.commands.pop();throw error;}
    active=job;queueMicrotask(()=>execute(job,checked.input,threadId));return {duplicate:false,...status(job.projectId,job.commandId)};
  }
  function planStart(input){
    if(closed)fail('BRIDGE_CLOSED',503);const checked=validatePlanRequest(input,{worldId:options.worldId,workspace});
    const previous=receipts.commands.find(j=>j.commandId===input.commandId);
    if(previous){if(kindOf(previous)!=='plan'||previous.contextDigest!==checked.contextDigest)fail('COMMAND_ID_CONFLICT',409);return {duplicate:true,...status(previous.projectId,previous.commandId,'plan')};}
    const same=receipts.commands.find(j=>kindOf(j)==='plan'&&j.intentDigest===checked.intentDigest);if(same)return {duplicate:true,...status(same.projectId,same.commandId,'plan')};
    if(options.readOnly===true)fail('READ_ONLY_RUNTIME',403);if(!adapter?.plan)fail('PLAN_PROVIDER_UNAVAILABLE',503);planCore();
    if(active||receipts.commands.some(j=>UNRESOLVED.has(j.state)))fail('PREVIOUS_RUN_UNRESOLVED',409);if(receipts.commands.length>=MAX_RECEIPTS)fail('TRANSPORT_HISTORY_LIMIT',409);
    const p=input.plan,prior=receipts.commands.findLast(j=>kindOf(j)==='plan'&&j.projectId===p.projectId&&j.threadId);
    const threadId=prior&&adapter.owns(prior.threadId,'plan')?prior.threadId:null;
    const job={kind:'plan',commandId:input.commandId,requestId:input.commandId,projectId:p.projectId,goalVersion:p.goalVersion,planVersion:p.planVersion,basePlanDigest:p.basePlanDigest,mode:p.mode,contextDigest:checked.contextDigest,intentDigest:checked.intentDigest,state:'starting',title:p.name,receivedAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
    receipts.commands.push(job);try{save();}catch(e){receipts.commands.pop();throw e;}active=job;queueMicrotask(()=>execute(job,checked.input,threadId));return {duplicate:false,...status(job.projectId,job.commandId,'plan')};
  }
  function close(){if(closed)return;closed=true;if(active){active.state='unknown';active.error={code:'RUNTIME_STOPPED',message:'Execution may have started. Inspect the native chat; no automatic retry.'};try{save();}catch{}}adapter?.close?.();}
  return {info,status,start,planStart,close,receiptPath:store};
}
module.exports={createBridge,validateStore,validateRequest,validatePlanRequest,validateProposal,planCore,validateReport,parse,hash,keys,fail,readFile,localPath,noLinks,pathKey,MAX_REQUEST,MAX_STORE,MAX_RECEIPTS};
