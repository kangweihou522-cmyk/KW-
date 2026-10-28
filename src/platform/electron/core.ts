export async function invoke<T = unknown>(
  command: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  if (!window.paperquay?.invoke) {
    throw new Error('PaperDesk Electron bridge is not available');
  }

  return window.paperquay.invoke<T>(command, args);
}
