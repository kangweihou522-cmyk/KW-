function cleanVersion(value) {
  const text = String(value ?? '').trim().replace(/^app-v/i, '').replace(/^v/i, '');
  const match = text.match(/\d+(?:\.\d+){0,2}(?:[-+][0-9A-Za-z.-]+)?/);
  return match ? match[0] : '';
}

function compareVersionParts(left, right) {
  for (let index = 0; index < 3; index += 1) {
    const delta = (left[index] ?? 0) - (right[index] ?? 0);
    if (delta !== 0) {
      return delta > 0 ? 1 : -1;
    }
  }

  return 0;
}

function compareVersions(leftValue, rightValue) {
  const left = cleanVersion(leftValue);
  const right = cleanVersion(rightValue);

  if (!left || !right) {
    return left === right ? 0 : left ? 1 : -1;
  }

  const [leftCore, leftPrerelease = ''] = left.split('-');
  const [rightCore, rightPrerelease = ''] = right.split('-');
  const coreDelta = compareVersionParts(
    leftCore.split('.').map((part) => Number(part) || 0),
    rightCore.split('.').map((part) => Number(part) || 0),
  );

  if (coreDelta !== 0) {
    return coreDelta;
  }

  if (leftPrerelease === rightPrerelease) {
    return 0;
  }

  if (!leftPrerelease) {
    return 1;
  }

  if (!rightPrerelease) {
    return -1;
  }

  return leftPrerelease.localeCompare(rightPrerelease);
}

function getAutoUpdateSupport(app) {
  return { supported: false, reason: app.isPackaged ? 'paperdesk-local-update' : 'development' };
}

// This fork never polls or installs the upstream PaperQuay release channel.
// Checked local updates are handled by scripts/windows/Update-PaperDesk.ps1.
function createUpdateCommands(context) {
  const { app } = context;
  const releaseUrl = 'https://github.com/kangweihou522-cmyk/KW-/releases';
  function buildStatus(extra = {}) {
    return {
      platform: process.platform,
      packaged: app.isPackaged,
      currentVersion: cleanVersion(app.getVersion()),
      latestVersion: '',
      hasUpdate: false,
      checking: false,
      downloading: false,
      downloaded: false,
      downloadProgress: null,
      autoUpdateSupported: false,
      autoUpdateChannel: '',
      autoUpdateUnsupportedReason: 'paperdesk-local-update',
      canDownload: false,
      canInstall: false,
      error: '',
      releaseName: 'PaperDesk 独立版本',
      releaseNotes: '请先保存并退出，再点击桌面“PaperDesk - Update”，自动检查、下载并校验本项目的最新版本；安装前自动备份资料，无需手动下载或填写SHA256。不会安装上游 PaperQuay 更新。',
      releaseDate: '',
      releaseUrl,
      assets: [],
      ...extra,
    };
  }
  return {
    app_update_get_status() { return buildStatus(); },
    async app_update_check() { return buildStatus(); },
    async app_update_download() {
      throw new Error('请保存并退出 PaperDesk，再点击桌面 PaperDesk - Update。更新工具会自动检查、下载、校验并备份安装，无需选择文件。');
    },
    app_update_install() {
      throw new Error('请先保存并退出 PaperDesk，再点击桌面 PaperDesk - Update 自动更新。');
    },
    async app_update_open_release_page() {
      const { shell } = require('electron');
      await shell.openExternal(releaseUrl);
      return buildStatus();
    },
  };
}

module.exports = {
  cleanVersion,
  compareVersions,
  createUpdateCommands,
  getAutoUpdateSupport,
};
