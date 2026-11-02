const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { SecureSettings, atomicJson } = require('./secureSettings.cjs');
const { serviceRequest } = require('./serviceHttp.cjs');

const AUTH = 'https://auth.openai.com';
const API = 'https://api.openai.com/v1';
const SCOPES = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
const PERMISSION = 'chatgpt.tokens.use.direct';
const FIXED_HOSTS = ['auth.openai.com', 'api.openai.com'];
function same(left, right) {
  const a = Buffer.from(String(left || '')); const b = Buffer.from(String(right || ''));
  return a.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
}
function directError(result) {
  const code = String(result.json?.error?.code || '');
  const messages = {
    subscription_sharing_user_not_eligible: '当前账户、套餐、地区或权限不符合 ChatGPT 套餐授权条件。可使用免费报告备用渠道，无需反复登录。',
    subscription_sharing_usage_limit_exceeded: 'ChatGPT 套餐或此应用的使用额度已达上限。请查看 ChatGPT 设置中的用量；本地报告仍可编辑。',
    subscription_sharing_usage_unavailable: 'ChatGPT 暂时无法确认套餐额度，请稍后重试。',
    subscription_sharing_unsupported_capability: '所选模型不支持本次请求的能力，请切换账户可用模型。',
    subscription_sharing_route_not_supported: 'ChatGPT 套餐授权不支持本次接口。',
  };
  const error = new Error(messages[code] || `ChatGPT 官方接口暂不可用（HTTP ${result.status}${code ? `，${code.replace(/[^a-z0-9_]/gi, '').slice(0, 100)}` : ''}）。网页登录与应用授权相互独立。`);
  error.code = code; error.status = result.status; return error;
}

class ChatGptPlan {
  constructor(context) {
    this.context = context; this.request = context.planRequest || serviceRequest;
    this.credentials = new SecureSettings(context, 'chatgpt-plan');
    this.hostFile = path.join(context.appPaths.dataDir, '.settings', 'chatgpt-host.json');
    this.pending = null; this.lastError = ''; this.refreshing = null; this.catalog = null; this.jwks = null;
    this.generation = 0; this.mutations = Promise.resolve();
  }
  mutate(action) { const job = this.mutations.catch(() => {}).then(action); this.mutations = job; return job; }
  async hostId() {
    let record;
    try { record = JSON.parse(await fs.readFile(this.hostFile, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (record) {
      if (!/^urn:uuid:[0-9a-f-]{36}$/i.test(record.id)) throw new Error('本机 ChatGPT 连接标识损坏，已停止授权。');
      return record.id;
    }
    const id = `urn:uuid:${crypto.randomUUID()}`; await atomicJson(this.hostFile, { id }); return id;
  }
  call(url, options = {}) { return this.request(url, { ...options, allowedHosts: FIXED_HOSTS }); }
  async account() {
    const saved = await this.credentials.read();
    return { connected: !!saved?.scopes?.includes(PERMISSION), method: 'chatgpt-plan',
      plan: saved?.plan || null, email: saved?.email || null, verified: !!saved?.verified,
      model: saved?.model || null, connecting: !!this.pending, error: this.lastError };
  }
  async keys() {
    if (this.jwks && this.jwks.expires > Date.now()) return this.jwks.keys;
    const discovery = await this.call(`${AUTH}/.well-known/openid-configuration`, { timeout: 20000 });
    if (discovery.status !== 200 || discovery.json?.issuer !== AUTH) throw new Error('无法验证 OpenAI 身份服务元数据。');
    const address = new URL(discovery.json.jwks_uri);
    if (address.origin !== AUTH || address.username || address.password) throw new Error('OpenAI 签名密钥地址异常。');
    const response = await this.call(address.href, { timeout: 20000 });
    if (response.status !== 200 || !Array.isArray(response.json?.keys)) throw new Error('无法取得 OpenAI 身份签名密钥。');
    this.jwks = { expires: Date.now() + 3600000, keys: response.json.keys }; return this.jwks.keys;
  }
  async verifyIdToken(token, { clientId, nonce, subject } = {}) {
    if (typeof token !== 'string' || token.length > 40000) throw new Error('OpenAI 身份令牌格式无效。');
    const parts = token.split('.');
    if (parts.length !== 3) throw new Error('OpenAI 身份令牌格式无效。');
    const header = JSON.parse(Buffer.from(parts[0], 'base64url'));
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url'));
    if (!['RS256', 'ES256'].includes(header.alg) || !header.kid) throw new Error('OpenAI 身份签名算法无效。');
    let keys = await this.keys();
    if (!keys.some(key => key.kid === header.kid)) { this.jwks = null; keys = await this.keys(); }
    const key = keys.find(item => item.kid === header.kid && (!item.use || item.use === 'sig') && (!item.alg || item.alg === header.alg));
    if (!key || key.kty !== (header.alg === 'RS256' ? 'RSA' : 'EC')) throw new Error('OpenAI 身份签名密钥不匹配。');
    const publicKey = crypto.createPublicKey({ key, format: 'jwk' });
    const valid = crypto.verify(header.alg === 'RS256' ? 'RSA-SHA256' : 'sha256', Buffer.from(`${parts[0]}.${parts[1]}`),
      header.alg === 'ES256' ? { key: publicKey, dsaEncoding: 'ieee-p1363' } : publicKey, Buffer.from(parts[2], 'base64url'));
    const now = Date.now() / 1000;
    if (!valid || claims.iss !== AUTH || !(Array.isArray(claims.aud) ? claims.aud.includes(clientId) : claims.aud === clientId) ||
      !Number.isFinite(claims.exp) || claims.exp < now - 30 || claims.nbf > now + 60 || claims.iat > now + 60 ||
      Array.isArray(claims.aud) && claims.aud.length > 1 && claims.azp !== clientId ||
      !claims.sub || nonce && !same(claims.nonce, nonce) || subject && claims.sub !== subject) throw new Error('OpenAI 身份验证失败，未保存本次连接。');
    return claims;
  }
  async login(shell) {
    if (this.pending) return { started: true };
    const hostId = await this.hostId(); const saved = await this.credentials.read();
    const state = crypto.randomBytes(32).toString('base64url'); const nonce = crypto.randomBytes(32).toString('base64url');
    const verifier = crypto.randomBytes(48).toString('base64url');
    const server = http.createServer();
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const redirect = `http://127.0.0.1:${server.address().port}/auth/callback`;
    const generation = ++this.generation;
    const pending = { server, state, nonce, verifier, redirect, hostId, saved, timer: null };
    this.pending = pending; this.lastError = '';
    const finish = () => { clearTimeout(pending.timer); server.close(); if (this.pending === pending) this.pending = null; };
    pending.timer = setTimeout(() => { this.lastError = '浏览器授权尚未完成，可重新连接或使用免费报告渠道。'; finish(); }, 10 * 60000);
    server.on('request', async (request, response) => {
      const url = new URL(request.url, redirect);
      response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.setHeader('Cache-Control', 'no-store');
      response.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'");
      if (url.pathname !== '/auth/callback') { response.writeHead(404); response.end(); return; }
      if (request.method !== 'GET' || !same(url.searchParams.get('state'), state)) { response.writeHead(400); response.end('授权状态不匹配。请返回 PaperDesk。'); return; }
      if (pending.handling) { response.writeHead(409); response.end('正在处理授权。'); return; }
      pending.handling = true;
      try {
        if (url.searchParams.has('error')) throw new Error('未取得 ChatGPT 套餐使用授权。可稍后重新连接，或选择免费报告渠道。');
        const issued = url.searchParams.get('client_id') || saved?.clientId;
        if (!issued || !/^[a-zA-Z0-9_.-]{5,200}$/.test(issued) || issued === 'dynamic_agent_client' || saved && issued !== saved.clientId || !url.searchParams.get('code')) throw new Error('ChatGPT 动态注册未完成，未取得应用客户端标识。');
        const form = new URLSearchParams({ grant_type: 'authorization_code', client_id: issued, code: url.searchParams.get('code'), code_verifier: verifier, redirect_uri: redirect, resource: API });
        const result = await this.call(`${AUTH}/api/accounts/oauth/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form.toString(), timeout: 30000 });
        if (result.status !== 200) throw new Error(`ChatGPT 授权交换失败（HTTP ${result.status}），请重新连接。`);
        const tokens = result.json; const scopes = String(tokens.scope || '').split(/\s+/);
        if (!scopes.includes(PERMISSION) || !scopes.includes('resource.invoke') || !tokens.access_token || tokens.token_type?.toLowerCase() !== 'bearer') throw new Error('已登录，但未授予 ChatGPT 套餐使用权限；普通网页登录不能替代此授权。');
        const claims = await this.verifyIdToken(tokens.id_token, { clientId: issued, nonce, subject: saved?.subject });
        await this.mutate(async () => {
          if (generation !== this.generation || this.pending !== pending) throw new Error('授权操作已取消，未保存凭据。');
          await this.credentials.write({ clientId: issued, hostId, subject: claims.sub, email: claims.email || null,
          plan: claims['https://api.openai.com/auth']?.chatgpt_plan_type || null, scopes, tokens,
          expiresAt: Date.now() + Math.min(Number(tokens.expires_in) || 3600, 86400) * 1000, verified: false, model: saved?.model || null });
        });
        if (generation !== this.generation) throw new Error('授权操作已取消。');
        this.catalog = null; this.lastError = ''; response.end('<h2>PaperDesk 已取得套餐授权</h2><p>请返回工作站测试连接。授权不代表模型请求已经成功。</p>');
      } catch (error) {
        this.lastError = error.message; response.writeHead(400); response.end('<h2>PaperDesk 连接未完成</h2><p>请返回工作站查看原因；已有本地内容不受影响。</p>');
      } finally { finish(); }
    });
    const url = new URL(`${AUTH}/api/accounts/authorize`);
    const parameters = { client_id: saved?.clientId || 'dynamic_agent_client', ext_agent_host_id: hostId, response_type: 'code',
      redirect_uri: redirect, scope: SCOPES, resource: API, state, nonce, code_challenge: crypto.createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' };
    if (saved?.clientId) { if (saved.tokens?.id_token) parameters.id_token_hint = saved.tokens.id_token; }
    else parameters.agent_name_hint = 'PaperDesk';
    for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, value);
    try { await shell.openExternal(url.href); } catch (error) { finish(); throw error; }
    return { started: true };
  }
  async token() {
    const generation = this.generation;
    const saved = await this.credentials.read();
    if (!saved?.scopes?.includes(PERMISSION)) throw new Error('请先连接 ChatGPT 套餐，或选择已配置的免费报告渠道。');
    if (saved.expiresAt > Date.now() + 60000) return saved;
    if (!saved.tokens.refresh_token) throw new Error('ChatGPT 授权已过期，请重新连接。');
    if (this.refreshing) return this.refreshing;
    this.refreshing = (async () => {
      const form = new URLSearchParams({ grant_type: 'refresh_token', client_id: saved.clientId, refresh_token: saved.tokens.refresh_token, resource: API });
      const result = await this.call(`${AUTH}/api/accounts/oauth/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form.toString(), timeout: 30000 });
      if (result.status !== 200) {
        const terminal = ['invalid_grant', 'invalid_refresh_token', 'refresh_token_expired', 'refresh_token_reused'].includes(result.json?.error);
        if (terminal) await this.mutate(async () => { if (generation === this.generation) await this.credentials.write({ ...saved, tokens: {}, scopes: [] }); });
        throw new Error(terminal ? 'ChatGPT 授权已失效，请重新连接。' : `ChatGPT 暂时无法更新授权（HTTP ${result.status}），已保留连接信息。`);
      }
      const tokens = result.json;
      const scopes = tokens.scope ? tokens.scope.split(/\s+/) : saved.scopes;
      if (!scopes.includes(PERMISSION) || !tokens.access_token) throw new Error('ChatGPT 更新授权未包含套餐使用权限。');
      if (tokens.id_token) await this.verifyIdToken(tokens.id_token, { clientId: saved.clientId, subject: saved.subject });
      return this.mutate(async () => {
        const current = await this.credentials.read();
        if (generation !== this.generation || current?.clientId !== saved.clientId || current?.tokens?.refresh_token !== saved.tokens.refresh_token) throw new Error('ChatGPT 授权已断开，未恢复旧凭据。');
        const next = { ...current, scopes, tokens: { ...saved.tokens, ...tokens }, expiresAt: Date.now() + Math.min(Number(tokens.expires_in) || 3600, 86400) * 1000 };
        await this.credentials.write(next); return next;
      });
    })().finally(() => { this.refreshing = null; });
    return this.refreshing;
  }
  async models() {
    const saved = await this.token();
    const result = await this.call(`${API}/models`, { headers: { Authorization: `Bearer ${saved.tokens.access_token}` }, timeout: 30000 });
    if (result.status !== 200) throw directError(result);
    const models = result.json?.models?.filter(item => item.visibility === 'list' && typeof item.slug === 'string').map(item => ({ id: item.slug, name: item.display_name || item.slug, context: item.context_window || item.context_length || 32000 }));
    if (!models?.length) throw new Error('当前 ChatGPT 账户没有可用于此应用的模型。');
    this.catalog = models; return models;
  }
  async selectModel(model) {
    const models = await this.models(); if (!models.some(item => item.id === model)) throw new Error('该模型不在账户可用列表中。');
    const saved = await this.token(); await this.credentials.write({ ...saved, model }); return model;
  }
  async complete(prompt, { signal, onDelta, timeout = 180000 } = {}) {
    const generation = this.generation;
    const models = this.catalog || await this.models(); const saved = await this.token();
    const model = models.find(item => item.id === saved.model)?.id || models[0].id;
    let text = ''; let completed = false; let failed = null;
    let result;
    try { result = await this.call(`${API}/responses`, { method: 'POST', signal, timeout,
      headers: { Authorization: `Bearer ${saved.tokens.access_token}`, 'Content-Type': 'application/json' },
      body: { model, input: [{ role: 'user', content: prompt }], store: false, stream: true },
      onEvent: event => {
        if (event.type === 'response.output_text.delta') { text += event.delta || ''; onDelta?.(event.delta || ''); }
        else if (event.type === 'response.failed' || event.type === 'error') failed = directError({ status: 400, json: { error: event.response?.error || event.error || event } });
        else if (event.type === 'response.incomplete') failed = new Error('ChatGPT 输出尚未完成，已保留草稿，请缩小本次材料范围。');
        else if (event.type === 'response.completed') completed = true;
      } }); } catch (error) { error.partialText = text; throw error; }
    if (result.status !== 200) throw directError(result);
    if (failed || !completed || !text.trim()) { const error = failed || new Error('ChatGPT 返回中断，未收到完整完成标志；没有将半份内容标记为报告。'); error.partialText = text; throw error; }
    // Do not resurrect an account disconnected while inference was running.
    await this.mutate(async () => {
      const current = await this.credentials.read();
      if (generation === this.generation && current?.clientId === saved.clientId && current.subject === saved.subject) await this.credentials.write({ ...current, verified: true, model });
    });
    this.lastModel = model; return text.trim();
  }
  async logout() { this.close(); this.catalog = null; this.lastError = ''; await this.mutate(() => this.credentials.remove()); return { connected: false }; }
  close() { this.generation++; if (this.pending) { clearTimeout(this.pending.timer); this.pending.server.close(); this.pending = null; } }
}
module.exports = { ChatGptPlan, directError, SCOPES, PERMISSION, same };
