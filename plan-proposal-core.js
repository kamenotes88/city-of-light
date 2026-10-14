'use strict';
// Data-only planning. Approval, application and execution are separate owner actions.
(function(g){
  const MAX_BYTES=128*1024,own=(v,k)=>Object.prototype.hasOwnProperty.call(v,k),fail=message=>{throw Error('Plan proposal: '+message);};
  function inspect(value,depth=0,seen=new Set(),budget={nodes:0}){
    if(depth>35||++budget.nodes>100000)fail('data limit exceeded');
    if(value===null||['string','boolean'].includes(typeof value))return;
    if(typeof value==='number'){if(!Number.isFinite(value))fail('finite JSON numbers required');return;}
    if(!value||typeof value!=='object'||seen.has(value))fail('acyclic JSON data required');
    const proto=Object.getPrototypeOf(value);if(!Array.isArray(value)&&proto!==null&&Object.getPrototypeOf(proto)!==null)fail('plain JSON data required');
    const keys=Reflect.ownKeys(value);if(Array.isArray(value)&&(keys.length!==value.length+1||keys.some(k=>k!=='length'&&(!/^(0|[1-9]\d*)$/.test(String(k))||Number(k)>=value.length))))fail('dense JSON arrays required');
    seen.add(value);for(const k of keys){if(Array.isArray(value)&&k==='length')continue;
      if(typeof k!=='string'||['__proto__','constructor','prototype'].includes(k)||/^(api.?key|access.?token|refresh.?token|password|secret|authorization)$/i.test(k))fail('unsafe field');
      const d=Object.getOwnPropertyDescriptor(value,k);if(!d?.enumerable||!own(d,'value'))fail('JSON value fields required');inspect(d.value,depth+1,seen,budget);
    }seen.delete(value);
  }
  function copy(value){inspect(value);const raw=JSON.stringify(value);if(new TextEncoder().encode(raw).length>MAX_BYTES)fail('128 KiB limit exceeded');return JSON.parse(raw);}
  const schema=copy(g.TownPlanProposalSchema||(typeof require==='function'?require('./plan-proposal.schema.json'):null));if(!schema?.properties)fail('installed proposal schema required');
  function conform(value,rule,path){
    if(own(rule,'const')&&value!==rule.const)fail(path+' unsupported constant');
    if(rule.type==='object'){
      if(!value||typeof value!=='object'||Array.isArray(value)||Reflect.ownKeys(value).some(k=>typeof k!=='string'||!own(rule.properties,k))||rule.required.some(k=>!own(value,k)))fail(path+' closed fields required');
      for(const k of Object.keys(value))conform(value[k],rule.properties[k],path+'.'+k);
    }else if(rule.type==='array'){
      if(!Array.isArray(value)||value.length<rule.minItems||value.length>rule.maxItems)fail(path+' bounded array required');for(const v of value)conform(v,rule.items,path+'[]');
    }else if(rule.type==='string'){
      if(typeof value!=='string'||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)||own(rule,'minLength')&&(!value.trim()||value.length<rule.minLength)||own(rule,'maxLength')&&value.length>rule.maxLength||rule.pattern&&!new RegExp(rule.pattern).test(value))fail(path+' bounded text required');
    }else if(rule.type==='integer'&&(!Number.isSafeInteger(value)||value<rule.minimum))fail(path+' positive integer required');
  }
  function validateProposal(input){
    const proposal=copy(input);conform(proposal,schema,'proposal');const ids=new Set();
    if(new TextEncoder().encode(JSON.stringify(proposal.stageDetails)).length>65536)fail('stage details exceed 64 KiB');
    for(const d of proposal.stageDetails){if(ids.has(d.id)||['__proto__','constructor','prototype'].includes(d.id))fail('unique safe stage IDs required');ids.add(d.id);}
    if(proposal.stages&&JSON.stringify(proposal.stages)!==JSON.stringify(proposal.stageDetails.map(d=>d.label)))fail('legacy labels must match explicit stage details');
    return proposal;
  }
  function current(input,id){
    const state=typeof input==='function'?input():input,p=state?.projects?.find(p=>p.id===id);
    if(state?.version!==1||!p||p.lifecycle?.state==='archived'||!Number.isSafeInteger(p.goalVersion)||p.goalVersion<1||!Number.isSafeInteger(p.plan?.version)||p.plan.version<1)fail('current active project required');
    return {state,p,base:copy({goalVersion:p.goalVersion,plan:p.plan})};
  }
  function canonical(value){return Array.isArray(value)?'['+value.map(canonical).join(',')+']':value&&typeof value==='object'?'{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}':JSON.stringify(value);}
  async function digest(base){const crypto=g.crypto?.subtle?g.crypto:typeof require==='function'?require('node:crypto').webcrypto:null;if(!crypto?.subtle)fail('SHA256 runtime required');return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical(base)))),b=>b.toString(16).padStart(2,'0')).join('');}
  async function baseDigest(state,id){const before=current(state,id),raw=canonical(before.base),hash=await digest(before.base);if(canonical(current(state,id).base)!==raw)fail('base changed during validation');return hash;}
  async function validateBase(state,input){
    const proposal=validateProposal(input),before=current(state,proposal.projectId),raw=canonical(before.base);
    if(before.state.worldId!==proposal.worldId||before.p.goalVersion!==proposal.baseGoalVersion||before.p.plan.version!==proposal.basePlanVersion)fail('world, goal or plan version mismatch');
    if(await digest(before.base)!==proposal.basePlanDigest||canonical(current(state,proposal.projectId).base)!==raw)fail('stale plan base');
    const known=new Map();for(const plan of [...(before.p.planHistory||[]),before.p.plan])for(const d of plan.stageDetails||[]){if(known.has(d.id)&&known.get(d.id)!==d.criterion.trim())fail('inconsistent stage history');known.set(d.id,d.criterion.trim());}
    for(const d of proposal.stageDetails)if(known.has(d.id)&&known.get(d.id)!==d.criterion.trim())fail('changed criterion requires a new stage ID');
    return proposal;
  }
  async function prepareRequest(state,id,mode='suggest',options={}){
    inspect(options);
    if(!['suggest','improve'].includes(mode)||!options||typeof options!=='object'||Array.isArray(options)||Object.keys(options).some(k=>k!=='limits'))fail('planning mode or options unsupported');
    const before=current(state,id),p=before.p,raw=canonical(before.base),basePlanDigest=await digest(before.base);if(canonical(current(state,id).base)!==raw)fail('base changed during request');
    const limits=options.limits??p.limits??before.state.limits??'No spending, installation, publication, production, private-account access or execution is authorized by this planning request.';
    if(typeof limits!=='string'||limits.length>3000||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(limits))fail('bounded limits required');
    if(!Array.isArray(p.plan.stages)||p.plan.stages.length>128||p.plan.stages.some(s=>typeof s!=='string'||s.length>300))fail('bounded legacy stage labels required');
    const request=copy({format:'city-of-light-plan-request',version:1,worldId:before.state.worldId,projectId:p.id,goalVersion:p.goalVersion,planVersion:p.plan.version,basePlanDigest,
      name:p.name,goal:p.plan.goal||p.goal,criterion:p.plan.criterion||p.criterion||'',nextStep:p.nextStep||'',limits,mode,stages:p.plan.stages,
      ...(p.plan.stageDetails===undefined?{}:{stageDetails:p.plan.stageDetails})});
    if(request.stageDetails){const probe={format:'city-of-light-plan-proposal',version:1,proposalId:'validation-only',worldId:request.worldId,projectId:id,baseGoalVersion:request.goalVersion,basePlanVersion:request.planVersion,basePlanDigest,goal:request.goal,criterion:request.criterion,stageDetails:request.stageDetails,nextStep:request.nextStep,questions:[]};validateProposal(probe);}
    return request;
  }
  const api=Object.freeze({validateProposal,baseDigest,validateBase,prepareRequest,schema:copy(schema),MAX_BYTES});g.TownPlanProposalCore=api;if(typeof module!=='undefined')module.exports=api;
})(typeof window==='undefined'?globalThis:window);
