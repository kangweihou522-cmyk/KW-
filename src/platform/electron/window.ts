export function getCurrentWindow() {
  if (!window.paperquay?.window) {
    throw new Error('PaperDesk Electron window bridge is not available');
  }

  return window.paperquay.window;
}
