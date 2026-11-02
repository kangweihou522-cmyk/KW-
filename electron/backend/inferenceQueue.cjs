// Schedule each chunk separately so reading takes priority over bulk work.
class InferenceQueue {
  constructor() { this.pending = []; this.running = false; }
  run(work, { signal, background = false } = {}) {
    return new Promise((resolve, reject) => {
      const task = { work, signal, background, resolve, reject };
      task.abort = () => {
        const index = this.pending.indexOf(task);
        if (index >= 0) { this.pending.splice(index, 1); reject(signal.reason || new Error('请求已取消。')); }
      };
      signal?.addEventListener('abort', task.abort, { once: true });
      this.pending.push(task); this.drain();
    });
  }
  async drain() {
    if (this.running) return;
    this.running = true;
    try {
      while (this.pending.length) {
        const index = this.pending.findIndex(task => !task.background);
        const task = this.pending.splice(index < 0 ? 0 : index, 1)[0];
        task.signal?.removeEventListener('abort', task.abort);
        try { task.signal?.throwIfAborted(); task.resolve(await task.work()); }
        catch (error) { task.reject(error); }
      }
    } finally { this.running = false; }
  }
}
module.exports = { InferenceQueue };
