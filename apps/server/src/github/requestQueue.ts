import { abortable } from './scanBudget.js';

/** Serializes outbound GitHub requests for this server process. */
export class GitHubRequestQueue {
  private tail: Promise<void> = Promise.resolve();

  async run<T>(signal: AbortSignal, beforeDispatch: () => void, request: () => Promise<T>): Promise<T> {
    let release!: () => void;
    const slot = new Promise<void>((resolve) => { release = resolve; });
    const previous = this.tail;
    this.tail = previous.then(() => slot);

    try {
      await abortable(previous, signal);
      signal.throwIfAborted();
      beforeDispatch();
      signal.throwIfAborted();
      return await request();
    } finally {
      // A cancelled queued entry also resolves its place in the FIFO chain.
      release();
    }
  }
}

export const githubRequestQueue = new GitHubRequestQueue();
