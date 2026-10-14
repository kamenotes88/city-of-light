'use strict';
// Data-only claims and explicit local review. Digests and links do not verify evidence.
(function (g) {
  const MAX_REPORT_BYTES = 256 * 1024, MAX_EVENTS = 5000, MAX_DEPTH = 35;
  const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
  const fail = message => { throw Error('Work report: ' + message); };
  function inspect(value, depth = 0, seen = new Set(), budget = {nodes: 0}) {
    if (depth > MAX_DEPTH || ++budget.nodes > 1000000) fail('data exceeds depth or node limit');
    if (value === null || typeof value === 'boolean') return;
    if (typeof value === 'string') return;
    if (typeof value === 'number') { if (!Number.isFinite(value)) fail('non-finite JSON number'); return; }
    if (!value || typeof value !== 'object' || seen.has(value)) fail('acyclic JSON data required');
    const proto = Object.getPrototypeOf(value);
    if (!Array.isArray(value) && proto !== null && Object.getPrototypeOf(proto) !== null) fail('plain JSON object required');
    const keys = Reflect.ownKeys(value);
    if (Array.isArray(value) && (keys.length !== value.length + 1 || keys.some(key => key !== 'length' && (!/^(0|[1-9]\d*)$/.test(String(key)) || Number(key) >= value.length)))) fail('ordinary dense JSON array required');
    seen.add(value);
    for (const key of keys) {
      if (Array.isArray(value) && key === 'length') continue;
      if (typeof key !== 'string' || ['__proto__', 'constructor', 'prototype'].includes(key) || /^(api.?key|access.?token|refresh.?token|password|secret|authorization)$/i.test(key)) fail('unsafe or credential field');
      const d = Object.getOwnPropertyDescriptor(value, key);
      if (!d || !d.enumerable || !own(d, 'value')) fail('accessors or hidden fields are not JSON data');
      inspect(d.value, depth + 1, seen, budget);
    }
    seen.delete(value);
  }
  function copy(value, limit) {
    inspect(value);
    const raw = JSON.stringify(value);
    if (new TextEncoder().encode(raw).length > limit) fail('JSON byte limit exceeded');
    return JSON.parse(raw);
  }
  const schema = copy(g.TownWorkReportSchema || (typeof require === 'function' ? require('./work-report.schema.json') : null), MAX_REPORT_BYTES);
  const keywords = new Set(['$schema', 'title', 'description', 'type', 'additionalProperties', 'required', 'properties', 'const', 'enum', 'pattern', 'format', 'minimum', 'minLength', 'maxLength', 'minItems', 'maxItems', 'items']);
  function checkSchema(node) {
    if (!node || typeof node !== 'object' || Array.isArray(node)) fail('invalid installed schema');
    for (const key of Object.keys(node)) if (!keywords.has(key)) fail('unsupported schema keyword ' + key);
    if (node.type && !['object', 'array', 'string', 'integer', 'boolean'].includes(node.type)) fail('unsupported schema type');
    if (node.type === 'object' && (node.additionalProperties !== false || !node.properties || !Array.isArray(node.required))) fail('closed object schema required');
    if (node.properties) for (const child of Object.values(node.properties)) checkSchema(child);
    if (node.items) checkSchema(node.items);
    if (node.pattern) new RegExp(node.pattern);
    if (node.format && !['date', 'evidence-url'].includes(node.format)) fail('unsupported schema format');
  }
  checkSchema(schema);
  function date(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) fail('real calendar date required');
  }
  function evidenceURL(value) {
    if (value !== value.trim() || /[\s\\<>"\x00-\x1f\x7f]/.test(value)) fail('invalid evidence URL text');
    let url; try { url = new URL(value); } catch (_) { fail('invalid evidence URL'); }
    if (!['http:', 'https:', 'codex:'].includes(url.protocol) || !url.hostname || url.username || url.password) fail('evidence URL protocol or credentials refused');
    if (url.protocol === 'codex:' && (url.hostname !== 'threads' || !/^\/[A-Za-z0-9_.:-]+$/.test(url.pathname))) fail('only Codex thread navigation is supported');
    for (const key of url.searchParams.keys()) if (/^(api.?key|access.?token|refresh.?token|password|secret|authorization)$/i.test(key)) fail('credential query refused');
    return url.href;
  }
  function conforms(value, rule, path) {
    if (own(rule, 'const') && value !== rule.const) fail(path + ' has an unsupported constant');
    if (rule.enum && !rule.enum.includes(value)) fail(path + ' has an unsupported enum');
    if (rule.type === 'object') {
      if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path + ' must be an object');
      const keys = Reflect.ownKeys(value);
      if (keys.some(key => typeof key !== 'string' || !own(rule.properties, key))) fail(path + ' has unknown fields');
      for (const key of rule.required) if (!own(value, key)) fail(path + ' is missing ' + key);
      for (const key of keys) conforms(value[key], rule.properties[key], path + '.' + key);
    } else if (rule.type === 'array') {
      if (!Array.isArray(value) || value.length < rule.minItems || value.length > rule.maxItems) fail(path + ' has invalid array size');
      for (const item of value) conforms(item, rule.items, path + '[]');
    } else if (rule.type === 'string') {
      if (typeof value !== 'string') fail(path + ' must be text');
      const length = Array.from(value).length;
      if ((own(rule, 'minLength') && (length < rule.minLength || !value.trim())) || (own(rule, 'maxLength') && length > rule.maxLength) || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)) fail(path + ' has invalid text length or controls');
      if (rule.pattern && !(new RegExp(rule.pattern)).test(value)) fail(path + ' has invalid syntax');
      if (rule.format === 'date') date(value);
      if (rule.format === 'evidence-url') evidenceURL(value);
    } else if (rule.type === 'integer') {
      if (!Number.isSafeInteger(value) || value < rule.minimum) fail(path + ' must be a bounded integer');
    } else if (rule.type === 'boolean' && typeof value !== 'boolean') fail(path + ' must be boolean');
  }
  function validateReport(input) {
    // Inspect descriptors before reading values; unknown fields cannot invoke getters.
    const report = copy(input, MAX_REPORT_BYTES);
    conforms(report, schema, 'report');
    for (const item of report.evidence) item.href = evidenceURL(item.href);
    if (new TextEncoder().encode(JSON.stringify(report)).length > MAX_REPORT_BYTES) fail('normalized report exceeds byte limit');
    return report;
  }
  function canonical(value) {
    if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
    if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
    return JSON.stringify(value);
  }
  async function digest(value) {
    if (!g.crypto?.subtle) fail('WebCrypto SHA-256 is required');
    const bytes = await g.crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(value)));
    return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
  }
  function model() {
    const M = g.ProModel || (typeof require === 'function' ? require('./pro/model.js') : null);
    if (!M?.validate) fail('installed ProModel is required');
    return M;
  }
  function checkedState(state) { return model().validate(copy(state, 50 * 1024 * 1024)); }
  function nowISO(now) {
    const value = now === undefined ? Date.now() : now;
    if (!Number.isSafeInteger(value) || value < 0 || value > 8640000000000000) fail('invalid review clock');
    return new Date(value).toISOString();
  }
  function target(state, report, allowStale = false) {
    if (state.worldId !== report.worldId) fail('world mismatch');
    const p = state.projects.find(item => item.id === report.projectId);
    if (!p) fail('unknown project');
    if (p.lifecycle?.state === 'archived') fail('restore the archived project before importing or reviewing work');
    if (!allowStale && (p.goalVersion !== report.goalVersion || p.plan.version !== report.planVersion)) fail('goal or plan version mismatch');
    if (!allowStale && report.planStageId !== undefined && !(p.plan.stageDetails || []).some(d => d.id === report.planStageId)) fail('unknown current plan stage');
    return p;
  }
  function identity(report, legacy = false) {
    return {projectId: report.projectId, goalVersion: report.goalVersion, stage: report.stage, artifactId: report.artifactId,
      // A navigation page is not an artifact when a stronger content hash is supplied.
      // Mixed hashed/unhashed claims are not equated by URL alone; artifactId still matches.
      evidenceKeys: [...new Set(report.evidence.filter(e => legacy || e.sha256 || !/^codex:\/\/threads\//i.test(e.href)).map(e => e.sha256 ? 'sha256:' + e.sha256 : 'href:' + e.href))].sort(),
      ...(report.planStageId === undefined ? {} : {planStageId: report.planStageId})};
  }
  function matches(left, right) {
    return left.projectId === right.projectId && left.goalVersion === right.goalVersion && left.stage === right.stage &&
      (left.artifactId === right.artifactId || left.evidenceKeys.some(key => right.evidenceKeys.includes(key)));
  }
  function achievementMatch(p, report) {
    const incoming = identity(report);
    return p.achievements.find(a => ['accepted', 'revoked'].includes(a.status) &&
      matches(identity({projectId: p.id, goalVersion: a.goalVersion, stage: a.stage, artifactId: a.artifactId || '',
        ...(a.planStageId === undefined ? {} : {planStageId: a.planStageId}),
        evidence: a.evidence.map(e => ({...e, href: evidenceURL(e.href)}))}), incoming));
  }
  async function storedReports(state) {
    const found = [];
    for (const event of state.events.filter(e => e.type === 'work_report')) {
      const report = validateReport(event.report);
      if (report.worldId !== state.worldId || event.projectId !== report.projectId || !['pending', 'accepted', 'rejected'].includes(event.status) ||
          event.id !== 'work-report:' + report.reportId || event.date !== report.date ||
          event.digest !== await digest(report) || canonical(event.identity) !== canonical(identity(report)) && canonical(event.identity) !== canonical(identity(report, true))) fail('stored report integrity mismatch');
      if (found.some(old => old.report.reportId === report.reportId)) fail('duplicate stored report ID');
      found.push(event);
    }
    return found;
  }
  function reserve(state, id) {
    if (state.events.length >= MAX_EVENTS || state.events.some(e => e.id === id)) fail('history is full or event ID is occupied');
  }
  async function importReport(state, input, options = {}) {
    const next = checkedState(state), report = validateReport(input), p = target(next, report);
    const settings = copy(options, MAX_REPORT_BYTES);
    if (!settings || typeof settings !== 'object' || Array.isArray(settings) || Object.keys(settings).some(key => key !== 'now')) fail('invalid import options');
    const time = nowISO(settings.now), hash = await digest(report), key = identity(report), reports = await storedReports(next);
    const sameId = reports.find(e => e.report.reportId === report.reportId);
    if (sameId) {
      if (sameId.digest !== hash) fail('report ID has conflicting content');
      return {state: next, duplicate: true, reportId: report.reportId};
    }
    const sameResult = reports.find(e => matches(identity(e.report), key));
    if (sameResult || achievementMatch(p, report)) return {state: next, duplicate: true, reportId: sameResult?.report.reportId || report.reportId};
    const id = 'work-report:' + report.reportId, decisionId = 'work-review:' + report.reportId;
    reserve(next, id);
    if (next.decisions.some(d => d.id === decisionId)) fail('review decision ID is occupied');
    next.events.push({id, projectId: report.projectId, date: report.date, receivedAt: time, type: 'work_report', status: 'pending',
      title: report.title, detail: report.scope, report, digest: hash, identity: key});
    next.decisions.push({id: decisionId, projectId: report.projectId, kind: 'work_report_review', status: 'open', title: report.title,
      body: report.stage + ': ' + report.scope, why: 'An explicitly imported claim needs local owner review. Evidence has not been verified.',
      options: [], priority: p.priority || 99, sourceUrl: report.evidence[0].href, reportId: report.reportId, reportDigest: hash,
      attention: {humanRequired: true, urgency: 'normal', reason: 'Review the imported work claim; no achievement is accepted.',
        confirmedAt: time, confirmedBy: 'owner_local'}});
    return {state: model().validate(next), duplicate: false, reportId: report.reportId};
  }
  async function reviewReport(state, reportId, options) {
    const next = checkedState(state), settings = copy(options, MAX_REPORT_BYTES);
    const allowed = ['accept', 'confirmed', 'evidenceChecked', 'applyNextStep', 'completeGoal', 'completeStage', 'reason', 'now'];
    if (!settings || typeof settings !== 'object' || Array.isArray(settings) || Object.keys(settings).some(k => !allowed.includes(k))) fail('invalid review options');
    if (typeof settings.accept !== 'boolean' || settings.confirmed !== true) fail('explicit owner confirmation required');
    for (const key of ['evidenceChecked', 'applyNextStep', 'completeGoal', 'completeStage']) if (own(settings, key) && typeof settings[key] !== 'boolean') fail('review flags must be booleans');
    if (own(settings, 'reason') && (typeof settings.reason !== 'string' || settings.reason.length > 1000 || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(settings.reason))) fail('invalid review reason');
    const time = nowISO(settings.now), reports = await storedReports(next), event = reports.find(e => e.report.reportId === reportId);
    if (!event || event.status !== 'pending') fail('a pending report is required');
    const report = event.report, p = target(next, report, !settings.accept);
    if (p.localOnly !== true) fail('only a local project can be reviewed here');
    const decision = next.decisions.find(d => d.id === 'work-review:' + reportId);
    if (!decision || decision.kind !== 'work_report_review' || decision.projectId !== p.id || decision.reportDigest !== event.digest ||
        !['open', 'deferred'].includes(decision.status)) fail('current review decision is required');
    if (settings.accept && settings.evidenceChecked !== true) fail('owner evidence verification required');
    if (!settings.accept && (!settings.reason?.trim() || settings.applyNextStep || settings.completeGoal || settings.completeStage)) fail('rejection needs a reason and cannot apply or complete work');
    const planStage = report.planStageId === undefined ? null : (p.plan.stageDetails || []).find(d => d.id === report.planStageId);
    if (settings.completeStage && (!planStage || p.plan.status !== 'approved_local')) fail('stage completion requires the current approved known stage');
    if (settings.completeGoal && (!report.completesGoal || p.completedGoalVersion === p.goalVersion)) fail('goal completion needs a new complete report and explicit owner choice');
    if (settings.completeGoal && p.plan.stageDetails?.length) {
      if (p.plan.status !== 'approved_local') fail('whole-goal completion requires the current approved plan');
      const progress = model().stageProgress(next, p), completed = new Set(progress.completedIds);
      if (settings.completeStage && planStage) completed.add(planStage.id);
      if (progress.active.some(d => !completed.has(d.id))) fail('all approved stages must be complete before the whole goal');
    }
    if (settings.accept && (achievementMatch(p, report) || reports.some(e => e !== event && e.status === 'accepted' && matches(identity(e.report), identity(report))))) fail('this result was already accepted or revoked');
    const receiptId = (settings.accept ? 'work-accept:' : 'work-reject:') + reportId;
    reserve(next, receiptId);
    const receipt = {reportId, digest: event.digest, reviewedAt: time, accepted: settings.accept,
      evidenceChecked: settings.evidenceChecked === true, applyNextStep: settings.applyNextStep === true, completeGoal: settings.completeGoal === true,
      ...(own(settings, 'completeStage') ? {completeStage: settings.completeStage} : {}),
      reason: settings.reason || ''};
    let achievementId;
    if (settings.accept) {
      achievementId = 'work-result:' + await digest({projectId: p.id, goalVersion: report.goalVersion, stage: report.stage, artifactId: report.artifactId});
      if (p.achievements.some(a => a.id === achievementId)) fail('result identity is occupied');
      p.achievements.push({id: achievementId, date: report.date, status: 'accepted', stage: report.stage, title: report.title,
        scope: report.scope, evidence: report.evidence, artifactId: report.artifactId, goalVersion: report.goalVersion,
        acceptedBy: 'owner_local', acceptedAt: time, reportId, reportDigest: event.digest});
      if (report.planStageId !== undefined) p.achievements.at(-1).planStageId = report.planStageId;
      if (settings.completeStage) {
        const completed = model().reduce(next, 'completePlanStage', {projectId:p.id,stageId:planStage.id,achievementId,
          confirmed:true,evidenceChecked:true,expectedGoalVersion:p.goalVersion,expectedPlanVersion:p.plan.version,expectedCriterion:planStage.criterion});
        // The pure reducer appends only the stage receipt. Keep this review's
        // original project/report references for the rest of its transaction.
        next.events.push(...completed.events.slice(next.events.length));
      }
      if (settings.applyNextStep) {
        receipt.previous = Object.fromEntries(['nextStep', 'blocker', 'sourceDate'].filter(k => own(p, k)).map(k => [k, p[k]]));
        p.nextStep = report.nextStep; p.blocker = report.blocker; p.sourceDate = report.date;
      }
      if (settings.completeGoal) { p.status = 'completed_local'; p.completedGoalVersion = p.goalVersion; }
    }
    event.status = settings.accept ? 'accepted' : 'rejected'; event.review = receipt;
    decision.status = 'resolved_local';
    next.events.push({id: receiptId, projectId: p.id, date: time, type: settings.accept ? 'acceptance' : 'work_report_review',
      status: event.status, title: settings.accept ? report.title : 'Work report rejected', detail: settings.reason || report.scope,
      ...(achievementId ? {achievementId, stage: report.stage} : {}), reportId, digest: event.digest, receipt});
    return model().validate(next);
  }
  const api = Object.freeze({validateReport, importReport, reviewReport, MAX_REPORT_BYTES});
  g.TownWorkReport = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window === 'undefined' ? globalThis : window);
