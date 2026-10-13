'use strict';
// Read only explicitly selected files. Output is data, never an execution request.
const fs = require('node:fs'), path = require('node:path');
const {createHash, randomBytes} = require('node:crypto');
const core = require('./world-history-core.js');
const MAX_CONFIG = 64 * 1024, MAX_NATIVE = 1024 * 1024 * 1024, MAX_LINE = 128 * 1024, READ_BUFFER = 64 * 1024, MAX_NATIVE_MS = 30000, NATIVE_DETAIL = 900;
const MAX_CONTAINER = 10 * 1024 * 1024, MAX_RECORDS = 10000, CHUNK_RECORDS = 200, MAX_FEEDS = 50;
const BLOCKED = new Set(['__proto__', 'constructor', 'prototype']);
const HELP = 'City of Light selected history reader\n\n' +
  'node history-source.cjs --config <absolute-config.json> [--once | --watch | --initialize-structured-cursors]\n\n' +
  'The default is one read. --watch is an optional foreground process; Ctrl+C stops it.\n' +
  'Only configured Codex/Claude JSONL or structured feed files are read. No chat scan, credentials, network, commands or messages are used.\n' +
  'Chat text becomes documentary observations, never accepted achievements. Existing output history is retained.\n' +
  '--initialize-structured-cursors is a one-time explicit legacy migration. It requires current structured records, kind and URL to match retained output and preserves every feed/revision.\n';
const fail = message => {throw Error(message);};
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const plain = value => value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const canonical = value => Array.isArray(value) ? value.map(canonical) : plain(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const serialize = value => JSON.stringify(canonical(value), null, 2) + '\n';
function inspect(value, depth = 0) {
  if (depth > 60) fail('JSON_DEPTH_LIMIT');
  if (value === null || ['string', 'boolean'].includes(typeof value)) return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (!Array.isArray(value) && !plain(value)) fail('JSON_DATA_REQUIRED');
  for (const key of Object.keys(value)) {if (BLOCKED.has(key)) fail('UNSAFE_JSON_FIELD'); inspect(value[key], depth + 1);}
}
function parse(bytes) {
  let value; try {value = JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(bytes).replace(/^\uFEFF/, ''));} catch (_) {fail('INVALID_UTF8_JSON');}
  inspect(value); return value;
}
function absoluteLocal(value) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || value.includes('\0') || /^(?:\\\\|\/\/|[a-z][a-z0-9+.-]*:\/\/)/i.test(value)) fail('EXACT_ABSOLUTE_LOCAL_PATH_REQUIRED');
  return path.resolve(value);
}
function noLinks(file) {
  for (let current = file;; current = path.dirname(current)) {
    let stat; try {stat = fs.lstatSync(current);} catch (error) {if (error.code !== 'ENOENT') throw error;}
    if (stat?.isSymbolicLink()) fail('SYMLINK_OR_JUNCTION_REFUSED');
    if (stat && current !== file && !stat.isDirectory()) fail('DIRECTORY_REQUIRED');
    if (path.dirname(current) === current) break;
  }
}
const sameFile = (a,b) => a.dev === b.dev && a.ino === b.ino;
const signature = stat => [stat.dev, stat.ino, stat.size, stat.mtimeMs, stat.ctimeMs].join(':');
function readBounded(file, maximum) {
  noLinks(file); const before = fs.lstatSync(file);
  if (!before.isFile() || before.size > maximum) fail('BOUNDED_REGULAR_FILE_REQUIRED');
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const opened = fs.fstatSync(fd); noLinks(file);
    if (!opened.isFile() || !sameFile(before,opened) || !sameFile(opened,fs.lstatSync(file))) fail('SOURCE_CHANGED_DURING_READ');
    const chunks = [], buffer = Buffer.alloc(Math.min(maximum + 1,64 * 1024)); let count = 0, size = 0;
    while ((count = fs.readSync(fd,buffer,0,buffer.length,null))) {size += count; if (size > maximum) fail('FILE_SIZE_LIMIT'); chunks.push(Buffer.from(buffer.subarray(0,count)));}
    const bytes = Buffer.concat(chunks,size), after = fs.fstatSync(fd); noLinks(file);
    if (bytes.length > maximum || !sameFile(opened,fs.lstatSync(file)) || signature(opened) !== signature(after) || bytes.length !== after.size) fail('SOURCE_CHANGED_DURING_READ');
    return {bytes, stat:after};
  } finally {fs.closeSync(fd);}
}
function keys(value, required, optional = []) {
  if (!plain(value) || required.some(key => !Object.hasOwn(value,key)) || Object.keys(value).some(key => !required.includes(key) && !optional.includes(key))) fail('UNEXPECTED_CONFIG_FIELDS');
}
function validId(value) {return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,109}$/.test(value) && !BLOCKED.has(value);}
function validateConfig(value, configFile) {
  inspect(value); keys(value,['version','sources','output','intervalSeconds']);
  if (value.version !== 1 || !Number.isSafeInteger(value.intervalSeconds) || value.intervalSeconds < 30 || value.intervalSeconds > 3600 || !Array.isArray(value.sources) || !value.sources.length || value.sources.length > 32) fail('INVALID_READER_CONFIG');
  const output = absoluteLocal(value.output), seen = new Set(), pathKey = file => process.platform === 'win32' ? file.toLowerCase() : file;
  const paths = new Set([pathKey(output),pathKey(configFile)]);
  if (pathKey(output) === pathKey(configFile)) fail('OUTPUT_CANNOT_REPLACE_CONFIG');
  const sources = value.sources.map(source => {
    keys(source,['id','label','projectId','provider','path'],['url']);
    if (!validId(source.id) || /:part\d{4,}$/.test(source.id) || !validId(source.projectId) || typeof source.label !== 'string' || !source.label.trim() || source.label.length > 260 || !['codex-jsonl','claude-jsonl','feed-json'].includes(source.provider) || seen.has(source.id)) fail('INVALID_SELECTED_SOURCE');
    if (source.url !== undefined) core.validateFeed({format:'city-light-history-feed',version:1,source:{id:source.id,label:source.label,revision:1,updatedAt:'1970-01-01T00:00:00Z',kind:'chat',url:source.url},records:[]},[source.projectId]);
    const file = absoluteLocal(source.path); if (paths.has(pathKey(file))) fail('SOURCE_OUTPUT_OR_DUPLICATE_PATH_CONFLICT');
    seen.add(source.id); paths.add(pathKey(file)); noLinks(file); return {...source,path:file};
  });
  noLinks(output); if (!fs.statSync(path.dirname(output)).isDirectory()) fail('OUTPUT_PARENT_REQUIRED');
  return {version:1,sources,output,intervalSeconds:value.intervalSeconds};
}
function inertText(text, limit) {
  return String(text).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g,' ').replace(/</g,'‹').replace(/>/g,'›')
    .replace(/\b(javascript|vbscript|data)\s*:/gi,'$1∶').trim().slice(0,limit).replace(/[\uD800-\uDBFF]$/,'');
}
function eventDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2}))?$/.test(value)) return null;
  const day = value.slice(0,10), parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(day + 'T00:00:00Z').toISOString().slice(0,10) !== day || (value.length > 10 && !/T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d/.test(value))) return null;
  return value;
}
function messageRecord(value, source) {
  let message, nativeId, timestamp;
  if (source.provider === 'codex-jsonl') {
    if (value.type !== 'response_item' || value.payload?.type !== 'message') return null;
    message = value.payload; nativeId = message.id; timestamp = value.timestamp;
    if (['analysis','reasoning'].includes(message.channel) || ['analysis','reasoning'].includes(message.phase)) return null;
  } else {
    if (!['user','assistant'].includes(value.type) || !plain(value.message)) return null;
    message = value.message; nativeId = value.uuid || message.id; timestamp = value.timestamp;
  }
  const role = message.role; if (!['user','assistant'].includes(role)) return null;
  const content = message.content;
  const text = typeof content === 'string' ? content : Array.isArray(content) ? content.filter(part => plain(part) && ['text','input_text','output_text'].includes(part.type) && typeof part.text === 'string').map(part => part.text).join('\n') : '';
  if (!text.trim()) return null;
  const date = eventDate(timestamp), id = 'msg:' + hash(nativeId ? 'native:' + String(nativeId) : serialize({timestamp:timestamp ?? null,role,text}));
  const detail = inertText(text,NATIVE_DETAIL), first = detail.split(/\r?\n/).find(line => line.trim()) || role;
  return {id,projectId:source.projectId,title:inertText((role === 'assistant' ? 'Assistant: ' : 'User: ') + first,180),detail,date,status:'observation',
    scope:'Imported chat message excerpt (up to 900 characters); reported information, not an accepted achievement. Full text remains in the selected transcript.',evidence:['Source: ' + source.id,'Message: ' + id]};
}
function prefixString(head,key) {
  const match = head.match(new RegExp('"'+key+'"\\s*:\\s*("(?:[^"\\\\]|\\\\.)*")'));
  if (!match) return null;
  try {return JSON.parse(match[1]);} catch (_) {return null;}
}
function oversizedMessage(prefix, source, digest, bytes) {
  const head=prefix.toString('utf8').replace(/^\uFEFF/,''), role=prefixString(head,'role');
  const codex=source.provider==='codex-jsonl';
  const header=head.slice(0,4096),payload=header.slice(header.search(/"payload"\s*:/));
  const visible=codex ? prefixString(header,'type')==='response_item' && prefixString(payload,'type')==='message' : ['user','assistant'].includes(prefixString(header,'type')) && /"message"\s*:/.test(header);
  if (!visible || !['user','assistant'].includes(role) || /"(?:channel|phase)"\s*:\s*"(?:analysis|reasoning)"/.test(head)) return null;
  const nativeId=prefixString(head,codex?'id':'uuid'), id='msg:'+hash(nativeId?'native:'+nativeId:'oversized-line:'+digest);
  return {id,projectId:source.projectId,title:'Transcript message exceeds the 128 KiB line limit',detail:'A visible '+role+' message ('+bytes+' bytes) was too large to parse safely. Its text is not imported. Read the original selected chat for the complete message. Other visible messages continue to import.',date:eventDate(prefixString(head,'timestamp')),status:'observation',scope:'Oversized visible-message diagnostic; incomplete coverage, not an accepted achievement.',evidence:['Source: '+source.id,'Message: '+id]};
}
function anchor(fd,end) {
  const size=Math.min(READ_BUFFER,end), head=Buffer.alloc(size), tail=Buffer.alloc(size);
  if(size && (fs.readSync(fd,head,0,size,0)!==size || fs.readSync(fd,tail,0,size,end-size)!==size)) fail('SOURCE_CHANGED_DURING_READ');
  return {head:hash(head),tail:hash(tail)};
}
function readNative(source,cached) {
  noLinks(source.path); const before=fs.lstatSync(source.path);
  if(!before.isFile())fail('BOUNDED_REGULAR_FILE_REQUIRED');
  const fd=fs.openSync(source.path,fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0)), started=Date.now();
  try {
    const opened=fs.fstatSync(fd);noLinks(source.path);
    if(!opened.isFile() || !sameFile(before,opened) || !sameFile(opened,fs.lstatSync(source.path)))fail('SOURCE_CHANGED_DURING_READ');
    let append=!!cached?.native && sameFile(cached.native.stat,opened) && opened.size>cached.native.stat.size && cached.native.offset<=opened.size;
    if(append){const pins=anchor(fd,cached.native.offset);append=pins.head===cached.native.anchors.head && pins.tail===cached.native.anchors.tail;}
    if(opened.size-(append?cached.native.offset:0)>MAX_NATIVE)fail('NATIVE_PASS_BYTE_LIMIT: maximum is 1 GiB per pass; an existing larger file requires a bounded export');
    const boundaryPins=anchor(fd,opened.size);
    const records=append?new Map(cached.records.map(record=>[record.id,record])):new Map();
    const totals=append?{...cached.native.totals}:{lines:0,oversizedRecords:0,oversizedVisibleMessages:0,oversizedOtherRecords:0,truncatedExcerpts:0};
    let updatedAt=append?cached.updatedAt:undefined,offset=append?cached.native.offset:0,lineBytes=0,prefixSize=0,completeOffset=offset,bytesRead=0,incompleteTail=false;
    const buffer=Buffer.alloc(READ_BUFFER),prefix=Buffer.alloc(MAX_LINE);let digest=createHash('sha256');
    function retain(record){if(!record)return;records.set(record.id,record);if(records.size>MAX_RECORDS)fail('SOURCE_MESSAGE_LIMIT');if(record.date&&record.date.length>10&&(!updatedAt||Date.parse(record.date)>Date.parse(updatedAt)))updatedAt=record.date;}
    function consume(part){lineBytes+=part.length;digest.update(part);const length=Math.min(part.length,MAX_LINE-prefixSize);if(length){part.copy(prefix,prefixSize,0,length);prefixSize+=length;}if(lineBytes>MAX_LINE){const rest=part.subarray(length),tailSize=4096,tailStart=MAX_LINE-tailSize;if(rest.length>=tailSize)rest.copy(prefix,tailStart,rest.length-tailSize);else if(rest.length){prefix.copy(prefix,tailStart,tailStart+rest.length,MAX_LINE);rest.copy(prefix,MAX_LINE-rest.length);}}}
    function complete(tail=false){
      if(lineBytes>MAX_LINE){
        if(tail){incompleteTail=true;return;}
        const record=oversizedMessage(prefix.subarray(0,prefixSize),source,digest.digest('hex'),lineBytes);totals.oversizedRecords++;if(record){totals.oversizedVisibleMessages++;retain(record);}else totals.oversizedOtherRecords++;
      }else if(prefixSize){
        const bytes=prefix.subarray(0,prefixSize),raw=bytes.toString('utf8');if(raw.trim()){
          let value;try{value=parse(bytes);}catch(error){if(tail&&error.message==='INVALID_UTF8_JSON'){incompleteTail=true;return;}throw error;}
          const record=messageRecord(value,source);retain(record);
          if(!tail&&record&&record.detail.length>=NATIVE_DETAIL)totals.truncatedExcerpts++;
        }
      }
      if(!tail)totals.lines++;
    }
    while(offset<opened.size){
      if(Date.now()-started>MAX_NATIVE_MS)fail('NATIVE_PASS_TIME_LIMIT: previous output retained');
      const count=fs.readSync(fd,buffer,0,Math.min(buffer.length,opened.size-offset),offset);if(!count)fail('SOURCE_CHANGED_DURING_READ');bytesRead+=count;
      let start=0,index;
      while((index=buffer.indexOf(10,start))!==-1&&index<count){consume(buffer.subarray(start,index));complete();completeOffset=offset+index+1;lineBytes=0;prefixSize=0;digest=createHash('sha256');start=index+1;}
      if(start<count)consume(buffer.subarray(start,count));offset+=count;
    }
    if(lineBytes)complete(true);
    const after=fs.fstatSync(fd);noLinks(source.path);
    if(after.size<opened.size || (after.size===opened.size && signature(opened)!==signature(after)) || !sameFile(opened,fs.lstatSync(source.path)))fail('SOURCE_CHANGED_DURING_READ');
    const checkedPins=anchor(fd,opened.size);
    if(checkedPins.head!==boundaryPins.head || checkedPins.tail!==boundaryPins.tail)fail('SOURCE_CHANGED_DURING_READ');
    const anchors=anchor(fd,completeOffset);
    const final=fs.fstatSync(fd);
    if(final.size<after.size || (final.size===after.size && signature(after)!==signature(final)) || !sameFile(opened,fs.lstatSync(source.path)))fail('SOURCE_CHANGED_DURING_READ');
    const diagnostics={mode:append?'append':'full',bytesRead,visibleMessages:records.size,...totals,incompleteTail,readBufferBytes:READ_BUFFER,lineBufferBytes:MAX_LINE,frozenBoundaryBytes:opened.size,sourceBytesAtFinish:final.size,appendedDuringRead:final.size>opened.size};
    // Keep the frozen stat, not the later appended size: the next pass must read those bytes.
    return {records:[...records.values()],kind:'chat',updatedAt:updatedAt||opened.mtime.toISOString(),...(source.url!==undefined?{url:source.url}:{}),signature:signature(opened),diagnostics,native:{stat:opened,offset:completeOffset,anchors,totals}};
  }finally{fs.closeSync(fd);}
}
function readSource(source,cached) {
  if(source.provider!=='feed-json')return readNative(source,cached);
  const read = readBounded(source.path,2 * 1024 * 1024);
  if (source.provider === 'feed-json') {
    const feed = core.validateFeed(parse(read.bytes),[source.projectId]);
    if (feed.source.id !== source.id) fail('STRUCTURED_SOURCE_ID_MISMATCH');
    const inputCursor={id:source.id,mappedSourceId:source.id,inputSourceId:feed.source.id,inputRevision:feed.source.revision,inputFingerprint:hash(Buffer.from(JSON.stringify(canonical(feed)),'utf8')),inputUpdatedAt:feed.source.updatedAt};
    return {records:feed.records,kind:feed.source.kind,updatedAt:feed.source.updatedAt,url:feed.source.url,inputCursor,signature:signature(read.stat)};
  }
}
function chunkSource(source,sourceId) {
  if (source.provider === 'feed-json') return sourceId === source.id;
  return sourceId.startsWith(source.id + ':part') && /^\d{4,}$/.test(sourceId.slice(source.id.length + 5));
}
function previousOutput(config) {
  if (!fs.existsSync(config.output)) return {container:{format:'city-light-history-feeds',version:1,feeds:[]},read:null};
  const read = readBounded(config.output,MAX_CONTAINER), value = parse(read.bytes);
  const checked=core.validateContainer(value,[...new Set(config.sources.map(source=>source.projectId))]);
  const seen = new Set(), feeds = checked.feeds.map(feed => {
    const source = config.sources.find(selected => chunkSource(selected,feed?.source?.id)); if (!source || seen.has(feed.source.id)) fail('OUTPUT_SOURCE_NOT_CONFIGURED');
    seen.add(feed.source.id); return core.validateFeed(feed,[source.projectId]);
  });
  const cursors=checked.readerInputCursors;
  for(const cursor of cursors||[]){const source=config.sources.find(source=>source.id===cursor.id);if(!source||source.provider!=='feed-json'||cursor.mappedSourceId!==source.id||cursor.inputSourceId!==source.id)fail('OUTPUT_INPUT_CURSOR_NOT_CONFIGURED');}
  return {container:{format:value.format,version:1,feeds,...(cursors?{readerInputCursors:cursors}:{})},rawFeeds:value.feeds,read};
}
function sourceFeeds(source,read,previous,inputCursor) {
  if(source.provider==='feed-json'){
    if(previous.length&&!inputCursor)fail('STRUCTURED_INPUT_CURSOR_MISSING: previous output retained; verify current structured input and explicitly run --initialize-structured-cursors without resetting its output path');
    if(inputCursor){
      if(read.inputCursor.inputRevision<inputCursor.inputRevision)fail('STALE_STRUCTURED_INPUT_REVISION');
      if(read.inputCursor.inputRevision===inputCursor.inputRevision&&read.inputCursor.inputFingerprint!==inputCursor.inputFingerprint)fail('CONFLICTING_STRUCTURED_INPUT_REVISION');
      if(Date.parse(read.inputCursor.inputUpdatedAt)<Date.parse(inputCursor.inputUpdatedAt))fail('STRUCTURED_INPUT_DATE_WENT_BACKWARDS');
    }
  }
  previous = [...previous].sort((a,b) => a.source.id.localeCompare(b.source.id));
  if (source.provider !== 'feed-json') previous.forEach((feed,index) => {if (feed.source.id !== source.id + ':part' + String(index + 1).padStart(4,'0')) fail('NONCONTIGUOUS_OUTPUT_CHUNKS');});
  const pages = previous.map(feed => ({previous:feed,records:new Map(feed.records.map(record => [record.id,record]))}));
  const assigned = new Map(); pages.forEach((page,index) => page.records.forEach((_,id) => {if (assigned.has(id)) fail('DUPLICATE_STORED_MESSAGE'); assigned.set(id,index);}));
  for (const record of read.records) {
    if (assigned.has(record.id)) {pages[assigned.get(record.id)].records.set(record.id,record); continue;}
    if (!pages.length || (source.provider !== 'feed-json' && pages.at(-1).records.size >= CHUNK_RECORDS)) pages.push({records:new Map()});
    pages.at(-1).records.set(record.id,record); assigned.set(record.id,pages.length - 1);
    if (assigned.size > MAX_RECORDS) fail('RETAINED_SOURCE_HISTORY_LIMIT');
  }
  if (!pages.length) pages.push({records:new Map()});
  return pages.map((page,index) => {
    const id = source.provider === 'feed-json' ? source.id : source.id + ':part' + String(index + 1).padStart(4,'0');
    const prior = page.previous, records = [...page.records.values()], metadata = {id,label:source.label,kind:read.kind,...(read.url ? {url:read.url} : {})};
    if (prior && serialize(prior.records) === serialize(core.validateFeed({...prior,records},[source.projectId]).records) && serialize({...prior.source,revision:0,updatedAt:''}) === serialize({...metadata,revision:0,updatedAt:''})) return prior;
    const updatedAt = prior && Date.parse(prior.source.updatedAt) > Date.parse(read.updatedAt) ? prior.source.updatedAt : read.updatedAt;
    return core.validateFeed({format:'city-light-history-feed',version:1,source:{...metadata,revision:prior ? prior.source.revision + 1 : 1,updatedAt},records},[source.projectId]);
  });
}
function atomicOutput(config,container,priorRead) {
  const content = serialize(container), bytes = Buffer.from(content,'utf8'); if (bytes.length > MAX_CONTAINER) fail('OUTPUT_HISTORY_LIMIT_EXPORT_BEFORE_CONTINUING');
  if (priorRead && hash(priorRead.bytes) === hash(bytes)) return {status:'UNCHANGED',feeds:container.feeds.length,records:container.feeds.reduce((sum,feed) => sum + feed.records.length,0)};
  noLinks(config.output); const temporary = path.join(path.dirname(config.output),'.' + path.basename(config.output) + '.history-' + process.pid + '-' + randomBytes(6).toString('hex') + '.tmp');
  let fd;
  try {
    fd = fs.openSync(temporary,fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW || 0),0o600);
    fs.writeFileSync(fd,bytes); fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
    noLinks(config.output);
    if (priorRead) {
      const current = readBounded(config.output,MAX_CONTAINER); if (signature(current.stat) !== signature(priorRead.stat) || hash(current.bytes) !== hash(priorRead.bytes)) fail('OUTPUT_CHANGED_REFUSED');
    } else if (fs.existsSync(config.output)) fail('OUTPUT_APPEARED_REFUSED');
    fs.renameSync(temporary,config.output);
  } finally {if (fd !== undefined) fs.closeSync(fd); if (fs.existsSync(temporary)) fs.unlinkSync(temporary);}
  return {status:'UPDATED',feeds:container.feeds.length,records:container.feeds.reduce((sum,feed) => sum + feed.records.length,0),sha256:hash(bytes)};
}
function runOnce(config,cache = new Map()) {
  const previous = previousOutput(config), feeds = [], inputCursors=[], pendingCache=new Map(), diagnostics=[];
  for (const source of config.sources) {
    noLinks(source.path); const current = fs.lstatSync(source.path), cached = cache.get(source.id);
    const unchanged=cached && cached.signature===signature(current);
    const read = unchanged ? cached : readSource(source,cached);
    pendingCache.set(source.id,read);
    if(read.diagnostics)diagnostics.push({sourceId:source.id,...read.diagnostics,...(unchanged?{mode:'unchanged',bytesRead:0}:{})});
    feeds.push(...sourceFeeds(source,read,previous.container.feeds.filter(feed => chunkSource(source,feed.source.id)),previous.container.readerInputCursors?.find(cursor=>cursor.id===source.id)));
    if(read.inputCursor)inputCursors.push(read.inputCursor);
  }
  if (feeds.length > MAX_FEEDS || feeds.reduce((sum,feed) => sum + feed.records.length,0) > MAX_RECORDS) fail('OUTPUT_HISTORY_COUNT_LIMIT_EXPORT_BEFORE_CONTINUING');
  const result=atomicOutput(config,{format:'city-light-history-feeds',version:1,feeds,...(inputCursors.length?{readerInputCursors:inputCursors}:{})},previous.read);for(const [id,read]of pendingCache)cache.set(id,read);
  return {...result,diagnostics};
}
function initializeStructuredCursors(config) {
  const previous=previousOutput(config), selected=config.sources.filter(source=>source.provider==='feed-json');
  if(!previous.read)fail('STRUCTURED_CURSOR_INITIALIZATION_REQUIRES_EXISTING_OUTPUT');
  if(!selected.length)fail('NO_STRUCTURED_INPUTS_TO_INITIALIZE');
  const cursors=[...(previous.container.readerInputCursors||[])];
  for(const source of selected){
    const read=readSource(source), cursor=cursors.find(cursor=>cursor.id===source.id), retained=previous.container.feeds.filter(feed=>feed.source.id===source.id);
    if(cursor){if(serialize(cursor)!==serialize(read.inputCursor))fail('STRUCTURED_CURSOR_ALREADY_INITIALIZED: run the ordinary reader for a newer input; initialization cannot replace its cursor');continue;}
    if(retained.length!==1)fail('STRUCTURED_CURSOR_INITIALIZATION_REQUIRES_RETAINED_SOURCE');
    const prior=retained[0];
    if(serialize(prior.records)!==serialize(read.records)||prior.source.kind!==read.kind||prior.source.url!==read.url)fail('STRUCTURED_CURSOR_INITIALIZATION_SOURCE_MISMATCH: retained history is unchanged');
    if(Date.parse(read.updatedAt)<Date.parse(prior.source.updatedAt))fail('STRUCTURED_CURSOR_INITIALIZATION_DATE_WENT_BACKWARDS');
    cursors.push(read.inputCursor);
  }
  // Metadata-only initialization preserves the exact retained feeds and generated
  // output revisions, so an already imported world can continue the same lineage.
  const result=atomicOutput(config,{...previous.container,feeds:previous.rawFeeds,readerInputCursors:cursors},previous.read);
  return {...result,mode:'INITIALIZE_STRUCTURED_CURSORS',initialized:cursors.length-(previous.container.readerInputCursors?.length||0)};
}
function argumentsFor(args) {
  if (args.length === 1 && args[0] === '--help') return {help:true};
  if (![2,3].includes(args.length) || args[0] !== '--config' || !args[1] || (args.length === 3 && !['--once','--watch','--initialize-structured-cursors'].includes(args[2]))) fail('USAGE: use --help');
  return {config:absoluteLocal(args[1]),watch:args[2] === '--watch',initializeStructured:args[2] === '--initialize-structured-cursors'};
}
function main(args = process.argv.slice(2)) {
  const options = argumentsFor(args); if (options.help) return {help:HELP};
  const config = validateConfig(parse(readBounded(options.config,MAX_CONFIG).bytes),options.config), cache = new Map();
  if(options.initializeStructured)return initializeStructuredCursors(config);
  const first = runOnce(config,cache); if (!options.watch) return first;
  process.stdout.write(serialize({...first,watching:true,intervalSeconds:config.intervalSeconds}));
  let outputStamp = signature(fs.lstatSync(config.output)), lastError;
  const timer = setInterval(() => {
    try {
      noLinks(config.output);
      const unchanged = signature(fs.lstatSync(config.output)) === outputStamp && config.sources.every(source => {noLinks(source.path); return cache.get(source.id)?.signature === signature(fs.lstatSync(source.path));});
      if (unchanged) return;
      const result = runOnce(config,cache); outputStamp = signature(fs.lstatSync(config.output)); lastError = undefined;
      if (result.status !== 'UNCHANGED') process.stdout.write(serialize(result));
    } catch (error) {if (lastError !== error.message) process.stderr.write('ERROR: ' + error.message + '; previous output retained\n'); lastError = error.message;}
  },config.intervalSeconds * 1000);
  const stop = () => {clearInterval(timer); process.removeListener('SIGINT',stop); process.removeListener('SIGTERM',stop);};
  process.once('SIGINT',stop); process.once('SIGTERM',stop);
  return {watching:true,stop};
}
if (require.main === module) {
  try {const result = main(); if (!result.watching) process.stdout.write(result.help || serialize(result));}
  catch (error) {process.stderr.write('ERROR: ' + error.message + '; no output replaced\n'); process.exitCode = 1;}
}
module.exports = {main,argumentsFor,validateConfig,readSource,messageRecord,runOnce,initializeStructuredCursors,inertText,eventDate};
