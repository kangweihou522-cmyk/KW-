// PaperDesk modification: the desktop backend never calls hosted AI/services.
// ChatGPT assistance opens the user's browser only after an explicit action.
function assertLocalUrl(input) {
  let url;
  try {
    url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  } catch {
    throw new Error('本地模式：请求地址无效。');
  }
  const host = url.hostname.toLowerCase();
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
      !(host === 'localhost' || host === '[::1]' || /^127\.\d+\.\d+\.\d+$/.test(host))) {
    throw new Error('本地模式已阻止外部服务请求。请使用本机 Ollama；ChatGPT 辅助请通过浏览器手动提交选定材料。');
  }
  return url;
}

function createLocalOnlyFetch(originalFetch) {
  return async function localOnlyFetch(input, init = {}) {
    assertLocalUrl(input);
    // A local service may not redirect documents or credentials to a cloud API.
    return originalFetch(input, { ...init, redirect: 'error' });
  };
}

let installed = false;
function installLocalNetworkPolicy() {
  if (installed) return;
  globalThis.fetch = createLocalOnlyFetch(globalThis.fetch.bind(globalThis));
  installed = true;
}

module.exports = { assertLocalUrl, createLocalOnlyFetch, installLocalNetworkPolicy };
