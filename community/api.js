/* City of Light community API. Sessions deliberately stay in memory. */
(function (root) {
  'use strict';
  function configValue(input) {
    if (!input || !input.supabaseUrl || !input.publishableKey || !input.portalUrl) return null;
    const api = new URL(input.supabaseUrl), portal = new URL(input.portalUrl);
    const local = url => ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if ((api.protocol !== 'https:' && !(api.protocol === 'http:' && local(api))) || api.username || api.password || api.search || api.hash || !['', '/'].includes(api.pathname)) throw new Error('Invalid community service URL.');
    if ((portal.protocol !== 'https:' && !(portal.protocol === 'http:' && local(portal))) || portal.username || portal.password || portal.search || portal.hash) throw new Error('Invalid community portal URL.');
    const key = String(input.publishableKey);
    if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) {
      let payload;
      try {
        const part = key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
        payload = JSON.parse(typeof atob === 'function' ? atob(part) : Buffer.from(part, 'base64').toString());
      } catch (_) { throw new Error('Use a public publishable or anon key.'); }
      if (payload.role !== 'anon') throw new Error('Private service keys must never be used in the browser.');
    }
    return Object.freeze({ supabaseUrl: api.origin, publishableKey: key, portalUrl: portal.href });
  }
  function create(input, options) {
    const config = configValue(input);
    if (!config) throw new Error('The account service is not configured. Free local worlds remain available.');
    const env = options || {}, fetcher = env.fetch || root.fetch.bind(root), now = env.now || Date.now;
    let session = null, refreshing = null, generation = 0;
    function clear() { generation += 1; session = null; }
    async function request(path, body, accessToken) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      try {
        const headers = { apikey: config.publishableKey, 'Content-Type': 'application/json' };
        if (accessToken) headers.Authorization = 'Bearer ' + accessToken;
        const response = await fetcher(config.supabaseUrl + path, {
          method: 'POST', headers, body: JSON.stringify(body || {}), signal: controller.signal,
          credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store'
        });
        const raw = await response.text();
        let data;
        try { data = raw ? JSON.parse(raw) : null; } catch (_) { throw new Error('The service returned an unreadable response.'); }
        if (!response.ok) {
          const error = new Error(String(data && (data.msg || data.message || data.error_description || data.error) || 'Request failed.').slice(0, 300));
          error.status = response.status;
          error.code = data && data.code;
          throw error;
        }
        return data;
      } catch (error) {
        if (error.name === 'AbortError') throw new Error('The service did not respond in time. Refresh before repeating a change.');
        throw error;
      } finally { clearTimeout(timeout); }
    }
    function setSession(data, expectedGeneration) {
      if (expectedGeneration !== generation) throw new Error('This sign-in session was cancelled.');
      if (!data || typeof data.access_token !== 'string' || typeof data.refresh_token !== 'string' || !data.user || !data.user.id || !Number.isFinite(Number(data.expires_in))) throw new Error('The sign-in response is incomplete.');
      session = { access: data.access_token, refresh: data.refresh_token, expires: now() + Number(data.expires_in) * 1000 };
      return { id: data.user.id, email: data.user.email || '' };
    }
    async function ensureSession() {
      if (!session) throw new Error('Please sign in again.');
      if (session.expires > now() + 60000) return session.access;
      if (!refreshing) {
        const current = generation, refresh = session.refresh;
        refreshing = request('/auth/v1/token?grant_type=refresh_token', { refresh_token: refresh }).then(data => {
          setSession(data, current);
          return session.access;
        }).catch(error => { if (current === generation) clear(); throw error; }).finally(() => { refreshing = null; });
      }
      return refreshing;
    }
    return Object.freeze({
      config,
      get signedIn() { return !!session; },
      async sendCode(email) {
        return request('/auth/v1/otp', { email: String(email).trim(), create_user: true });
      },
      async verifyCode(email, token) {
        const current = generation;
        const data = await request('/auth/v1/verify', verificationBody(config, email, token));
        if (!data || !data.user || String(data.user.email).toLowerCase() !== String(email).trim().toLowerCase()) throw new Error('This sign-in credential belongs to another email. Start again with the matching email.');
        return setSession(data, current);
      },
      async rpc(name, body) {
        if (!/^col_[a-z_]+$/.test(name)) throw new Error('Unsupported community action.');
        const access = await ensureSession(), current = generation;
        const result = await request('/rest/v1/rpc/' + name, body, access);
        if (current !== generation) throw new Error('This sign-in session was cancelled.');
        return result;
      },
      async signOut() {
        const access = session && session.access;
        clear();
        if (access) await request('/auth/v1/logout?scope=local', {}, access);
      },
      clear
    });
  }
  function inviteLink(config, token, type) {
    if (!/^[A-Za-z0-9_-]{16,128}$/.test(String(token))) throw new Error('Invalid invitation code.');
    const url = new URL(config.portalUrl);
    if (type === 'team') url.hash = 'team=' + encodeURIComponent(token);
    else url.searchParams.set('ref', token);
    return url.href;
  }
  function verificationBody(config, email, value) {
    const text = String(value).trim();
    if (/^[0-9]{6,10}$/.test(text)) return { email: String(email).trim(), token: text, type: 'email' };
    let url;
    try { url = new URL(text); } catch (_) { throw new Error('Enter the email code or paste the original sign-in link from your email.'); }
    if (url.origin !== config.supabaseUrl || url.pathname !== '/auth/v1/verify' || url.username || url.password || url.hash) throw new Error('This is not a sign-in link from this community service.');
    const seen = new Set();
    for (const [key] of url.searchParams) {
      if (seen.has(key) || !['token', 'token_hash', 'type', 'redirect_to'].includes(key)) throw new Error('This sign-in link has unexpected parameters.');
      seen.add(key);
    }
    const token = url.searchParams.get('token') || url.searchParams.get('token_hash'), type = url.searchParams.get('type');
    if ((seen.has('token') && seen.has('token_hash')) || !/^[A-Za-z0-9_-]{16,256}$/.test(String(token)) || !['email', 'magiclink', 'signup'].includes(type)) throw new Error('This sign-in link is incomplete or unsupported.');
    return { token_hash: token, type };
  }
  const api = Object.freeze({ configValue, create, inviteLink, verificationBody });
  root.CityCommunityAPI = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window === 'undefined' ? globalThis : window);
