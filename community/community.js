(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const apiTools = window.CityCommunityAPI;
  const hintKey = 'col.pending.v1';
  let api, dashboard, team, activeTab = 'invitations', timer, teamLoading = false, teamRequest = 0;
  let selected = { x: 0, y: 0 }, editing, dirty = false, issuedInvite, adminOffset = 0, adminTotal = 0, inviteOffset = 0, inviteTotal = 0, ownerToken = '', pollFailed = false;
  let pending = { ref: '', team: '' }, hintError = '';
  function validHint(value, kind) { return new RegExp(kind === 'ref' ? '^[a-f0-9]{32}$' : '^[a-f0-9]{64}$').test(value || ''); }
  try {
    const old = JSON.parse(sessionStorage.getItem(hintKey) || '{}');
    if (validHint(old.ref, 'ref')) pending.ref = old.ref;
  } catch (_) { /* Storage can be unavailable; the current page still works. */ }
  const entryUrl = new URL(location.href), fragment = new URLSearchParams(entryUrl.hash.slice(1));
  const ownerValues = fragment.getAll('owner');
  if (ownerValues.length === 1 && /^[a-f0-9]{64}$/.test(ownerValues[0])) ownerToken = ownerValues[0];
  else if (ownerValues.length) hintError = 'This owner setup link is invalid. Ask the operator for a new private setup link.';
  fragment.delete('owner'); entryUrl.searchParams.delete('owner');
  for (const kind of ['ref', 'team']) {
    const values = entryUrl.searchParams.getAll(kind).concat(kind === 'team' ? fragment.getAll(kind) : []);
    if (values.length) {
      if (values.length === 1 && validHint(values[0], kind)) pending[kind] = values[0];
      else { pending[kind] = ''; hintError = 'This invitation link has an invalid or repeated code. Ask the sender for a fresh link.'; }
      entryUrl.searchParams.delete(kind);
      fragment.delete(kind);
    }
  }
  entryUrl.hash = fragment.toString();
  history.replaceState(null, '', entryUrl.pathname + entryUrl.search + entryUrl.hash);
  function saveHints() { try { if (pending.ref) sessionStorage.setItem(hintKey, JSON.stringify({ ref: pending.ref })); else sessionStorage.removeItem(hintKey); } catch (_) {} }
  saveHints();
  function node(tag, text, className) {
    const result = document.createElement(tag);
    if (text !== undefined) result.textContent = text;
    if (className) result.className = className;
    return result;
  }
  function notice(text, error) { $('notice').textContent = text; $('notice').classList.toggle('error', !!error); $('notice').hidden = !text; }
  function date(value) { const parsed = new Date(value); return Number.isNaN(parsed.valueOf()) ? 'Unknown date' : parsed.toLocaleDateString(); }
  function connection() {
    const online = navigator.onLine;
    $('connection').textContent = !online ? 'Offline · local worlds still work' : api && api.signedIn ? 'Account connected' : api ? 'Sign in to connect' : 'Community not connected';
    $('connection').classList.toggle('online', !!(online && api && api.signedIn));
    pollSchedule();
  }
  async function perform(control, action) {
    if (!navigator.onLine) { notice('You are offline. Reconnect to use your community account. Your local world still works.', true); return; }
    const controls = control && control.tagName === 'FORM' ? Array.from(control.querySelectorAll('input,select,button')) : control ? [control] : [];
    const before = controls.map(item => item.disabled);
    controls.forEach(item => { item.disabled = true; });
    try { await action(); }
    catch (error) {
      notice(error.message || 'This action could not be completed. Refresh before repeating a change.', true);
      if (api && !api.signedIn) signedOut();
    } finally { controls.forEach((item, index) => { item.disabled = before[index]; }); paginationState(); connection(); }
  }
  function onForm(id, action) { $(id).addEventListener('submit', event => { event.preventDefault(); perform($(id), action); }); }
  function onButton(id, action) { $(id).addEventListener('click', () => perform($(id), action)); }
  async function copy(field) {
    try { await navigator.clipboard.writeText(field.value); notice('Invitation copied. Share it with the person you want to invite.'); }
    catch (_) { field.focus(); field.select(); notice('Select the link above and copy it using your device’s copy action.'); }
  }
  function pendingSummary() {
    $('pending-summary').hidden = !(pending.ref || pending.team || ownerToken);
    $('pending-summary').textContent = ownerToken ? 'Owner setup link detected. Sign in, then explicitly activate this account as owner.' : pending.ref ? 'A personal invitation is waiting. It is recorded only after your explicit consent.' : 'A team invitation is waiting. You can review and join after signing in.';
    $('registration-ref').hidden = !pending.ref;
    $('registration-ref').textContent = 'This account will ask the server to record the direct inviter from your link. The relationship can be accepted only once.';
    $('discard-ref').hidden = !pending.ref;
    if (pending.team) $('team-token').value = pending.team;
  }
  function registration() {
    $('signin').hidden = true; $('registration').hidden = false; $('dashboard').hidden = true; $('logout').hidden = false;
    pendingSummary(); $('display-name').focus();
  }
  async function loadDashboard() {
    try { dashboard = await api.rpc('col_dashboard', {}); }
    catch (error) {
      if (/not registered|registr.*first|profile.*not.*found|community account.*not.*found/i.test(error.message)) { registration(); return; }
      throw error;
    }
    renderDashboard();
  }
  function renderDashboard() {
    if (!dashboard || !dashboard.account) throw new Error('The community account response is incomplete.');
    $('signin').hidden = true; $('registration').hidden = true; $('dashboard').hidden = false; $('logout').hidden = false;
    $('welcome').textContent = 'Welcome, ' + dashboard.account.display_name + '.';
    $('account-id').textContent = 'Stable community ID · ' + dashboard.account.id;
    $('removal-status').textContent = dashboard.account.erasure_requested_at ? 'Account-data removal review requested on ' + date(dashboard.account.erasure_requested_at) + '. This is awaiting operator review; it does not delete your local world or your authentication identity.' : '';
    $('request-erasure').hidden = !!dashboard.account.erasure_requested_at;
    $('ref-link').value = apiTools.inviteLink(api.config, dashboard.account.referral_code, 'ref');
    $('share-ref').hidden = typeof navigator.share !== 'function';
    $('invite-count').textContent = (dashboard.counts.direct_invitees || 0) + ' direct invitation' + (dashboard.counts.direct_invitees === 1 ? '' : 's');
    $('my-inviter').textContent = dashboard.inviter ? 'Your direct inviter: ' + dashboard.inviter.display_name + ' · ' + dashboard.inviter.id : 'No direct inviter is recorded for this account.';
    renderInvitees(dashboard.invitees || [], dashboard.counts.direct_invitees || 0, 0);
    $('owner-activation').hidden = !ownerToken || !!dashboard.account.is_admin;
    $('admin-tab').hidden = !dashboard.account.is_admin;
    if (activeTab === 'admin' && !dashboard.account.is_admin) setTab('invitations');
    const previous = $('team-select').value; $('team-select').replaceChildren(node('option', 'Choose a city'));
    $('team-select').firstChild.value = '';
    for (const city of dashboard.teams || []) {
      const option = node('option', city.name + ' · ' + city.role); option.value = city.id; $('team-select').append(option);
    }
    if ((dashboard.teams || []).some(city => city.id === previous)) $('team-select').value = previous;
    else { team = null; $('team-city').hidden = true; }
    pendingSummary();
    if (pending.ref) notice('This account already has a community profile. A new personal link will not silently replace its direct inviter.');
    if (pending.team) { setTab('teams'); notice('A team invitation is ready below. Review the role with the sender, then choose “Review and join this city”.'); }
    connection();
  }
  function renderInvitees(invitees, total, offset) {
    inviteOffset = offset; inviteTotal = total;
    const people = $('invitees'); people.replaceChildren();
    for (const person of invitees) {
      const li = node('li'), info = node('div', person.display_name);
      info.append(node('small', 'Joined ' + date(person.created_at) + ' · ' + person.id)); li.append(info); people.append(li);
    }
    if (!people.children.length) people.append(node('li', 'Your first direct invitee will appear here after registration.', 'empty'));
    paginationState();
    $('invite-page').textContent = total ? 'Showing ' + (offset + 1) + '–' + (offset + invitees.length) + ' of ' + total : 'No direct invitees yet';
  }
  async function loadInvitees(offset) {
    const data = await api.rpc('col_direct_invitees', { p_offset: offset, p_limit: 100 });
    renderInvitees(data.invitees || [], data.total, data.offset);
  }
  function paginationState() {
    $('invite-prev').disabled = inviteOffset === 0; $('invite-next').disabled = inviteOffset + 100 >= inviteTotal;
    $('admin-prev').disabled = adminOffset === 0; $('admin-next').disabled = adminOffset + 50 >= adminTotal;
  }
  function signedOut() {
    dashboard = null; team = null; issuedInvite = null; editing = null; dirty = false; ownerToken = ''; pending.team = ''; teamRequest += 1;
    $('dashboard').hidden = true; $('registration').hidden = true; $('signin').hidden = !api; $('logout').hidden = true;
    $('team-city').hidden = true; $('team-invitation').hidden = true; $('code-form').hidden = true; $('email-form').hidden = false; $('code').value = '';
    $('accounts').replaceChildren(); $('invitees').replaceChildren(); $('members').replaceChildren(); $('ref-link').value = ''; $('team-link').value = '';
    pollSchedule();
  }
  function setTab(name) {
    if (!['invitations', 'teams', 'admin'].includes(name) || (name === 'admin' && !dashboard.account.is_admin)) return;
    activeTab = name;
    for (const section of ['invitations', 'teams', 'admin']) $(section).hidden = section !== name;
    document.querySelectorAll('[data-tab]').forEach(button => { if (button.dataset.tab === name) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current'); });
    if (name === 'admin') perform($('admin-tab'), loadAdmin);
    pollSchedule();
  }
  function pollSchedule() {
    clearTimeout(timer); timer = null;
    if (api && api.signedIn && team && activeTab === 'teams' && !document.hidden && navigator.onLine && !pollFailed) {
      timer = setTimeout(async () => {
        try { await loadTeam(true); } catch (error) { pollFailed = true; notice('City refresh paused: ' + error.message + ' Use Refresh city to reconnect.', true); }
        connection();
      }, 20000);
    }
  }
  async function loadTeam(poll) {
    const id = $('team-select').value;
    if (!id || (poll && teamLoading)) return;
    const request = ++teamRequest; teamLoading = true;
    try {
      const next = await api.rpc('col_team', { p_team_id: id });
      if (request !== teamRequest || id !== $('team-select').value) return;
      const changed = team && team.version !== next.version;
      team = next; renderTeam();
      pollFailed = false;
      if (changed && dirty) notice('Your team city changed. Your unsaved text is kept; saving still checks the original entry version.');
    } finally { teamLoading = false; pollSchedule(); }
  }
  function renderTeam() {
    $('team-city').hidden = false; $('city-name').textContent = team.name;
    $('city-role').textContent = 'Your role: ' + team.role + ' · city version ' + team.version;
    $('team-freshness').textContent = 'Last received ' + new Date().toLocaleTimeString() + '. Checks every 20 seconds only while this city is visible.';
    $('team-owner').hidden = team.role !== 'owner';
    const list = $('members'); list.replaceChildren();
    for (const member of team.members || []) {
      const li = node('li'), info = node('div', member.display_name);
      info.append(node('small', member.role + ' · ' + member.id)); li.append(info);
      if (team.role === 'owner' && member.id !== dashboard.account.id) {
        const remove = node('button', 'Remove', 'quiet'); remove.type = 'button';
        remove.addEventListener('click', () => {
          if (!confirm('Remove ' + member.display_name + ' from this city? Their existing work remains in the city.')) return;
          const id = team.id;
          perform(remove, async () => { await api.rpc('col_remove_member', { p_team_id: id, p_user_id: member.id }); await loadTeam(); notice('Team access removed.'); });
        }); li.append(remove);
      }
      list.append(li);
    }
    drawMap(); if (!dirty) openCell(selected.x, selected.y);
  }
  function cellEntry(x, y) { return (team.entries || []).find(entry => entry.x === x && entry.y === y); }
  function openCell(x, y) {
    selected = { x: Math.max(0, Math.min(31, x)), y: Math.max(0, Math.min(31, y)) };
    const entry = cellEntry(selected.x, selected.y);
    editing = entry ? { id: entry.id, version: entry.version } : null; dirty = false;
    const canEdit = team.role === 'owner' || team.role === 'editor' && (!entry || entry.owner_id === dashboard.account.id);
    $('entry-form').hidden = !canEdit; $('viewer-entry').hidden = canEdit;
    $('cell-description').textContent = 'Cell ' + (selected.x + 1) + ', ' + (selected.y + 1) + (entry ? ' · ' + entry.title : ' · ready for shared work');
    $('cell-position').textContent = 'Cell ' + (selected.x + 1) + ', ' + (selected.y + 1) + '. This title and state are visible to all team members.';
    $('entry-title').value = entry ? entry.title : ''; $('entry-status').value = entry ? entry.status : 'planned'; $('entry-kind').value = entry ? entry.kind : 'task';
    $('delete-entry').hidden = !entry;
    $('viewer-entry').replaceChildren();
    if (!canEdit) {
      $('viewer-entry').append(node('p', entry ? entry.title + ' · ' + entry.status + ' · ' + entry.kind : 'This cell is empty.'));
      $('viewer-entry').append(node('p', team.role === 'viewer' ? 'Viewer access is read only.' : 'Only the creator or city owner can edit this entry.', 'fine'));
    }
    drawMap();
  }
  function drawMap() {
    const canvas = $('map'), ctx = canvas.getContext('2d'), size = 20;
    ctx.clearRect(0, 0, 640, 640); ctx.fillStyle = '#edf2e0'; ctx.fillRect(0, 0, 640, 640);
    ctx.strokeStyle = '#d7dfca'; ctx.lineWidth = 1;
    for (let i = 0; i <= 32; i++) { ctx.beginPath(); ctx.moveTo(i * size, 0); ctx.lineTo(i * size, 640); ctx.moveTo(0, i * size); ctx.lineTo(640, i * size); ctx.stroke(); }
    const colours = { planned: '#a8b9b4', active: '#e2ae51', blocked: '#b95c45', completed: '#388273' };
    for (const entry of team.entries || []) {
      const x = entry.x * size, y = entry.y * size;
      ctx.fillStyle = colours[entry.status] || colours.planned;
      if (entry.kind === 'habit') { ctx.beginPath(); ctx.arc(x + 10, y + 10, 7, 0, Math.PI * 2); ctx.fill(); }
      else if (entry.kind === 'task') { ctx.fillRect(x + 3, y + 6, 14, 5); ctx.fillRect(x + 4, y + 12, 2, 5); ctx.fillRect(x + 14, y + 12, 2, 5); }
      else { ctx.fillRect(x + 4, y + 7, 12, 11); ctx.beginPath(); ctx.moveTo(x + 2, y + 7); ctx.lineTo(x + 10, y + (entry.kind === 'goal' ? 0 : 2)); ctx.lineTo(x + 18, y + 7); ctx.fill(); ctx.fillStyle = entry.status === 'completed' ? '#ffe399' : '#eff3e6'; ctx.fillRect(x + 7, y + 10, 3, 4); ctx.fillRect(x + 12, y + 10, 2, 4); }
      if (entry.status === 'blocked') { ctx.fillStyle = '#fff4dc'; ctx.font = 'bold 13px sans-serif'; ctx.fillText('!', x + 8, y + 16); }
    }
    ctx.strokeStyle = '#234d45'; ctx.lineWidth = 3; ctx.strokeRect(selected.x * size + 1.5, selected.y * size + 1.5, size - 3, size - 3);
    canvas.setAttribute('aria-label', 'Shared city: ' + (team.entries || []).length + ' entries. Selected cell ' + (selected.x + 1) + ', ' + (selected.y + 1) + '. Use arrow keys, then Enter. Planned is grey, active gold, blocked red, completed green.');
  }
  function parseTeam(value) {
    const text = value.trim();
    if (validHint(text, 'team')) return text;
    let url;
    try { url = new URL(text); } catch (_) { throw new Error('Paste a valid team invitation code or link.'); }
    const configured = new URL(api.config.portalUrl);
    if (url.origin !== configured.origin || url.pathname !== configured.pathname || url.username || url.password) throw new Error('This invitation is not from this community portal.');
    const values = url.searchParams.getAll('team').concat(new URLSearchParams(url.hash.slice(1)).getAll('team'));
    if (values.length !== 1 || !validHint(values[0], 'team')) throw new Error('This team invitation is incomplete or repeated.');
    return values[0];
  }
  async function loadAdmin() {
    const data = await api.rpc('col_admin_accounts', { p_offset: adminOffset, p_limit: 50 });
    adminTotal = data.registered_accounts;
    const counts = $('admin-counts'); counts.replaceChildren();
    for (const pair of [[data.registered_accounts, 'Registered community accounts'], [data.attributed_accounts, 'Accounts with a direct inviter']]) { const stat = node('div', pair[1], 'stat'); stat.prepend(node('strong', String(pair[0]))); counts.append(stat); }
    const rows = $('accounts'); rows.replaceChildren();
    for (const account of data.accounts || []) {
      const row = node('tr'), identity = node('td', account.display_name); identity.append(node('small', account.id));
      row.append(identity, node('td', date(account.created_at)), node('td', account.inviter_id || 'None'), node('td', String(account.direct_invitees)), node('td', account.erasure_requested_at ? 'Requested ' + date(account.erasure_requested_at) : 'None')); rows.append(row);
    }
    paginationState();
    $('admin-page').textContent = 'Accounts ' + (adminTotal ? adminOffset + 1 : 0) + '–' + Math.min(adminOffset + 50, adminTotal) + ' of ' + adminTotal + ' · received ' + new Date().toLocaleTimeString();
  }
  onForm('email-form', async () => { const email = $('email').value.trim(); await api.sendCode(email); $('email-form').hidden = true; $('code-form').hidden = false; $('code').focus(); notice('Email requested. Enter its code or paste the original sign-in link. Check spam if it does not arrive.'); });
  onForm('code-form', async () => { const credential = $('code').value; $('code').value = ''; await api.verifyCode($('email').value, credential); await loadDashboard(); });
  $('change-email').addEventListener('click', () => { $('code').value = ''; $('code-form').hidden = true; $('email-form').hidden = false; $('email').focus(); });
  onForm('register-form', async () => { dashboard = await api.rpc('col_register', { p_display_name: $('display-name').value.trim(), p_ref: pending.ref || null, p_consent: $('consent').checked }); pending.ref = ''; saveHints(); renderDashboard(); notice('Your community profile is ready. Your personal invitation is below.'); });
  $('discard-ref').addEventListener('click', () => { pending.ref = ''; saveHints(); pendingSummary(); notice('This pending inviter was removed. Submit the profile only if you want to continue without it.'); });
  onButton('logout', async () => { try { await api.signOut(); notice('Signed out. Your private local world remains on your device.'); } finally { signedOut(); } });
  onButton('copy-ref', () => copy($('ref-link')));
  onButton('share-ref', async () => { try { await navigator.share({ title: 'City of Light', text: 'Build your city with me.', url: $('ref-link').value }); } catch (error) { if (error.name !== 'AbortError') throw error; } });
  onButton('refresh-account', loadDashboard);
  onButton('request-erasure', async () => { if (!confirm('Request operator review to remove your community account data? This does not delete it immediately, your local world, or any other service account.')) return; dashboard = await api.rpc('col_request_erasure', {}); renderDashboard(); notice('Removal review requested. The operator must review it; no automatic deletion has occurred.'); });
  $('download-dashboard').addEventListener('click', () => {
    if (!dashboard) return;
    const content = JSON.stringify({ format: 'city-of-light-community-dashboard', version: 1, captured_at: new Date().toISOString(), dashboard }, null, 2);
    const url = URL.createObjectURL(new Blob([content], { type: 'application/json' })), link = node('a');
    link.href = url; link.download = 'city-of-light-community-dashboard.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    notice('This dashboard snapshot was downloaded. It contains the current account and visible relationships, not the complete server audit history or your local world.');
  });
  onButton('invite-prev', () => loadInvitees(Math.max(0, inviteOffset - 100)));
  onButton('invite-next', () => loadInvitees(inviteOffset + 100));
  onButton('claim-owner', async () => { if (!ownerToken) return; dashboard = await api.rpc('col_claim_owner', { p_token: ownerToken }); ownerToken = ''; renderDashboard(); setTab('admin'); notice('Owner access activated for this verified community account.'); });
  document.querySelectorAll('[data-tab]').forEach(button => button.addEventListener('click', () => setTab(button.dataset.tab)));
  onForm('create-team', async () => { const previousIds = new Set((dashboard.teams || []).map(city => city.id)); dashboard = await api.rpc('col_create_team', { p_name: $('team-name').value.trim() }); $('team-name').value = ''; renderDashboard(); const created = (dashboard.teams || []).find(city => !previousIds.has(city.id)); if (created) { $('team-select').value = created.id; await loadTeam(); } notice('Team city created. Only shared work entered here is visible to its members.'); });
  onForm('join-team', async () => { const token = parseTeam($('team-token').value); if (!confirm('Join the city named by this invitation? The server will grant its viewer or editor role. Your private local world is not shared.')) return; dashboard = await api.rpc('col_join_team', { p_token: token }); pending.team = ''; saveHints(); $('team-token').value = ''; renderDashboard(); notice('Team invitation accepted. Choose your city below.'); });
  $('team-select').addEventListener('change', () => { team = null; dirty = false; issuedInvite = null; $('team-invitation').hidden = true; $('team-city').hidden = true; teamRequest += 1; pollSchedule(); perform($('team-select'), () => loadTeam()); });
  onButton('refresh-team', () => loadTeam());
  $('entry-form').addEventListener('input', () => { dirty = true; });
  $('map').addEventListener('click', event => { if (!team) return; if (dirty && !confirm('Discard the unsaved text and open another cell?')) return; const box = $('map').getBoundingClientRect(); openCell(Math.floor((event.clientX - box.left) / box.width * 32), Math.floor((event.clientY - box.top) / box.height * 32)); });
  $('map').addEventListener('keydown', event => { if (!team) return; const steps = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }; if (steps[event.key]) { event.preventDefault(); if (dirty) { notice('Save your text or click another cell to discard it before moving.'); return; } openCell(selected.x + steps[event.key][0], selected.y + steps[event.key][1]); } else if (event.key === 'Enter') { event.preventDefault(); if (!$('entry-form').hidden) $('entry-title').focus(); } });
  onForm('entry-form', async () => {
    const id = team.id, result = await api.rpc('col_put_entry', { p_team_id: id, p_entry_id: editing ? editing.id : null, p_x: selected.x, p_y: selected.y, p_title: $('entry-title').value.trim(), p_status: $('entry-status').value, p_kind: $('entry-kind').value, p_expected_version: editing ? editing.version : 0 });
    if (id === $('team-select').value) { team = result; dirty = false; renderTeam(); notice('Shared work saved. A completed state is your declaration, not an independent acceptance test.'); }
  });
  onButton('delete-entry', async () => { if (!editing || !confirm('Remove this shared entry from the city?')) return; const id = team.id, result = await api.rpc('col_delete_entry', { p_team_id: id, p_entry_id: editing.id, p_expected_version: editing.version }); if (id === $('team-select').value) { team = result; dirty = false; renderTeam(); notice('Shared entry removed.'); } });
  onForm('issue-invite', async () => { const id = team.id, issued = await api.rpc('col_issue_team_invite', { p_team_id: id, p_role: $('invite-role').value }); if (id !== $('team-select').value) return; issuedInvite = { token: issued.token, teamId: id }; $('team-link').value = apiTools.inviteLink(api.config, issued.token, 'team'); $('team-expiry').textContent = 'Single-use invitation · expires ' + new Date(issued.expires_at).toLocaleString() + '. Save this link now; its code is not shown again after reload.'; $('team-invitation').hidden = false; await loadTeam(); notice('Team invitation created. It is separate from your personal invitation.'); });
  onButton('copy-team', () => copy($('team-link')));
  onButton('revoke-all-invites', async () => { if (!confirm('Revoke all unused invitations to this team city? Existing members keep their access.')) return; const id = team.id, result = await api.rpc('col_revoke_team_invites', { p_team_id: id }); if (id === $('team-select').value) { team = result; issuedInvite = null; $('team-link').value = ''; $('team-invitation').hidden = true; renderTeam(); notice('All unused team invitations were revoked.'); } });
  onButton('revoke-team', async () => { if (!issuedInvite) return; await api.rpc('col_revoke_team_invite', { p_team_id: issuedInvite.teamId, p_token: issuedInvite.token }); issuedInvite = null; $('team-link').value = ''; $('team-invitation').hidden = true; await loadTeam(); notice('This team invitation was revoked.'); });
  onButton('admin-prev', async () => { adminOffset = Math.max(0, adminOffset - 50); await loadAdmin(); });
  onButton('admin-next', async () => { adminOffset += 50; await loadAdmin(); });
  document.addEventListener('visibilitychange', pollSchedule);
  window.addEventListener('offline', connection); window.addEventListener('online', connection);
  window.addEventListener('pagehide', () => { clearTimeout(timer); ownerToken = ''; pending.team = ''; if (api) api.clear(); });
  window.addEventListener('pageshow', event => { if (event.persisted) { signedOut(); connection(); } });
  async function start() {
    pendingSummary(); if (hintError) notice(hintError, true);
    try {
      const response = await fetch('config.json', { credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer' });
      if (!response.ok) throw new Error('Community configuration is unavailable.');
      const config = apiTools.configValue(await response.json());
      if (!config) throw new Error('Community configuration is not active.');
      if (new URL(config.portalUrl).origin !== location.origin || new URL(config.portalUrl).pathname !== location.pathname.replace(/index\.html$/, '')) throw new Error('Open the configured community portal to sign in.');
      api = apiTools.create(config); $('signin').hidden = false;
    } catch (_) { $('unavailable').hidden = false; }
    connection();
  }
  start();
})();
