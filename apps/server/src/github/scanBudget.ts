import type { ScanResourceWarningCode, ScanWarning } from '@docscout/shared';
import { ApplicationError } from '../errors.js';

const MAX_REQUESTS = 30;
const SCAN_DURATION_MS = 60_000;
const resourceCodes: readonly ScanResourceWarningCode[] = [
  'GITHUB_REQUEST_BUDGET_EXHAUSTED', 'SCAN_DEADLINE_EXCEEDED',
  'GITHUB_REQUEST_TIMEOUT', 'GITHUB_RESPONSE_TOO_LARGE',
];

export function isResourceError(error: unknown): error is ApplicationError & { code: ScanResourceWarningCode } {
  return error instanceof ApplicationError && resourceCodes.includes(error.code as ScanResourceWarningCode);
}

/** One scan owns this context; every outbound attempt consumes it at dispatch. */
export class ScanBudget {
  readonly deadline: number;
  private readonly controller = new AbortController();
  private readonly now: () => number;
  private readonly timer: ReturnType<typeof setTimeout>;
  private count = 0;
  private readonly notices = new Map<ScanResourceWarningCode, ScanWarning>();

  constructor(options: { now?: () => number } = {}) {
    this.now = options.now ?? Date.now;
    this.deadline = this.now() + SCAN_DURATION_MS;
    this.timer = setTimeout(() => this.expire(), SCAN_DURATION_MS);
    this.timer.unref?.();
  }

  get requestsUsed() { return this.count; }
  get remainingRequests() { return MAX_REQUESTS - this.count; }
  get remainingTimeMs() { return Math.max(0, this.deadline - this.now()); }
  get signal() { return this.controller.signal; }
  get warnings() { return [...this.notices.values()]; }

  note(error: unknown) {
    if (isResourceError(error)) this.notices.set(error.code, { code: error.code, message: error.message });
  }

  checkDeadline() {
    if (this.remainingTimeMs === 0) this.expire();
    if (this.signal.aborted) throw this.signal.reason as ApplicationError;
  }

  cancel(reason: ApplicationError) {
    if (this.signal.aborted) return;
    this.note(reason);
    this.controller.abort(reason);
  }

  consumeRequest() {
    this.checkDeadline();
    if (this.remainingRequests === 0) {
      const error = new ApplicationError(502, 'GITHUB_REQUEST_BUDGET_EXHAUSTED',
        'The scan reached its 30-request GitHub limit. Only completed repository evidence is shown.');
      this.note(error);
      throw error;
    }
    this.count += 1;
  }

  dispose() { clearTimeout(this.timer); }

  private expire() {
    if (this.signal.aborted) return;
    const error = new ApplicationError(504, 'SCAN_DEADLINE_EXCEEDED',
      'The scan reached its 60-second deadline. Only completed repository evidence is shown.');
    this.note(error);
    this.controller.abort(error);
  }
}

// Also bounds injected transports that do not settle promptly on cancellation.
export async function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  let onAbort: () => void = () => undefined;
  const cancelled = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(signal.reason as unknown);
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try { return await Promise.race([operation, cancelled]); }
  finally { signal.removeEventListener('abort', onAbort); }
}
