'use strict';
// Local preparation only. An installed Node runtime and account access are separate.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{createHash,webcrypto}=require('node:crypto');
const payload=['Start.html','README.txt','INSTALL.md','setup-world.cjs','install-world.py','project-world-skill.md','extensions.json','LICENSE','NOTICE','work-result.cjs','work-report.schema.json','world-history-core.js','history-source.cjs','HISTORY_IMPORT.md','HISTORY_CONNECTORS.md','run-world.cjs','native-bridge-core.cjs','native-bridge-codex.cjs','work-report-core.js','live-history-service.cjs','plan-proposal-core.js','plan-proposal.schema.json'],outputs=['My-Project-World.html','world.profile.json','AI-HANDOFF.md','Start-Game.cjs','Start-Game.cmd'],receiptName='setup-receipt.json';
const skillPaths={codex:'.agents/skills/project-world/SKILL.md',claude:'.claude/skills/project-world/SKILL.md'};
const HISTORY_BYTES=20*1024*1024;
const sha=value=>createHash('sha256').update(value).digest('hex');
const json=value=>JSON.stringify(value,null,2)+'\n';
const fail=message=>{throw new Error(message);};
function canonical(value){if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';return JSON.stringify(value);}
function readJSON(file){try{return JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));}catch(_){fail('INVALID_JSON: '+path.basename(file));}}
function regular(file){const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink())fail('REGULAR_FILE_REQUIRED: '+path.basename(file));return stat;}
function noLinks(target){let current=path.resolve(target);while(true){let stat;try{stat=fs.lstatSync(current);}catch(error){if(error.code!=='ENOENT')throw error;}if(stat){if(stat.isSymbolicLink())fail('SYMLINK_REFUSED: '+current);if(current!==path.resolve(target)&&!stat.isDirectory())fail('DIRECTORY_REQUIRED: '+current);}const parent=path.dirname(current);if(parent===current)break;current=parent;}}
function readProducer(file,limit,native){
  noLinks(file);const before=regular(file),stamp=stat=>[stat.dev,stat.ino,stat.size,stat.mtimeMs,stat.ctimeMs].join(':');if(before.size>limit)fail('NATIVE_PRODUCER_SIZE_LIMIT');
  const fd=fs.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));let bytes;
  try{
    const opened=fs.fstatSync(fd);noLinks(file);if(!opened.isFile()||stamp(before)!==stamp(opened)||stamp(opened)!==stamp(fs.lstatSync(file)))fail('NATIVE_PRODUCER_CHANGED_DURING_READ');
    const parts=[],buffer=Buffer.alloc(65536);let size=0,count;
    while((count=fs.readSync(fd,buffer,0,buffer.length,null))){size+=count;if(size>limit)fail('NATIVE_PRODUCER_SIZE_LIMIT');parts.push(Buffer.from(buffer.subarray(0,count)));}
    noLinks(file);if(stamp(opened)!==stamp(fs.fstatSync(fd))||stamp(opened)!==stamp(fs.lstatSync(file))||size!==opened.size)fail('NATIVE_PRODUCER_CHANGED_DURING_READ');bytes=Buffer.concat(parts,size);
  }finally{fs.closeSync(fd);}
  return native.parse(bytes,limit);
}
function nativeFiles(output,profile,entries,product){
  const prefix='.city-light-native-'+sha(profile.worldId).slice(0,16),names=[prefix+'.json',prefix+'.lock'].filter(name=>entries.includes(name));if(!names.length)return names;
  // Use verified data-only helpers. Creating a bridge here would rewrite unresolved execution receipts.
  const native=require(path.join(product.base,'native-bridge-core.cjs'));
  for(const name of names){
    const value=readProducer(path.join(output,name),name.endsWith('.lock')?1024:native.MAX_STORE,native);
    if(name.endsWith('.lock')){native.keys(value,['pid','nonce']);if(!Number.isSafeInteger(value.pid)||value.pid<1||typeof value.nonce!=='string'||!/^[a-f0-9]{32}$/.test(value.nonce))fail('INVALID_NATIVE_PRODUCER_LOCK');continue;}
    if(native.pathKey(native.localPath(value.workspace,true))!==native.pathKey(value.workspace))fail('INVALID_NATIVE_PRODUCER_STORE');
    native.validateStore(value,{worldId:profile.worldId,workspace:value.workspace});
  }
  return names;
}
function historyFeeds(value){
  if(!value||typeof value!=='object'||Array.isArray(value))fail('INVALID_HISTORY_FEEDS');
  if(Buffer.byteLength(JSON.stringify(value),'utf8')>HISTORY_BYTES)fail('HISTORY_SIZE_LIMIT');
  let pages;if(value.format==='city-light-history-pages'){
    if(value.version!==1||Object.keys(value).sort().join('|')!=='format|pages|version'||!Array.isArray(value.pages)||!value.pages.length||value.pages.length>6)fail('INVALID_HISTORY_PAGES');pages=value.pages;
  }else if(value.format==='city-light-history-feed'&&value.version===1)return [value];else pages=[value];
  const feeds=[];for(const page of pages){if(!page||typeof page!=='object'||Array.isArray(page)||page.format!=='city-light-history-feeds'||page.version!==1||Object.keys(page).some(key=>!['format','version','feeds','readerInputCursors'].includes(key))||!['format','version','feeds'].every(key=>Object.hasOwn(page,key)))fail('INVALID_HISTORY_CONTAINER');if(!Array.isArray(page.feeds)||!page.feeds.length||page.feeds.length>50)fail('INVALID_HISTORY_FEEDS');feeds.push(...page.feeds);}
  if(feeds.length>256||feeds.reduce((count,feed)=>count+(Array.isArray(feed?.records)?feed.records.length:0),0)>require('./history-source.cjs').MAX_RECORDS)fail('HISTORY_COUNT_LIMIT');
  return feeds;
}
function readHistory(file){
  if(typeof file!=='string'||!path.isAbsolute(file)||file.includes('\0')||/^(?:\\\\|\/\/|[a-z][a-z0-9+.-]*:\/\/)/i.test(file))fail('EXACT_LOCAL_HISTORY_PATH_REQUIRED');
  file=path.resolve(file);noLinks(file);const before=regular(file);if(before.size>HISTORY_BYTES)fail('HISTORY_SIZE_LIMIT');
  const same=(a,b)=>a.dev===b.dev&&a.ino===b.ino,stamp=stat=>[stat.size,stat.mtimeMs,stat.ctimeMs].join(':');
  const fd=fs.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));let bytes;
  try{
    const opened=fs.fstatSync(fd);noLinks(file);if(!opened.isFile()||!same(before,opened)||!same(opened,fs.lstatSync(file)))fail('HISTORY_CHANGED_DURING_READ');
    const parts=[],buffer=Buffer.alloc(65536);let size=0,count;
    while((count=fs.readSync(fd,buffer,0,buffer.length,null))){size+=count;if(size>HISTORY_BYTES)fail('HISTORY_SIZE_LIMIT');parts.push(Buffer.from(buffer.subarray(0,count)));}
    const after=fs.fstatSync(fd);noLinks(file);if(!same(opened,fs.lstatSync(file))||stamp(opened)!==stamp(after)||size!==after.size)fail('HISTORY_CHANGED_DURING_READ');
    bytes=Buffer.concat(parts,size);
  }finally{fs.closeSync(fd);}
  let value;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes).replace(/^\uFEFF/,''));}catch(_){fail('INVALID_JSON: '+path.basename(file));}
  historyFeeds(value);return value;
}
function selectedHistory(product,file,output){
  if(!file)return null;
  const reader=require(path.join(product.base,'history-source.cjs')),loaded=reader.loadConfig(file),configPath=fs.realpathSync.native(loaded.configPath);
  const inside=file=>{const relative=path.relative(path.resolve(output),file);return !relative||relative!=='..'&&!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative);};
  if([configPath,loaded.config.output,...loaded.config.sources.map(source=>source.path)].some(inside))fail('HISTORY_CONFIG_MUST_STAY_OUTSIDE_WORLD');
  return {configPath,configDigest:loaded.configDigest,projectIds:[...new Set(loaded.config.sources.map(source=>source.projectId))]};
}
function selectedProjects(connection,profile){if(connection&&connection.projectIds.some(id=>!profile.projects.some(project=>project.id===id)))fail('UNKNOWN_HISTORY_CONFIG_PROJECT');}
function installed(base){
  regular(path.join(base,'manifest.json'));const manifest=readJSON(path.join(base,'manifest.json'));
  if(manifest.format_version!==1||manifest.entrypoint!=='Start.html'||!/^\d+\.\d+\.\d+$/.test(manifest.engine_version||'')||manifest.profile_version!==1||!manifest.files||Object.keys(manifest.files).sort().join('|')!==payload.slice().sort().join('|'))fail('INVALID_MANIFEST');
  for(const name of payload){const file=path.join(base,name),stat=regular(file),record=manifest.files[name];if(!record||!Number.isSafeInteger(record.bytes)||record.bytes<0||!/^[a-f0-9]{64}$/.test(record.sha256||'')||record.bytes!==stat.size||record.sha256!==sha(fs.readFileSync(file)))fail('PAYLOAD_MISMATCH: '+name);}
  if(manifest.license_status!==undefined&&!['DRAFT_NOT_EFFECTIVE','EFFECTIVE'].includes(manifest.license_status)||manifest.provenance_status!==undefined&&!['PENDING','REVIEWED'].includes(manifest.provenance_status))fail('INVALID_LEGAL_STATUS');
  const start=fs.readFileSync(path.join(base,'Start.html'),'utf8'),matches=[...start.matchAll(/<script id="town-engine" type="application\/json">\s*(\{[\s\S]*?\})\s*<\/script>/g)];
  if(matches.length!==1)fail('ENGINE_RECORD_REQUIRED');let engine;try{engine=JSON.parse(matches[0][1]);}catch(_){fail('INVALID_ENGINE_JSON');}
  if(engine.version!==1||engine.engine_version!==manifest.engine_version||engine.profile_version!==manifest.profile_version||typeof engine.html!=='string'||!engine.assets||!engine.creator||typeof engine.assets['world-locale.js']!=='string'||typeof engine.assets['world-core.js']!=='string'||typeof engine.assets['world-package.js']!=='string')fail('ENGINE_MANIFEST_MISMATCH');
  if(!engine.legalTexts||engine.legalTexts.license!==fs.readFileSync(path.join(base,'LICENSE'),'utf8').replace(/^\uFEFF/,'')||engine.legalTexts.notice!==fs.readFileSync(path.join(base,'NOTICE'),'utf8').replace(/^\uFEFF/,''))fail('ENGINE_LEGAL_MISMATCH');
  return {base,engine,manifest,skill:fs.readFileSync(path.join(base,'project-world-skill.md'),'utf8')};
}
function initialize(product,locale,proLocale){
  // These modules are verified before initialization. Keep a finite bound with room for busy PCs.
  const context=vm.createContext({crypto:webcrypto,TextEncoder,URL,__TownLocaleCatalogue:product.engine.locale_catalogue,__ProLocaleCatalogue:product.engine.pro?.locale_catalogue});vm.runInContext(product.engine.assets['world-locale.js'],context,{filename:'world-locale.js',timeout:5000});
  const selected=context.TownLocale.select(locale);for(const name of ['world-core.js',...(product.engine.assets['world-history-core.js']?['world-history-core.js']:[]),'world-package.js',...(product.engine.pro?['pro-locale.js','pro-model.js','pro-package.js']:[])])vm.runInContext(product.engine.assets[name],context,{filename:name,timeout:5000});
  if(product.engine.pro){context.ProLocale.configure(product.engine.pro.locale_catalogue);context.ProLocale.select(proLocale||(['en','ru'].includes(selected.language.split('-')[0])?{version:1,language:selected.language,direction:selected.direction}:undefined));}
  return {...product,core:context.TownWorld,pack:context.TownPackage,locale:selected,catalogue:context.TownLocale.catalogue(),proCatalogue:context.ProLocale?.catalogue(),history:context.TownHistoryCore};
}
function localeTemplate(product,output,pro=false){
  output=path.resolve(output);noLinks(output);if(!fs.existsSync(path.dirname(output)))fail('OUTPUT_PARENT_REQUIRED');
  if(pro&&!product.proCatalogue)fail('PRO_LANGUAGE_MODULE_REQUIRED');const catalogue=pro?product.proCatalogue:product.catalogue;
  const content=json({version:1,language:'en',direction:'ltr',messages:catalogue}),fd=fs.openSync(output,'wx');
  try{fs.writeFileSync(fd,content,'utf8');}catch(error){try{fs.closeSync(fd);noLinks(output);fs.unlinkSync(output);}catch(_){}throw error;}finally{try{fs.closeSync(fd);}catch(_){}}
  return {status:'LOCALE_TEMPLATE_CREATED',output,language:'en',messages:Object.keys(catalogue).length};
}
function existing(output,hash,product,assistant,connection){
  if(!fs.existsSync(output))return false;if(!fs.lstatSync(output).isDirectory())fail('OUTPUT_DIRECTORY_REQUIRED');const entries=fs.readdirSync(output);if(!entries.length)return false;
  if(!entries.includes(receiptName))fail('EXISTING_OUTPUT_REFUSED');regular(path.join(output,receiptName));const receipt=readJSON(path.join(output,receiptName)),skill=skillPaths[assistant],names=skill?[...outputs,skill]:outputs;
  if(receipt.format_version!==1||receipt.engine_version!==product.engine.engine_version||receipt.answers_sha256!==hash||receipt.assistant!==assistant||!receipt.files||Object.keys(receipt.files).sort().join('|')!==names.slice().sort().join('|'))fail('RECEIPT_MISMATCH');
  if(typeof receipt.worldId!=='string')fail('RECEIPT_MISMATCH');const prefix='.city-light-native-'+sha(receipt.worldId).slice(0,16),producer=[prefix+'.json',prefix+'.lock'].filter(name=>entries.includes(name));
  if(entries.sort().join('|')!==[...outputs,receiptName,...(skill?[skill.split('/')[0]]:[]),...producer].sort().join('|'))fail('EXISTING_OUTPUT_REFUSED');
  if(skill){let dir=output;const parts=skill.split('/');for(let i=0;i<parts.length-1;i++){dir=path.join(dir,parts[i]);noLinks(dir);if(!fs.lstatSync(dir).isDirectory()||fs.readdirSync(dir).join('|')!==parts[i+1])fail('EXISTING_OUTPUT_REFUSED');}}
  for(const name of names){const file=path.join(output,name);regular(file);const bytes=fs.readFileSync(file),record=receipt.files[name];if(!record||record.bytes!==bytes.length||record.sha256!==sha(bytes)||name===skill&&sha(bytes)!==sha(product.skill))fail('EXISTING_FILE_MISMATCH: '+name);}
  const profile=product.core.validate(readJSON(path.join(output,'world.profile.json')));
  if(profile.worldId!==receipt.worldId||JSON.stringify(receipt.connectors)!==JSON.stringify(profile.connectors)||receipt.external_access!=='NOT_CONNECTED')fail('RECEIPT_MISMATCH');
  selectedProjects(connection,profile);
  nativeFiles(output,profile,entries,product);
  return {status:'ALREADY_CREATED',output,worldId:profile.worldId,engine_version:product.engine.engine_version,assistant,skill:skill||null};
}
async function createWorld(product,answers,output,assistant,historyInput,connection){
  output=path.resolve(output);noLinks(output);if(!fs.existsSync(path.dirname(output)))fail('OUTPUT_PARENT_REQUIRED');
  const history=historyInput?historyFeeds(historyInput):null;
  const inputs=connection?{answers,...(historyInput?{historyInput}:{}),historyConfig:{path:connection.configPath,sha256:connection.configDigest}}:historyInput?{answers,historyInput}:answers;
  const hash=sha(canonical(inputs)),repeat=existing(output,hash,product,assistant,connection);if(repeat)return repeat;
  const profile=product.core.create(answers);selectedProjects(connection,profile);let data=await product.core.dataset(profile);
  if(history){if(!product.history)fail('HISTORY_MODULE_REQUIRED');const checked=historyInput.format==='city-light-history-feed'?history:require(path.join(product.base,'history-source.cjs')).outputPages(historyInput,profile.projects).feeds;for(const feed of checked)data=product.history.merge(data,feed,profile.projects).data;}
  const preferredPro=answers.proLocale||(['en','ru'].includes(profile.locale?.language?.split('-')[0])?{version:1,language:profile.locale.language,direction:profile.locale.direction}:undefined);
  if(product.engine.pro&&profile.locale&&!['en','ru'].includes(profile.locale.language.split('-')[0])&&!answers.proLocale)fail('PRO_LANGUAGE_PACK_REQUIRED: translate the Pro template as answers.proLocale');
  const contents={'My-Project-World.html':product.pack.buildHTML(product.engine,{profile,data,publicPro:true,proLocale:preferredPro}),'world.profile.json':json(profile),'AI-HANDOFF.md':product.core.handoff(profile)+'\n'};
  // Generated personal launchers carry paths only. Tokens and native credentials are never persisted.
  const runner=path.relative(output,path.join(product.base,'run-world.cjs'));
  const historyGuard=connection?"const history=require(path.join(path.dirname(runner),'history-source.cjs')).loadConfig("+JSON.stringify(connection.configPath)+");\nif(history.configDigest!=="+JSON.stringify(connection.configDigest)+")throw Error('HISTORY_CONFIG_CHANGED_RECONFIGURATION_REQUIRED');\n":"";
  contents['Start-Game.cjs']="'use strict';\nconst path=require('node:path'),{spawn}=require('node:child_process');\nconst runner=path.resolve(__dirname,"+JSON.stringify(runner)+");\n"+historyGuard+"const child=spawn(process.execPath,[runner,'--world',path.join(__dirname,'My-Project-World.html'),'--world-id',"+JSON.stringify(profile.worldId)+",'--workspace',__dirname,'--open'"+(connection?",'--history-config',"+JSON.stringify(connection.configPath):"")+"],{stdio:'inherit',shell:false});\nchild.on('error',()=>{process.stderr.write('Unable to start the local game. Ask your assistant to verify Node and the installed engine.\\n');process.exitCode=1;});\nchild.on('exit',code=>{process.exitCode=code||0;});\n";
  noLinks(process.execPath);regular(process.execPath);const node=path.resolve(process.execPath);if(/[\x00-\x1f\"]/.test(node))fail('UNSAFE_NODE_LAUNCHER_PATH');
  contents['Start-Game.cmd']='@echo off\r\nsetlocal DisableDelayedExpansion\r\n"'+node.replace(/%/g,'%%')+'" "%~dp0Start-Game.cjs"\r\nif errorlevel 1 pause\r\n';
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
  const usage='USAGE: node setup-world.cjs --verify OR --locale-template <new-json-file> OR --answers <json-path> --output <new-personal-world-dir> [--assistant codex|claude|manual] [--history <permitted-history-json>] [--history-config <explicit-existing-absolute-config.json>]';
  if(![4,6,8,10].includes(args.length))fail(usage);const result={};
  for(let i=0;i<args.length;i+=2){if(!['--answers','--output','--assistant','--history','--history-config'].includes(args[i])||result[args[i].slice(2)]||!args[i+1]||args[i+1].startsWith('--'))fail(usage);result[args[i].slice(2)]=args[i+1];}
  if(!result.answers||!result.output||result.assistant&&!['codex','claude','manual'].includes(result.assistant))fail(usage);result.assistant=result.assistant||'manual';return result;
}
async function main(args=process.argv.slice(2),base=__dirname){
  const options=argumentsFor(args),product=installed(path.resolve(base));
  if(options.verify){initialize(product);return {status:'VERIFIED',engine_version:product.engine.engine_version,profile_version:product.engine.profile_version,license_status:product.manifest.license_status||'DRAFT_NOT_EFFECTIVE',provenance_status:product.manifest.provenance_status||'PENDING',runtime:'NODE_AVAILABLE',external_access:'NOT_CONNECTED'};}
  if(options.localeTemplate)return localeTemplate(initialize(product),options.localeTemplate,options.proLocaleTemplate);
  const answers=readJSON(path.resolve(options.answers)),connection=selectedHistory(product,options['history-config'],options.output);return createWorld(initialize(product,answers.locale,answers.proLocale),answers,options.output,options.assistant,options.history?readHistory(options.history):null,connection);
}
if(require.main===module)main().then(result=>process.stdout.write(json(result))).catch(error=>{process.stderr.write('ERROR: '+error.message+'\n');process.exitCode=1;});
module.exports={main,canonical,readHistory,historyFeeds};
