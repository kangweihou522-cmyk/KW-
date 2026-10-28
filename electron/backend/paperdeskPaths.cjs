const fs = require('node:fs');
const path = require('node:path');

// Independent PaperDesk edition: keep user-owned data outside the application.
function resolvePaperDeskHome(app, options = {}) {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const exists = options.exists ?? fs.existsSync;
  const paths = platform === 'win32' ? path.win32 : path;
  const configured = String(env.PAPERDESK_HOME ?? '').trim();
  if (configured) {
    if (!paths.isAbsolute(configured)) {
      throw new Error('PAPERDESK_HOME must be an absolute folder path.');
    }
    return paths.normalize(configured);
  }
  if (platform === 'win32') {
    if (!exists('D:\\')) {
      throw new Error('PaperDesk 默认保存到 D:\\PaperDesk，但未找到 D 盘。请先设置 PAPERDESK_HOME 为你选择的绝对路径，再重新启动；不会自动改存 C 盘。');
    }
    return 'D:\\PaperDesk';
  }
  return path.join(app.getPath('userData'), 'PaperDesk');
}

module.exports = { resolvePaperDeskHome };
