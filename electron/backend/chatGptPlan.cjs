// Official SIWC public-client flow. No browser cookies, Codex process, API key or client secret.
const http = require('node:http');
const { randomUUID, randomBytes, createHash, createPublicKey, verify, timingSafeEqual } = require('node:crypto');
const { jsonRequest, request, consumeSse } = require('./remoteHttp.cjs');
const { ProtectedSettings } = require('./protectedSettings.cjs');
const ISSUER = 'https://auth.openai.com';
const RESOURCE = 'https://api.openai.com/v1';
const scopes = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
const empty = () => ({ hostId: `urn:uuid:${randomUUID()}`, accounts: [], selectedId: null });
function same(a, b) { return typeof a === 'string' && typeof b === 'string' && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b)); }
function validateIdToken(token, { jwks, clientId, nonce, subject, now = Date.now() }) {
  try {
    const parts = token.split('.'); if (parts.length !== 3) throw new Error();
    const header = JSON.parse(Buffer.from(parts[0], 'base64url')); const claims = JSON.parse(Buffer.from(parts[1], 'base64url'));
    const key = jwks.keys.find(k => k.kid === header.kid && k.kty === 'RSA' && (!k.use || k.use === 'sig') && (!k.alg || k.alg === 'RS256'));
    if (header.alg !== 'RS256' || !key || !verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), createPublicKey({ key, format: 'jwk' }), Buffer.from(parts[2], 'base64url'))) throw new Error();
    const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (claims.iss !== ISSUER || !audience.includes(clientId) || audience.length > 1 && claims.azp !== clientId || !Number.isFinite(claims.exp) || claims.exp * 1000 <= now || claims.nbf && claims.nbf * 1000 > now + 30000 || !claims.sub || nonce && !same(claims.nonce, nonce) || subject && claims.sub !== subject) throw new Error();
    return claims;
  } catch { throw new Error('ChatGPT 身份验证失败，未启用该连接。请重新授权。'); }
}
class ChatGptPlan {
  constructor(context) {
    this.vault = new ProtectedSettings(context, 'chatgpt-plan.enc'); this.json = context.planJsonRequest || jsonRequest; this.http = context.planRequest || request;
    this.pending = null; this.refreshing = null; this.lastError = ''; this.inferenceVerified = false; this.controllers = new Set(); this.sessionVersion = 0;
  }
  async data() { return this.vault.update(value => { if (!value.hostId) Object.assign(value, empty()); return structuredClone(value); }); }
  async discovery() {
    const info = await this.json(`${ISSUER}/.well-known/openid-configuration`);
    if (info.issuer !== ISSUER || !info.jwks_uri || new URL(info.jwks_uri).origin !== ISSUER || info.revocation_endpoint && new URL(info.revocation_endpoint).origin !== ISSUER) throw new Error('OpenAI 发现文档无效。');
    return info;
  }
  async account() {
    const data = await this.data(); const selected = data.accounts.find(a => a.id === data.selectedId);
    return { connected: !!selected?.access_token, planEnabled: !!selected?.scopes?.includes('chatgpt.tokens.use.direct'), selectedId: data.selectedId, inferenceVerified: this.inferenceVerified,
      selectedModel: selected?.model || null, connecting: !!this.pending, error: this.lastError, accounts: data.accounts.map(a => ({ id: a.id, label: `${a.email || a.subject} · ${a.client_id.slice(-8)}`, signedIn: !!a.access_token })), email: selected?.email || null };
  }
  async login(shell, { accountId, newAccount = false } = {}) {
    this.cancelLogin(); this.lastError = '';
    const data = await this.data(); const selected = !newAccount && data.accounts.find(a => a.id === (accountId || data.selectedId));
    const state = randomBytes(32).toString('base64url'); const nonce = randomBytes(32).toString('base64url'); const verifier = randomBytes(48).toString('base64url');
    const server = http.createServer(); const pending = { server, state, nonce, verifier, selected, data, controller: new AbortController(), processing: false }; this.pending = pending;
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    pending.redirectUri = `http://127.0.0.1:${server.address().port}/auth/callback`;
    const timer = setTimeout(() => { if (this.pending === pending) { this.lastError = '授权等待超时，请重新连接。'; this.cancelLogin(); } }, 300000); timer.unref?.(); pending.timer = timer;
    server.on('request', async (req, res) => {
      res.setHeader('Content-Type', 'text/plain; charset=utf-8'); res.setHeader('Cache-Control', 'no-store');
      const url = new URL(req.url, pending.redirectUri);
      if (req.method !== 'GET' || url.pathname !== '/auth/callback' || !same(url.searchParams.get('state'), state)) { res.writeHead(400); res.end('授权回调无效。'); return; }
      if (pending.processing) { res.writeHead(409); res.end('授权处理中。'); return; } pending.processing = true;
      try {
        if (url.searchParams.has('error')) throw new Error('授权未获批准。请在 ChatGPT 设置检查应用权限后重试。');
        const clientId = url.searchParams.get('client_id') || selected?.client_id;
        if (!clientId || clientId === 'dynamic_agent_client' || selected && clientId !== selected.client_id || !url.searchParams.get('code')) throw new Error('授权注册未完成，未保存连接。');
        const tokens = await this.token({ grant_type: 'authorization_code', client_id: clientId, code: url.searchParams.get('code'), code_verifier: verifier, redirect_uri: pending.redirectUri }, pending.controller.signal);
        const info = await this.discovery(); const jwks = await this.json(info.jwks_uri);
        const claims = validateIdToken(tokens.id_token, { jwks, clientId, nonce, subject: selected?.subject });
        const granted = String(tokens.scope || '').split(/\s+/);
        if (!tokens.access_token || !granted.includes('chatgpt.tokens.use.direct') || !granted.includes('resource.invoke')) throw new Error('已登录，但未获 ChatGPT 套餐推理权限。请重新授权并允许套餐使用。');
        if (this.pending !== pending || pending.controller.signal.aborted) throw new Error('授权已取消。');
        await this.vault.update(value => {
          const id = `${clientId}:${claims.sub}`; const entry = { id, client_id: clientId, subject: claims.sub, email: claims.email || '', ...this.tokenRecord(tokens), scopes: granted };
          value.accounts = [...value.accounts.filter(a => a.id !== id), entry]; value.selectedId = id;
        });
        this.sessionVersion++; for (const controller of this.controllers) controller.abort(); this.inferenceVerified = false; this.lastError = ''; res.end('PaperDesk 授权已完成。请返回工作站，选择模型并测试连接。');
      } catch (error) { this.lastError = error.message; res.writeHead(400); res.end(error.message); }
      finally { if (this.pending === pending) this.cancelLogin(); }
    });
    const params = new URLSearchParams({ client_id: selected?.client_id || 'dynamic_agent_client', ext_agent_host_id: data.hostId, response_type: 'code', redirect_uri: pending.redirectUri, scope: scopes, resource: RESOURCE, state, nonce, code_challenge_method: 'S256', code_challenge: createHash('sha256').update(verifier).digest('base64url') });
    if (!selected) params.set('agent_name_hint', 'PaperDesk');
    if (selected?.id_token) params.set('id_token_hint', selected.id_token);
    if (selected?.email) params.set('login_hint', selected.email);
    try { await shell.openExternal(`${ISSUER}/api/accounts/authorize?${params}`); }
    catch { this.cancelLogin(); throw new Error('无法打开默认浏览器，请重试。'); }
    return { started: true };
  }
  tokenRecord(tokens) {
    if (!tokens.access_token || !Number.isFinite(tokens.expires_in) || tokens.expires_in <= 0 || String(tokens.token_type).toLowerCase() !== 'bearer') throw new Error('OpenAI 返回的凭据不完整，请重新授权。');
    return { access_token: tokens.access_token, refresh_token: tokens.refresh_token, id_token: tokens.id_token, expiresAt: Date.now() + tokens.expires_in * 1000 };
  }
  token(fields, signal) { return this.json(`${ISSUER}/api/accounts/oauth/token`, { method: 'POST', signal, headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ ...fields, resource: RESOURCE }).toString() }); }
  async credentials() {
    let data = await this.data(); let account = data.accounts.find(a => a.id === data.selectedId);
    if (!account?.access_token) throw new Error('请先连接 ChatGPT 套餐。');
    if (account.expiresAt <= Date.now() + 60000) {
      if (!account.refresh_token) throw new Error('ChatGPT 授权已到期，请重新连接。');
      if (!this.refreshing) this.refreshing = (async () => {
        const tokens = await this.token({ grant_type: 'refresh_token', client_id: account.client_id, refresh_token: account.refresh_token });
        if (tokens.id_token) { const info = await this.discovery(); validateIdToken(tokens.id_token, { jwks: await this.json(info.jwks_uri), clientId: account.client_id, subject: account.subject }); }
        const granted = tokens.scope ? tokens.scope.split(/\s+/) : account.scopes;
        if (!granted.includes('chatgpt.tokens.use.direct')) throw new Error('ChatGPT 套餐权限已撤销，请重新授权。');
        const record = this.tokenRecord(tokens);
        await this.vault.update(value => { const current = value.accounts.find(a => a.id === account.id); if (!current?.access_token || current.refresh_token !== account.refresh_token) throw new Error('账户连接已变更，请重试。'); Object.assign(current, record, { refresh_token: tokens.refresh_token || current.refresh_token, id_token: tokens.id_token || current.id_token, scopes: granted }); });
      })().finally(() => { this.refreshing = null; });
      await this.refreshing; data = await this.data(); account = data.accounts.find(a => a.id === data.selectedId);
    }
    return account;
  }
  async select(accountId) { this.close(); await this.vault.update(value => { if (!value.accounts.some(a => a.id === accountId)) throw new Error('账户不存在。'); value.selectedId = accountId; }); this.inferenceVerified = false; return this.account(); }
  async models(accountOverride) {
    const account = accountOverride || await this.credentials(); const result = await this.json(`${RESOURCE}/models`, { headers: { Authorization: `Bearer ${account.access_token}` } });
    return (result.models || []).filter(m => m.visibility === 'list' && typeof m.slug === 'string').map(m => ({ id: m.slug, label: m.display_name || m.slug }));
  }
  async complete(prompt, { signal, onDelta, model, timeout = 180000 } = {}) {
    const version = this.sessionVersion; const account = await this.credentials(); const models = await this.models(account);
    if (version !== this.sessionVersion) throw new Error('账户连接已切换，请重试。');
    const selected = model || account.model || models[0]?.id;
    if (!models.some(m => m.id === selected)) throw new Error('所选模型不在当前账户目录中，请刷新模型。');
    const controller = new AbortController(); this.controllers.add(controller); const abort = () => controller.abort(); signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort();
    let text = ''; let completed = false;
    try {
      const res = await this.http(`${RESOURCE}/responses`, { method: 'POST', timeout, signal: controller.signal, maxBytes: 12 * 1024 * 1024, headers: { Authorization: `Bearer ${account.access_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: selected, input: [{ role: 'user', content: prompt }], store: false, stream: true }) });
      await consumeSse(res, event => {
        if (event.type === 'response.output_text.delta' && typeof event.delta === 'string') { text += event.delta; onDelta?.(event.delta); }
        if (['response.failed', 'response.incomplete', 'error'].includes(event.type)) throw new Error(`ChatGPT 请求未完成（${event.response?.error?.code || event.error?.code || event.type}）。未保存为成功报告。`);
        if (event.type === 'response.completed') completed = true;
      });
      if (!completed || !text.trim()) throw new Error('ChatGPT 响应中断或没有正文，未保存不完整报告。');
      this.inferenceVerified = true; return text;
    } finally { signal?.removeEventListener('abort', abort); this.controllers.delete(controller); }
  }
  async setModel(model) { const models = await this.models(); if (!models.some(m => m.id === model)) throw new Error('模型不可用。'); await this.vault.update(value => { value.accounts.find(a => a.id === value.selectedId).model = model; }); return { model }; }
  async logout() {
    this.close(); const data = await this.data(); const account = data.accounts.find(a => a.id === data.selectedId); let revoked = !account?.refresh_token;
    if (account?.refresh_token) {
      try { const info = await this.discovery(); if (info.revocation_endpoint) { const res = await this.http(info.revocation_endpoint, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: account.refresh_token, token_type_hint: 'refresh_token', client_id: account.client_id }).toString(), timeout: 10000 }); res.resume(); revoked = true; } } catch { /* Local sign-out still removes credentials. */ }
    }
    await this.vault.update(value => { const entry = value.accounts.find(a => a.id === data.selectedId); if (entry) for (const key of ['access_token', 'refresh_token', 'id_token', 'expiresAt']) delete entry[key]; });
    this.inferenceVerified = false; return { connected: false, remoteRevocationConfirmed: revoked };
  }
  cancelLogin() { if (this.pending) { clearTimeout(this.pending.timer); this.pending.controller.abort(); this.pending.server.close(); this.pending = null; } }
  close() { this.sessionVersion++; this.cancelLogin(); for (const controller of this.controllers) controller.abort(); }
}
module.exports = { ChatGptPlan, validateIdToken, ISSUER, RESOURCE };
