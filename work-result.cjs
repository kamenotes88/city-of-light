'use strict';
// Produce a data-only claim. This command never imports it into a world.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const {createHash, webcrypto} = require('node:crypto');
const MAX_JSON = 256 * 1024, MAX_FILE = 50 * 1024 * 1024;
const BINDINGS = ['worldId', 'projectId', 'goalVersion', 'planVersion'];
const REQUEST_KEYS = ['format', 'version', ...BINDINGS, 'name', 'goal', 'criterion', 'nextStep', 'blocker'];
const PAYLOAD = ['Start.html', 'README.txt', 'INSTALL.md', 'setup-world.cjs', 'install-world.py', 'project-world-skill.md', 'extensions.json', 'LICENSE', 'NOTICE', 'work-result.cjs', 'work-report.schema.json'];
const HELP = 'City of Light local work result\n\n' +
  'node work-result.cjs --request <request.json> --claim <claim.json> --output <new-report.json> [--artifact <local-file>]\n' +
  'node work-result.cjs --check <report.json>\n\n' +
  'Use the selected-project request exported by your city. Claims supply reportId, artifactId, date, title, scope, stage, evidence, nextStep, blocker and completesGoal.\n' +
  'The request alone supplies world/project IDs and goal/plan versions. Evidence URLs must come from your actual source; no URLs are invented or fetched.\n' +
  'An optional regular local artifact is measured with SHA-256 (up to 50 MiB); its contents are never printed.\n' +
  'Existing output is never overwritten. A report is a claim awaiting separate owner review, not an accepted result.\n';
const fail = code => {throw Error(code);};
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const plain = value => value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const canonical = value => Array.isArray(value) ? value.map(canonical) : plain(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const json = value => JSON.stringify(canonical(value), null, 2) + '\n';
function localPath(value) {
  if (typeof value !== 'string' || !value || value.includes('\0') || /^(?:\\\\|\/\/|[a-z][a-z0-9+.-]*:\/\/)/i.test(value)) fail('LOCAL_PATH_REQUIRED');
  return path.resolve(value);
}
function noLinks(file) {
  let current = file;
  for (;;) {
    let stat; try {stat = fs.lstatSync(current);} catch (error) {if (error.code !== 'ENOENT') throw error;}
    if (stat?.isSymbolicLink()) fail('SYMLINK_OR_JUNCTION_REFUSED');
    if (stat && current !== file && !stat.isDirectory()) fail('DIRECTORY_REQUIRED');
    const parent = path.dirname(current); if (parent === current) return; current = parent;
  }
}
function sameFile(a, b) {return a.dev === b.dev && a.ino === b.ino;}
function readBounded(file, limit) {
  file = localPath(file); noLinks(file);
  const before = fs.lstatSync(file); if (!before.isFile() || before.size > limit) fail('BOUNDED_REGULAR_FILE_REQUIRED');
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0)), chunks = []; let size = 0;
  try {
    const opened = fs.fstatSync(fd); noLinks(file);
    if (!opened.isFile() || !sameFile(before, opened) || !sameFile(opened, fs.lstatSync(file))) fail('FILE_CHANGED_DURING_READ');
    const buffer = Buffer.alloc(Math.min(64 * 1024, limit + 1)); let read;
    while ((read = fs.readSync(fd, buffer, 0, buffer.length, null))) {size += read; if (size > limit) fail('FILE_SIZE_LIMIT'); chunks.push(Buffer.from(buffer.subarray(0, read)));}
    const after = fs.fstatSync(fd); noLinks(file);
    if (!sameFile(opened, fs.lstatSync(file)) || after.size !== size || opened.size !== after.size || opened.mtimeMs !== after.mtimeMs) fail('FILE_CHANGED_DURING_READ');
    return Buffer.concat(chunks, size);
  } finally {fs.closeSync(fd);}
}
function parseJSON(bytes) {
  try {return JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes).replace(/^\uFEFF/, ''));} catch (_) {fail('INVALID_JSON');}
}
function validateRequest(value) {
  if (!plain(value) || REQUEST_KEYS.some(key=>!Object.hasOwn(value,key)) || Object.keys(value).some(key=>!REQUEST_KEYS.includes(key)&&key!=='planStageId') || value.format !== 'city-of-light-work-request' || value.version !== 1) fail('INVALID_WORK_REQUEST');
  if (value.planStageId!==undefined && (typeof value.planStageId!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(value.planStageId)||['__proto__','constructor','prototype'].includes(value.planStageId))) fail('INVALID_REQUEST_STAGE');
  for (const key of ['worldId', 'projectId']) if (typeof value[key] !== 'string' || !/^[A-Za-z0-9_.:-]{1,140}$/.test(value[key])) fail('INVALID_REQUEST_BINDING');
  for (const key of ['goalVersion', 'planVersion']) if (!Number.isSafeInteger(value[key]) || value[key] < 1) fail('INVALID_REQUEST_VERSION');
  for (const [key, maximum] of [['name', 100], ['goal', 600], ['criterion', 800], ['nextStep', 500], ['blocker', 1000]]) if (typeof value[key] !== 'string' || value[key].length > maximum) fail('INVALID_REQUEST_TEXT');
  if (!value.name.trim()) fail('INVALID_REQUEST_NAME');
  return value;
}
function sourceSchema(base) {
  const schema = parseJSON(readBounded(path.join(base, 'work-report.schema.json'), MAX_JSON));
  if (schema.type !== 'object' || schema.additionalProperties !== false || schema.properties?.format?.const !== 'city-of-light-work-report' || schema.properties?.version?.const !== 1 || !Array.isArray(schema.required)) fail('INVALID_WORK_REPORT_SCHEMA');
  return schema;
}
function verifyInstalled(base) {
  noLinks(base);
  const manifest = parseJSON(readBounded(path.join(base, 'manifest.json'), MAX_JSON)), files = manifest.files;
  if (manifest.format_version !== 1 || manifest.entrypoint !== 'Start.html' || manifest.profile_version !== 1 || !/^\d+\.\d+\.\d+$/.test(manifest.engine_version || '') || !plain(files) || !PAYLOAD.every(name => Object.hasOwn(files, name))) fail('INVALID_PACKAGE_MANIFEST');
  for (const [name, record] of Object.entries(files)) {
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/.test(name) || !plain(record) || !Number.isSafeInteger(record.bytes) || record.bytes < 0 || record.bytes > MAX_FILE || !/^[a-f0-9]{64}$/.test(record.sha256 || '')) fail('INVALID_PACKAGE_RECORD');
    const bytes = readBounded(path.join(base, name), MAX_FILE);
    if (bytes.length !== record.bytes || sha(bytes) !== record.sha256) fail('PAYLOAD_MISMATCH: ' + name);
  }
  const running = readBounded(__filename, MAX_JSON);
  if (running.length !== files['work-result.cjs'].bytes || sha(running) !== files['work-result.cjs'].sha256) fail('RUNNING_CLI_MISMATCH');
  const start = new TextDecoder('utf-8', {fatal: true}).decode(readBounded(path.join(base, 'Start.html'), MAX_FILE));
  const records = [...start.matchAll(/<script id="town-engine" type="application\/json">\s*(\{[\s\S]*?\})\s*<\/script>/g)];
  if (records.length !== 1) fail('VERIFIED_EMBEDDED_ENGINE_REQUIRED');
  const engine = parseJSON(Buffer.from(records[0][1], 'utf8'));
  if (engine.version !== 1 || engine.engine_version !== manifest.engine_version || engine.profile_version !== manifest.profile_version || typeof engine.html !== 'string' || !plain(engine.assets) || !plain(engine.creator) || ['world-locale.js', 'world-core.js', 'world-package.js'].some(name => typeof engine.assets[name] !== 'string') || engine.pro?.version !== 1 || typeof engine.pro.assets?.['work-report-core.js'] !== 'string') fail('ENGINE_MANIFEST_MISMATCH');
  if (!engine.legalTexts || engine.legalTexts.license !== readBounded(path.join(base, 'LICENSE'), MAX_JSON).toString('utf8').replace(/^\uFEFF/, '') || engine.legalTexts.notice !== readBounded(path.join(base, 'NOTICE'), MAX_JSON).toString('utf8').replace(/^\uFEFF/, '')) fail('ENGINE_LEGAL_MISMATCH');
  for (const file of [path.join(base, 'portable-engine.json'), path.join(path.dirname(base), 'portable-engine.json')]) {
    if (fs.existsSync(file) && json(parseJSON(readBounded(file, MAX_FILE))) !== json(engine)) fail('ENGINE_FILE_MISMATCH');
  }
  return {engine, schema: sourceSchema(base)};
}
function loadCore(base) {
  base = localPath(base);
  if (fs.existsSync(path.join(base, 'manifest.json'))) {
    const {engine, schema} = verifyInstalled(base), context = vm.createContext({URL, TextEncoder, crypto: webcrypto, module: {exports: {}}, exports: {}}, {codeGeneration: {strings: false, wasm: false}});
    vm.runInContext(engine.pro.assets['work-report-core.js'], context, {filename: 'verified-work-report-core.js', timeout: 1000});
    const core = context.TownWorkReport || context.module.exports;
    if (typeof core?.validateReport !== 'function') fail('WORK_REPORT_VALIDATOR_REQUIRED');
    context.__TownWorkReportCore = core;
    return {schema, validateReport(value) {
      context.__TownWorkReportJSON = JSON.stringify(value);
      try {const result = vm.runInContext('__TownWorkReportCore.validateReport(JSON.parse(__TownWorkReportJSON))', context, {timeout: 1000}); return parseJSON(Buffer.from(JSON.stringify(result), 'utf8'));}
      finally {delete context.__TownWorkReportJSON;}
    }};
  }
  const registryFile = path.join(base, '..', '..', 'PRODUCT_FILES.json');
  const registry = parseJSON(readBounded(registryFile, MAX_JSON));
  if (registry.base !== 'graphify-out/product-history' || path.resolve(path.dirname(registryFile), registry.base) !== base) fail('SOURCE_CHECKOUT_REQUIRED');
  const coreFile = path.join(base, 'work-report-core.js'); noLinks(coreFile);
  if (!fs.lstatSync(coreFile).isFile()) fail('WORK_REPORT_VALIDATOR_REQUIRED');
  const schema = sourceSchema(base), core = require(coreFile);
  if (typeof core?.validateReport !== 'function') fail('WORK_REPORT_VALIDATOR_REQUIRED');
  return {schema, validateReport: value => core.validateReport(value)};
}
async function artifact(file) {
  file = localPath(file); noLinks(file);
  const before = fs.lstatSync(file); if (!before.isFile() || before.size > MAX_FILE) fail('ARTIFACT_REGULAR_FILE_OR_SIZE_REQUIRED');
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0)), hash = createHash('sha256'); let bytes = 0;
  try {
    const opened = fs.fstatSync(fd); noLinks(file);
    if (!opened.isFile() || !sameFile(before, opened) || !sameFile(opened, fs.lstatSync(file))) fail('ARTIFACT_CHANGED_DURING_READ');
    for await (const chunk of fs.createReadStream(null, {fd, autoClose: false, highWaterMark: 64 * 1024})) {bytes += chunk.length; if (bytes > MAX_FILE) fail('ARTIFACT_SIZE_LIMIT'); hash.update(chunk);}
    const after = fs.fstatSync(fd); noLinks(file);
    if (!sameFile(opened, fs.lstatSync(file)) || after.size !== bytes || opened.size !== after.size || opened.mtimeMs !== after.mtimeMs) fail('ARTIFACT_CHANGED_DURING_READ');
    return {path: file, sha256: hash.digest('hex'), bytes};
  } finally {fs.closeSync(fd);}
}
function argumentsFor(args) {
  if (args.length === 1 && args[0] === '--help') return {help: true};
  if (args.length === 2 && args[0] === '--check' && args[1] && !args[1].startsWith('--')) return {check: args[1]};
  if (![6, 8].includes(args.length)) fail('USAGE: use --help');
  const result = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i].slice(2); if (!['request', 'claim', 'output', 'artifact'].includes(key) || args[i] !== '--' + key || Object.hasOwn(result, key) || !args[i + 1] || args[i + 1].startsWith('--')) fail('USAGE: use --help');
    result[key] = args[i + 1];
  }
  if (!result.request || !result.claim || !result.output) fail('USAGE: use --help');
  return result;
}
function createExclusive(output, report, core) {
  output = localPath(output); noLinks(output); if (!fs.existsSync(path.dirname(output))) fail('OUTPUT_PARENT_REQUIRED');
  const content = json(report);
  const existing = () => {
    const previous = core.validateReport(parseJSON(readBounded(output, MAX_JSON)));
    if (json(previous) !== content) fail('EXISTING_OUTPUT_CHANGED_REFUSED');
    return {status: 'ALREADY_CREATED', output, sha256: sha(readBounded(output, MAX_JSON))};
  };
  if (fs.existsSync(output)) return existing();
  let fd; try {fd = fs.openSync(output, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW || 0), 0o600);} catch (error) {if (error.code === 'EEXIST') return existing(); throw error;}
  const created = fs.fstatSync(fd);
  try {noLinks(output); if (!sameFile(created, fs.lstatSync(output))) fail('OUTPUT_PATH_CHANGED'); fs.writeFileSync(fd, content, 'utf8');}
  catch (error) {fs.closeSync(fd); fd = undefined; try {noLinks(output); if (sameFile(created, fs.lstatSync(output))) fs.unlinkSync(output);} catch (_) {} throw error;}
  finally {if (fd !== undefined) fs.closeSync(fd);}
  return {status: 'CREATED', output, sha256: sha(Buffer.from(content, 'utf8'))};
}
async function main(args = process.argv.slice(2), base = __dirname) {
  const options = argumentsFor(args); if (options.help) return HELP;
  const core = loadCore(base);
  if (options.check) {
    const report = core.validateReport(parseJSON(readBounded(options.check, MAX_JSON)));
    return {status: 'REPORT_VALIDATED', reportId: report.reportId, worldId: report.worldId, projectId: report.projectId, ownerAcceptance: 'PENDING', worldChanged: false};
  }
  const request = validateRequest(parseJSON(readBounded(options.request, MAX_JSON))), claim = parseJSON(readBounded(options.claim, MAX_JSON));
  const allowed = Object.keys(core.schema.properties).filter(key => !['format', 'version', ...BINDINGS].includes(key));
  if (!plain(claim) || Object.keys(claim).some(key => !allowed.includes(key)) || allowed.some(key => core.schema.required.includes(key) && !Object.hasOwn(claim, key))) fail('INVALID_CLAIM_FIELDS');
  const report = {format: 'city-of-light-work-report', version: 1, ...Object.fromEntries(BINDINGS.map(key => [key, request[key]])), ...claim};
  if(request.planStageId!==undefined){if(claim.planStageId!==undefined&&claim.planStageId!==request.planStageId)fail('REPORT_STAGE_MISMATCH');report.planStageId=request.planStageId;}
  core.validateReport(report);
  let measured;
  if (options.artifact) {
    measured = await artifact(options.artifact); const evidence = report.evidence[0];
    if (evidence.sha256 && evidence.sha256 !== measured.sha256) fail('ARTIFACT_SHA_MISMATCH');
    if (evidence.path && localPath(evidence.path) !== measured.path) fail('ARTIFACT_PATH_MISMATCH');
    report.evidence = [{...evidence, sha256: measured.sha256, path: measured.path}, ...report.evidence.slice(1)];
  }
  const validated = core.validateReport(report), result = createExclusive(options.output, validated, core);
  return {...result, reportId: validated.reportId, worldId: validated.worldId, projectId: validated.projectId, ownerAcceptance: 'PENDING', worldChanged: false, ...(measured ? {artifact: measured} : {})};
}
if (require.main === module) main().then(result => process.stdout.write(typeof result === 'string' ? result : json(result))).catch(error => {process.stderr.write('ERROR: ' + error.message + '\n'); process.exitCode = 1;});
module.exports = {main, validateRequest, artifact};
