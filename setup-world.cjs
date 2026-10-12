'use strict';
// Local preparation only. An installed Node runtime and account access are separate.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{createHash,webcrypto}=require('node:crypto');
const payload=['Start.html','README.txt','INSTALL.md','setup-world.cjs','install-world.py','project-world-skill.md','extensions.json','LICENSE','NOTICE'],outputs=['My-Project-World.html','world.profile.json','AI-HANDOFF.md'],receiptName='setup-receipt.json';
const skillPaths={codex:'.agents/skills/project-world/SKILL.md',claude:'.claude/skills/project-world/SKILL.md'};
const sha=value=>createHash('sha256').update(value).digest('hex');
const json=value=>JSON.stringify(value,null,2)+'\n';
const fail=message=>{throw new Error(message);};
function canonical(value){if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';return JSON.stringify(value);}
function readJSON(file){try{return JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));}catch(_){fail('INVALID_JSON: '+path.basename(file));}}
function regular(file){const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink())fail('REGULAR_FILE_REQUIRED: '+path.basename(file));return stat;}
function noLinks(target){let current=path.resolve(target);while(true){let stat;try{stat=fs.lstatSync(current);}catch(error){if(error.code!=='ENOENT')throw error;}if(stat){if(stat.isSymbolicLink())fail('SYMLINK_REFUSED: '+current);if(current!==path.resolve(target)&&!stat.isDirectory())fail('DIRECTORY_REQUIRED: '+current);}const parent=path.dirname(current);if(parent===current)break;current=parent;}}
function installed(base){
  regular(path.join(base,'manifest.json'));const manifest=readJSON(path.join(base,'manifest.json'));
  if(manifest.format_version!==1||manifest.entrypoint!=='Start.html'||!/^\d+\.\d+\.\d+$/.test(manifest.engine_version||'')||manifest.profile_version!==1||!manifest.files||Object.keys(manifest.files).sort().join('|')!==payload.slice().sort().join('|'))fail('INVALID_MANIFEST');
  for(const name of payload){const file=path.join(base,name),stat=regular(file),record=manifest.files[name];if(!record||!Number.isSafeInteger(record.bytes)||record.bytes<0||!/^[a-f0-9]{64}$/.test(record.sha256||'')||record.bytes!==stat.size||record.sha256!==sha(fs.readFileSync(file)))fail('PAYLOAD_MISMATCH: '+name);}
  if(manifest.license_status!==undefined&&!['DRAFT_NOT_EFFECTIVE','EFFECTIVE'].includes(manifest.license_status)||manifest.provenance_status!==undefined&&!['PENDING','REVIEWED'].includes(manifest.provenance_status))fail('INVALID_LEGAL_STATUS');
  const start=fs.readFileSync(path.join(base,'Start.html'),'utf8'),matches=[...start.matchAll(/<script id="town-engine" type="application\/json">\s*(\{[\s\S]*?\})\s*<\/script>/g)];
  if(matches.length!==1)fail('ENGINE_RECORD_REQUIRED');let engine;try{engine=JSON.parse(matches[0][1]);}catch(_){fail('INVALID_ENGINE_JSON');}
  if(engine.version!==1||engine.engine_version!==manifest.engine_version||engine.profile_version!==manifest.profile_version||typeof engine.html!=='string'||!engine.assets||!engine.creator||typeof engine.assets['world-locale.js']!=='string'||typeof engine.assets['world-core.js']!=='string'||typeof engine.assets['world-package.js']!=='string')fail('ENGINE_MANIFEST_MISMATCH');
  if(!engine.legalTexts||engine.legalTexts.license!==fs.readFileSync(path.join(base,'LICENSE'),'utf8').replace(/^\uFEFF/,'')||engine.legalTexts.notice!==fs.readFileSync(path.join(base,'NOTICE'),'utf8').replace(/^\uFEFF/,''))fail('ENGINE_LEGAL_MISMATCH');
  return {engine,manifest,skill:fs.readFileSync(path.join(base,'project-world-skill.md'),'utf8')};
}
function initialize(product,locale,proLocale){
  const context=vm.createContext({crypto:webcrypto,TextEncoder,__TownLocaleCatalogue:product.engine.locale_catalogue,__ProLocaleCatalogue:product.engine.pro?.locale_catalogue});vm.runInContext(product.engine.assets['world-locale.js'],context,{filename:'world-locale.js',timeout:1000});
  const selected=context.TownLocale.select(locale);for(const name of ['world-core.js','world-package.js',...(product.engine.pro?['pro-locale.js','pro-model.js','pro-package.js']:[])])vm.runInContext(product.engine.assets[name],context,{filename:name,timeout:1000});
  if(product.engine.pro){context.ProLocale.configure(product.engine.pro.locale_catalogue);context.ProLocale.select(proLocale||(['en','ru'].includes(selected.language.split('-')[0])?{version:1,language:selected.language,direction:selected.direction}:undefined));}
  return {...product,core:context.TownWorld,pack:context.TownPackage,locale:selected,catalogue:context.TownLocale.catalogue(),proCatalogue:context.ProLocale?.catalogue()};
}
function localeTemplate(product,output,pro=false){
  output=path.resolve(output);noLinks(output);if(!fs.existsSync(path.dirname(output)))fail('OUTPUT_PARENT_REQUIRED');
  if(pro&&!product.proCatalogue)fail('PRO_LANGUAGE_MODULE_REQUIRED');const catalogue=pro?product.proCatalogue:product.catalogue;
  const content=json({version:1,language:'en',direction:'ltr',messages:catalogue}),fd=fs.openSync(output,'wx');
  try{fs.writeFileSync(fd,content,'utf8');}catch(error){try{fs.closeSync(fd);noLinks(output);fs.unlinkSync(output);}catch(_){}throw error;}finally{try{fs.closeSync(fd);}catch(_){}}
  return {status:'LOCALE_TEMPLATE_CREATED',output,language:'en',messages:Object.keys(catalogue).length};
}
function existing(output,hash,product,assistant){
  if(!fs.existsSync(output))return false;if(!fs.lstatSync(output).isDirectory())fail('OUTPUT_DIRECTORY_REQUIRED');const entries=fs.readdirSync(output);if(!entries.length)return false;
  if(!entries.includes(receiptName))fail('EXISTING_OUTPUT_REFUSED');regular(path.join(output,receiptName));const receipt=readJSON(path.join(output,receiptName)),skill=skillPaths[assistant],names=skill?[...outputs,skill]:outputs;
  if(receipt.format_version!==1||receipt.engine_version!==product.engine.engine_version||receipt.answers_sha256!==hash||receipt.assistant!==assistant||!receipt.files||Object.keys(receipt.files).sort().join('|')!==names.slice().sort().join('|'))fail('RECEIPT_MISMATCH');
  if(entries.sort().join('|')!==[...outputs,receiptName,...(skill?[skill.split('/')[0]]:[])].sort().join('|'))fail('EXISTING_OUTPUT_REFUSED');
  if(skill){let dir=output;const parts=skill.split('/');for(let i=0;i<parts.length-1;i++){dir=path.join(dir,parts[i]);noLinks(dir);if(!fs.lstatSync(dir).isDirectory()||fs.readdirSync(dir).join('|')!==parts[i+1])fail('EXISTING_OUTPUT_REFUSED');}}
  for(const name of names){const file=path.join(output,name);regular(file);const bytes=fs.readFileSync(file),record=receipt.files[name];if(!record||record.bytes!==bytes.length||record.sha256!==sha(bytes)||name===skill&&sha(bytes)!==sha(product.skill))fail('EXISTING_FILE_MISMATCH: '+name);}
  const profile=product.core.validate(readJSON(path.join(output,'world.profile.json')));
  if(profile.worldId!==receipt.worldId||JSON.stringify(receipt.connectors)!==JSON.stringify(profile.connectors)||receipt.external_access!=='NOT_CONNECTED')fail('RECEIPT_MISMATCH');
  return {status:'ALREADY_CREATED',output,worldId:profile.worldId,engine_version:product.engine.engine_version,assistant,skill:skill||null};
}
async function createWorld(product,answers,output,assistant){
  output=path.resolve(output);noLinks(output);if(!fs.existsSync(path.dirname(output)))fail('OUTPUT_PARENT_REQUIRED');
  const hash=sha(canonical(answers)),repeat=existing(output,hash,product,assistant);if(repeat)return repeat;
  const profile=product.core.create(answers),data=await product.core.dataset(profile);
  const preferredPro=answers.proLocale||(['en','ru'].includes(profile.locale?.language?.split('-')[0])?{version:1,language:profile.locale.language,direction:profile.locale.direction}:undefined);
  if(product.engine.pro&&profile.locale&&!['en','ru'].includes(profile.locale.language.split('-')[0])&&!answers.proLocale)fail('PRO_LANGUAGE_PACK_REQUIRED: translate the Pro template as answers.proLocale');
  const contents={'My-Project-World.html':product.pack.buildHTML(product.engine,{profile,data,publicPro:true,proLocale:preferredPro}),'world.profile.json':json(profile),'AI-HANDOFF.md':product.core.handoff(profile)+'\n'};
  const skill=skillPaths[assistant];if(skill)contents[skill]=product.skill;const names=skill?[...outputs,skill]:outputs;
  const receipt={format_version:1,engine_version:product.engine.engine_version,answers_sha256:hash,worldId:profile.worldId,assistant,files:Object.fromEntries(names.map(name=>{const bytes=Buffer.from(contents[name],'utf8');return [name,{bytes:bytes.length,sha256:sha(bytes)}];})),connectors:profile.connectors,external_access:'NOT_CONNECTED',source_acceptance:'NOT_RUN',synchronization:'NOT_IMPLEMENTED'};
  contents[receiptName]=json(receipt);const created=[],directories=[];let madeDirectory=false;
  try{
    noLinks(output);if(!fs.existsSync(output)){fs.mkdirSync(output);madeDirectory=true;}else if(fs.readdirSync(output).length)fail('EXISTING_OUTPUT_REFUSED');
    if(skill){let dir=output;for(const part of skill.split('/').slice(0,-1)){dir=path.join(dir,part);noLinks(dir);fs.mkdirSync(dir);directories.push(dir);}}
    for(const name of [...names,receiptName]){const file=path.join(output,name);noLinks(file);const fd=fs.openSync(file,'wx');created.push(file);try{fs.writeFileSync(fd,contents[name],'utf8');}finally{fs.closeSync(fd);}}
  }catch(error){
    // Remove only files created by this invocation, never an existing world.
    try{noLinks(output);for(const file of created.reverse())fs.unlinkSync(file);for(const dir of directories.reverse())fs.rmdirSync(dir);if(madeDirectory)fs.rmdirSync(output);}catch(_){}throw error;
  }
  return {status:'CREATED',output,worldId:profile.worldId,engine_version:product.engine.engine_version,assistant,skill:skill||null,external_access:'NOT_CONNECTED'};
}
function argumentsFor(args){
  if(args.length===1&&args[0]==='--verify')return {verify:true};
  if(args.length===2&&['--locale-template','--pro-locale-template'].includes(args[0])&&args[1]&&!args[1].startsWith('--'))return {localeTemplate:args[1],proLocaleTemplate:args[0]==='--pro-locale-template'};
  const usage='USAGE: node setup-world.cjs --verify OR --locale-template <new-json-file> OR --answers <json-path> --output <new-personal-world-dir> [--assistant codex|claude|manual]';
  if(![4,6].includes(args.length))fail(usage);const result={};
  for(let i=0;i<args.length;i+=2){if(!['--answers','--output','--assistant'].includes(args[i])||result[args[i].slice(2)]||!args[i+1]||args[i+1].startsWith('--'))fail(usage);result[args[i].slice(2)]=args[i+1];}
  if(!result.answers||!result.output||result.assistant&&!['codex','claude','manual'].includes(result.assistant))fail(usage);result.assistant=result.assistant||'manual';return result;
}
async function main(args=process.argv.slice(2),base=__dirname){
  const options=argumentsFor(args),product=installed(path.resolve(base));
  if(options.verify){initialize(product);return {status:'VERIFIED',engine_version:product.engine.engine_version,profile_version:product.engine.profile_version,license_status:product.manifest.license_status||'DRAFT_NOT_EFFECTIVE',provenance_status:product.manifest.provenance_status||'PENDING',runtime:'NODE_AVAILABLE',external_access:'NOT_CONNECTED'};}
  if(options.localeTemplate)return localeTemplate(initialize(product),options.localeTemplate,options.proLocaleTemplate);
  const answers=readJSON(path.resolve(options.answers));return createWorld(initialize(product,answers.locale,answers.proLocale),answers,options.output,options.assistant);
}
if(require.main===module)main().then(result=>process.stdout.write(json(result))).catch(error=>{process.stderr.write('ERROR: '+error.message+'\n');process.exitCode=1;});
module.exports={main,canonical};
