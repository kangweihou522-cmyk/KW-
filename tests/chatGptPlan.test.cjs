const test = require('node:test'); const assert = require('node:assert/strict');
const { generateKeyPairSync, sign } = require('node:crypto'); const { Readable } = require('node:stream'); const http = require('node:http');
const fs = require('node:fs/promises'); const path = require('node:path'); const os = require('node:os');
const { ChatGptPlan, validateIdToken, ISSUER } = require('../electron/backend/chatGptPlan.cjs');
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwks = { keys: [{ ...publicKey.export({ format: 'jwk' }), kid: 'fixture-key', alg: 'RS256', use: 'sig' }] };
function token(claims = {}) { const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'fixture-key' })).toString('base64url'); const data = Buffer.from(JSON.stringify({ iss: ISSUER, aud: 'oaiapp_test', sub: 'fixture-person', exp: Math.floor(Date.now()/1000) + 3600, nonce: 'nonce', email: 'fictional@example.invalid', ...claims })).toString('base64url'); return `${header}.${data}.${sign('RSA-SHA256', Buffer.from(`${header}.${data}`), privateKey).toString('base64url')}`; }
const safeStorage = { isEncryptionAvailable: () => true, encryptString: s => Buffer.from(Buffer.from(s).toString('base64')), decryptString: b => Buffer.from(b.toString(), 'base64').toString() };
async function fixture(t, overrides = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'paperdesk-plan-')); t.after(() => fs.rm(dir, { recursive: true, force: true }));
  let auth; const calls = [];
  const context = { appPaths: { dataDir: dir }, safeStorage, planJsonRequest: async (url, opts) => {
    calls.push({ url, opts });
    if (url.endsWith('openid-configuration')) return { issuer: ISSUER, jwks_uri: `${ISSUER}/jwks`, revocation_endpoint: `${ISSUER}/revoke` };
    if (url.endsWith('/jwks')) return jwks;
    if (url.endsWith('/oauth/token')) return { access_token: 'fixture-access', refresh_token: 'fixture-refresh', id_token: token({nonce: auth.searchParams.get('nonce')}), token_type: 'Bearer', expires_in: 3600, scope: 'openid email profile offline_access resource.invoke chatgpt.tokens.use.direct' };
    if (url.endsWith('/models')) return { models: [{ slug: 'account-specific', display_name: 'Fixture model', visibility: 'list' }, {slug:'hidden', visibility:'hidden'}] };
    throw new Error('unexpected URL');
  }, planRequest: async (url, options) => { calls.push({url,options}); return Readable.from([Buffer.from('data: {"type":"response.output_text.delta","delta":"虚构测试"}\n\ndata: {"type":"response.completed"}\n\n')]); }, ...overrides };
  const plan = new ChatGptPlan(context); t.after(() => plan.close());
  async function login() {
    await plan.login({ openExternal(url) { auth = new URL(url); } });
    const callback = new URL(auth.searchParams.get('redirect_uri')); callback.searchParams.set('state', auth.searchParams.get('state')); callback.searchParams.set('code', 'fixture-code'); callback.searchParams.set('client_id', 'oaiapp_test');
    await new Promise((resolve, reject) => { http.get(callback, res => { const data=[]; res.on('data',c=>data.push(c)); res.on('end',()=>res.statusCode===200 ? resolve() : reject(new Error(Buffer.concat(data).toString()))); }).on('error',reject); });
  }
  return {plan,login,calls,context,auth:()=>auth};
}
test('SIWC ID tokens require a real signature, matching issuer, audience, nonce and account', () => {
 const options = {jwks,clientId:'oaiapp_test',nonce:'nonce'}; assert.equal(validateIdToken(token(),options).sub,'fixture-person');
 for(const claims of [{iss:'https://example.invalid'},{aud:'wrong'},{nonce:'wrong'},{exp:1}]) assert.throws(()=>validateIdToken(token(claims),options),/身份验证失败/);
 assert.throws(()=>validateIdToken(token(),{...options,subject:'other'}),/身份验证失败/);
 assert.throws(()=>validateIdToken(token().slice(0,-8)+'tampered',options),/身份验证失败/);
});
test('official dynamic OAuth binds state/PKCE/nonce, stores client registration and uses only listed account models', async t => {
 const f=await fixture(t); await f.login(); const status=await f.plan.account(); assert.equal(status.connected,true); assert.equal(status.inferenceVerified,false);
 assert.equal(f.auth().searchParams.get('client_id'),'dynamic_agent_client'); assert(f.auth().searchParams.get('ext_agent_host_id').startsWith('urn:uuid:'));
 const exchange=f.calls.find(c=>c.url.endsWith('/oauth/token')); const form=new URLSearchParams(exchange.opts.body); assert.equal(form.get('client_id'),'oaiapp_test'); assert.equal(form.get('resource'),'https://api.openai.com/v1'); assert(form.get('code_verifier'));
 assert.deepEqual(await f.plan.models(),[{id:'account-specific',label:'Fixture model'}]); assert.equal(await f.plan.complete('Fictional prompt'),'虚构测试');
 const body=JSON.parse(f.calls.find(c=>c.url.endsWith('/responses')).options.body); assert.equal(body.model,'account-specific');assert.equal(body.stream,true);assert.equal(body.store,false);
 assert.equal((await f.plan.account()).inferenceVerified,true);
 const before=f.auth().searchParams.get('ext_agent_host_id'); await f.plan.login({openExternal(url){const next=new URL(url);assert.equal(next.searchParams.get('client_id'),'oaiapp_test');assert.equal(next.searchParams.get('ext_agent_host_id'),before);assert(next.searchParams.has('id_token_hint'));assert(!next.searchParams.has('agent_name_hint'));}});
});
test('an interrupted or failed Responses stream is never reported as successful inference', async t => {
 const f=await fixture(t,{planRequest:async()=>Readable.from([Buffer.from('data: {"type":"response.output_text.delta","delta":"partial"}\n\n')])}); await f.login();await assert.rejects(f.plan.complete('test'),/中断/);assert.equal((await f.plan.account()).inferenceVerified,false);
 f.plan.http=async()=>Readable.from([Buffer.from('data: {"type":"response.failed","response":{"error":{"code":"subscription_sharing_usage_limit_exceeded"}}}\n\n')]);await assert.rejects(f.plan.complete('test'),/usage_limit/);
});
test('wrong callback state never triggers a code exchange or activates an account', async t => {
 const f=await fixture(t);await f.plan.login({openExternal(url){f.callback=new URL(new URL(url).searchParams.get('redirect_uri'));}});f.callback.searchParams.set('state','wrong');f.callback.searchParams.set('code','ignored');
 await new Promise((resolve,reject)=>http.get(f.callback,r=>{assert.equal(r.statusCode,400);r.resume();r.on('end',resolve)}).on('error',reject));assert.equal((await f.plan.account()).connected,false);assert.equal(f.calls.length,0);
});
