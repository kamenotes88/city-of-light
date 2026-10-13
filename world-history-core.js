(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TownHistoryCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const MAX_BYTES = 2 * 1024 * 1024, MAX_RECORDS = 10000, MAX_SOURCES = 1000;
  const unsafe = new Set(['__proto__', 'constructor', 'prototype']);
  const statuses = ['observation', 'accepted_local', 'pending', 'blocked', 'stop', 'revoked'];
  const objectPrototypes = new WeakSet([Object.prototype]), arrayPrototypes = new WeakSet([Array.prototype]);
  function plainObjectPrototype(proto) {
    if (proto === null || objectPrototypes.has(proto)) return true;
    const constructor = Object.getOwnPropertyDescriptor(proto, 'constructor')?.value;
    if (Object.getPrototypeOf(proto) !== null || typeof constructor !== 'function' || Function.prototype.toString.call(constructor) !== 'function Object() { [native code] }' || Reflect.ownKeys(proto).length !== Reflect.ownKeys(Object.prototype).length || Reflect.ownKeys(proto).some(key => !Object.hasOwn(Object.prototype, key))) return false;
    objectPrototypes.add(proto); return true;
  }
  function plainArrayPrototype(proto) {
    if (arrayPrototypes.has(proto)) return true;
    const constructor = proto && Object.getOwnPropertyDescriptor(proto, 'constructor')?.value;
    if (!Array.isArray(proto) || !plainObjectPrototype(Object.getPrototypeOf(proto)) || typeof constructor !== 'function' || Function.prototype.toString.call(constructor) !== 'function Array() { [native code] }') return false;
    arrayPrototypes.add(proto); return true;
  }
  function fail(message) { throw Error('History import: ' + message + '. World is unchanged.'); }
  function inspect(value) {
    const seen = new Set(); let count = 0;
    function visit(item, depth) {
      if (++count > 1000000 || depth > 80) fail('JSON complexity limit exceeded');
      if (item === null || typeof item === 'string' || typeof item === 'boolean') return;
      if (typeof item === 'number') { if (!Number.isFinite(item)) fail('Non-finite number'); return; }
      if (typeof item !== 'object') fail('Only JSON data is allowed');
      if (seen.has(item)) fail('Cyclic JSON');
      seen.add(item);
      const array = Array.isArray(item), proto = Object.getPrototypeOf(item);
      if ((!array && !plainObjectPrototype(proto)) || (array && !plainArrayPrototype(proto))) fail('Non-JSON object');
      for (const key of Reflect.ownKeys(item)) {
        if (array && key === 'length') continue;
        const descriptor = Object.getOwnPropertyDescriptor(item, key);
        if (typeof key !== 'string' || unsafe.has(key) || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) fail('Unsafe JSON field');
        if (array && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= item.length)) fail('Unexpected array field');
        visit(descriptor.value, depth + 1);
      }
      if (array && Object.keys(item).length !== item.length) fail('Sparse array');
      seen.delete(item);
    }
    visit(value, 0);
  }
  function shape(value, required, optional, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail('Invalid ' + label);
    if (Object.keys(value).some(key => !required.includes(key) && !optional.includes(key)) || required.some(key => !Object.hasOwn(value, key))) fail('Unexpected ' + label + ' fields');
  }
  function id(value, label) {
    if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value) || unsafe.has(value)) fail('Invalid ' + label + ' ID');
    return value;
  }
  function text(value, label, max, nonempty = true) {
    if (typeof value !== 'string' || value.length > max || (nonempty && !value.trim()) || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value) || /<\s*script\b|(?:javascript|vbscript)\s*:|data\s*:\s*(?:text\/html|application\/javascript)/i.test(value)) fail('Invalid ' + label + ' text');
    return value;
  }
  function date(value, label, optional = true) {
    if (optional && (value === null || value === '')) return null;
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2}))?$/.test(value) || (!optional && value.length < 20)) fail('Invalid ' + label + ' date');
    const day = value.slice(0, 10), parsed = Date.parse(value);
    if (!Number.isFinite(parsed) || new Date(day + 'T00:00:00Z').toISOString().slice(0, 10) !== day) fail('Invalid ' + label + ' date');
    if (value.length > 10 && !/T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d/.test(value)) fail('Invalid ' + label + ' time');
    return value;
  }
  function url(value) {
    text(value, 'source URL', 4000);
    if (value.trim() !== value || /[\s\\]/.test(value)) fail('Invalid source URL');
    let parsed; try { parsed = new URL(value); } catch (_) { fail('Invalid source URL'); }
    if (!['http:', 'https:', 'codex:', 'page:'].includes(parsed.protocol) || parsed.username || parsed.password || !parsed.hostname) fail('Unsafe source URL');
    return value;
  }
  function sourceCheck(source) {
    shape(source, ['id', 'label', 'revision', 'updatedAt', 'kind'], ['url'], 'source');
    id(source.id, 'source'); text(source.label, 'source label', 300);
    if (!Number.isSafeInteger(source.revision) || source.revision < 1) fail('Invalid source revision');
    date(source.updatedAt, 'source', false);
    if (!['chat', 'document', 'timeline'].includes(source.kind)) fail('Invalid source kind');
    if (source.url !== undefined) url(source.url);
    return {...source};
  }
  function evidenceReference(value) {
    text(value, 'evidence reference', 4000);
    if (/^(?:https?|codex|page):/i.test(value)) url(value);
    else if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) fail('Unsafe evidence reference URL');
    return value;
  }
  function projectSet(projects, required = true) {
    if (projects === undefined && !required) return null;
    if (!Array.isArray(projects)) fail('Explicit project mapping is required');
    inspect(projects);
    if (!Array.isArray(projects) || projects.length > 1000 || (required && !projects.length)) fail('Explicit project mapping is required');
    const ids = projects.map(project => id(typeof project === 'string' ? project : project?.id, 'project'));
    if (new Set(ids).size !== ids.length) fail('Duplicate project mapping');
    return new Set(ids);
  }
  function recordCheck(record, projects) {
    shape(record, ['id', 'projectId', 'title', 'detail', 'date', 'status', 'scope', 'evidence'], ['stage'], 'record');
    id(record.id, 'record'); id(record.projectId, 'project');
    if (projects && !projects.has(record.projectId)) fail('Record belongs to an unknown project');
    text(record.title, 'record title', 400); text(record.detail, 'record detail', 16000, false); text(record.scope, 'record scope', 1600);
    if (!statuses.includes(record.status)) fail('Invalid record status');
    if (record.stage !== undefined && !['made', 'applied', 'effect'].includes(record.stage)) fail('Invalid record stage');
    if (!Array.isArray(record.evidence) || record.evidence.length > 24) fail('Invalid evidence references');
    record.evidence.forEach(evidenceReference);
    // Evidence is never fetched, interpreted as markup or promoted to an achievement.
    return {...record, date:date(record.date, 'record'), evidence:[...new Set(record.evidence)].sort()};
  }
  function canonical(value) {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
    return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  }
  // Synchronous SHA-256 keeps import atomic in browsers and Node, without a dependency.
  // This digest identifies bytes/content; it does not authenticate source claims.
  function fingerprint(value) {
    const bytes = new TextEncoder().encode(canonical(value)), size = Math.ceil((bytes.length + 9) / 64) * 64;
    const padded = new Uint8Array(size); padded.set(bytes); padded[bytes.length] = 128;
    const view = new DataView(padded.buffer); view.setUint32(size - 8, Math.floor(bytes.length / 0x20000000)); view.setUint32(size - 4, bytes.length * 8);
    const primes = [], constants = [], initial = [];
    for (let n = 2; primes.length < 64; n++) if (!primes.some(p => p * p <= n && n % p === 0)) {
      primes.push(n); constants.push((Math.cbrt(n) % 1 * 0x100000000) | 0);
      if (initial.length < 8) initial.push((Math.sqrt(n) % 1 * 0x100000000) | 0);
    }
    const hash = initial, words = new Int32Array(64), rotate = (n, bits) => (n >>> bits) | (n << (32 - bits));
    for (let offset = 0; offset < size; offset += 64) {
      for (let i = 0; i < 16; i++) words[i] = view.getInt32(offset + i * 4);
      for (let i = 16; i < 64; i++) { const a = words[i - 15], b = words[i - 2]; words[i] = ((rotate(a, 7) ^ rotate(a, 18) ^ (a >>> 3)) + words[i - 16] + (rotate(b, 17) ^ rotate(b, 19) ^ (b >>> 10)) + words[i - 7]) | 0; }
      let [a,b,c,d,e,f,g,h] = hash;
      for (let i = 0; i < 64; i++) {
        const t1 = (h + (rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25)) + ((e & f) ^ (~e & g)) + constants[i] + words[i]) | 0;
        const t2 = ((rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
        h=g; g=f; f=e; e=(d+t1)|0; d=c; c=b; b=a; a=(t1+t2)|0;
      }
      [a,b,c,d,e,f,g,h].forEach((word, i) => { hash[i] = (hash[i] + word) | 0; });
    }
    return hash.map(word => (word >>> 0).toString(16).padStart(8, '0')).join('');
  }
  function validateFeed(feed, projects) {
    inspect(feed);
    if (new TextEncoder().encode(JSON.stringify(feed)).length > MAX_BYTES) fail('Feed exceeds 2 MiB');
    shape(feed, ['format', 'version', 'source', 'records'], [], 'feed');
    if (feed.format !== 'city-light-history-feed' || feed.version !== 1) fail('Unsupported feed format');
    const ids = projectSet(projects), source = sourceCheck(feed.source);
    if (!Array.isArray(feed.records) || feed.records.length > MAX_RECORDS) fail('Invalid record count');
    const records = feed.records.map(record => recordCheck(record, ids)), seen = new Set();
    for (const record of records) { if (seen.has(record.id)) fail('Duplicate record ID within source'); seen.add(record.id); }
    records.sort((a,b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    return {format:feed.format, version:1, source, records};
  }
  function stored(data, projects) {
    inspect(data);
    if (!data || typeof data !== 'object' || Array.isArray(data) || !Array.isArray(data.history)) fail('Invalid world history');
    const ids = projectSet(projects, false), imports = Object.hasOwn(data, 'historyImports') ? data.historyImports : {version:1, sources:[]};
    shape(imports, ['version', 'sources'], [], 'history cursors');
    if (imports.version !== 1 || !Array.isArray(imports.sources) || imports.sources.length > MAX_SOURCES) fail('Invalid history cursors');
    const cursors = new Map();
    for (const cursor of imports.sources) {
      shape(cursor, ['id', 'label', 'revision', 'updatedAt', 'kind', 'fingerprint'], ['url'], 'source cursor');
      const {fingerprint: hash, ...source} = cursor; sourceCheck(source);
      if (!/^[a-f0-9]{64}$/.test(hash) || cursors.has(source.id)) fail('Invalid source cursor');
      cursors.set(source.id, cursor);
    }
    const latest = new Map(), imported = [], rowIds = new Set();
    for (const row of data.history) {
      if (!row || row.type !== 'imported_history') continue;
      shape(row, ['id', 'type', 'sourceId', 'recordId', 'sourceRevision', 'source', 'projectId', 'title', 'detail', 'date', 'status', 'scope', 'evidence'], ['stage'], 'stored record');
      const {id: rowId, type, sourceId, recordId, sourceRevision, source, ...fields} = row;
      sourceCheck(source); id(sourceId, 'source'); id(recordId, 'record');
      if (source.id !== sourceId || source.revision !== sourceRevision || !cursors.has(sourceId) || sourceRevision > cursors.get(sourceId).revision || rowId !== entryId(sourceId, recordId, sourceRevision) || rowIds.has(rowId)) fail('Invalid stored record binding');
      rowIds.add(rowId); recordCheck({...fields, id:recordId}, ids);
      const key = JSON.stringify([sourceId, recordId]), previous = latest.get(key);
      if (previous && previous.projectId !== row.projectId) fail('Stored record project changed');
      if (!previous || previous.sourceRevision < sourceRevision) latest.set(key, row);
      imported.push(row);
    }
    if (imported.length > MAX_RECORDS) fail('Imported history exceeds 10000 revisions; export history before continuing');
    return {imports, cursors, latest, imported};
  }
  function entryId(sourceId, recordId, revision) { return 'history:' + encodeURIComponent(sourceId) + ':' + encodeURIComponent(recordId) + ':r' + revision; }
  function recordFromRow(row) {
    const record = {id:row.recordId, projectId:row.projectId, title:row.title, detail:row.detail, date:row.date, status:row.status, scope:row.scope, evidence:row.evidence};
    if (row.stage !== undefined) record.stage = row.stage;
    return record;
  }
  function merge(data, input, projects) {
    const feed = validateFeed(input, projects), existing = stored(data, projects), hash = fingerprint(feed), cursor = existing.cursors.get(feed.source.id);
    if (cursor && feed.source.revision < cursor.revision) fail('Stale source revision');
    if (cursor && feed.source.revision === cursor.revision) {
      if (hash !== cursor.fingerprint) fail('Conflicting content for the same source revision');
      return {data, added:0, unchanged:feed.records.length, sourceId:feed.source.id, revision:feed.source.revision};
    }
    if (cursor && Date.parse(feed.source.updatedAt) < Date.parse(cursor.updatedAt)) fail('Source date went backwards');
    if (!cursor && existing.cursors.size >= MAX_SOURCES) fail('Source limit reached');
    const additions = []; let unchanged = 0;
    for (const record of feed.records) {
      const previous = existing.latest.get(JSON.stringify([feed.source.id, record.id]));
      if (previous && previous.projectId !== record.projectId) fail('Record cannot move to a different project');
      if (previous && canonical(recordFromRow(previous)) === canonical(record)) { unchanged++; continue; }
      const {id:recordId, ...fields} = record;
      additions.push({id:entryId(feed.source.id, recordId, feed.source.revision), type:'imported_history', sourceId:feed.source.id, recordId, sourceRevision:feed.source.revision, source:{...feed.source}, ...fields});
    }
    if (existing.imported.length + additions.length > MAX_RECORDS) fail('Imported history exceeds 10000 revisions; export history before continuing');
    const nextCursor = {...feed.source, fingerprint:hash};
    const sources = existing.imports.sources.filter(source => source.id !== feed.source.id).map(source => ({...source})); sources.push(nextCursor); sources.sort((a,b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    return {data:{...data, history:[...data.history, ...additions], historyImports:{version:1, sources}}, added:additions.length, unchanged, sourceId:feed.source.id, revision:feed.source.revision};
  }
  function entries(data, projects) {
    const rows = [...stored(data, projects).latest.values()].map(row => JSON.parse(JSON.stringify(row)));
    rows.sort((a,b) => (a.date === null) - (b.date === null) || (a.date && b.date ? Date.parse(b.date) - Date.parse(a.date) : 0) || a.id.localeCompare(b.id));
    return rows;
  }
  function summary(data, projectId) {
    const rows = entries(data).filter(row => !projectId || row.projectId === projectId);
    const counts = {total:rows.length, acceptedLocal:0, pending:0, blocked:0, stop:0, revoked:0, observations:0, sourceCount:new Set(rows.map(row => row.sourceId)).size, latestDate:null, unknownDates:0};
    const names = {accepted_local:'acceptedLocal', observation:'observations', pending:'pending', blocked:'blocked', stop:'stop', revoked:'revoked'};
    for (const row of rows) { counts[names[row.status]]++; if (row.date === null) counts.unknownDates++; else if (counts.latestDate === null || Date.parse(row.date) > Date.parse(counts.latestDate)) counts.latestDate = row.date; }
    return counts;
  }
  return Object.freeze({version:1, MAX_BYTES, MAX_RECORDS, MAX_SOURCES, validateFeed, merge, entries, summary});
});
