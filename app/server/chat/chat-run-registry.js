'use strict';

/**
 * In-memory registry of active dashboard chat runs (one model turn per conversationId).
 * Buffers SSE-shaped JSON events so multiple tabs / late GET /api/chat/conversations/:id/stream
 * subscribers can attach; the model work continues if the originating POST disconnects.
 */

class RunAlreadyActiveError extends Error {
  constructor(convId) {
    super(`Chat run already active for conversation ${convId}`);
    this.name = 'RunAlreadyActiveError';
    this.convId = convId;
  }
}

/**
 * @param {object} [opts]
 * @param {number} [opts.maxRunMs]
 * @param {number} [opts.maxBufferedEvents]
 * @param {number} [opts.graceEvictMs]
 * @param {number} [opts.heartbeatMs]
 */
function createChatRunRegistry(opts = {}) {
  const maxRunMs =
    Number(process.env.BRAIN_CHAT_RUN_MAX_MS) ||
    opts.maxRunMs ||
    30 * 60 * 1000;
  const maxBufferedEvents =
    Number(process.env.BRAIN_CHAT_RUN_EVENT_BUFFER) ||
    opts.maxBufferedEvents ||
    5000;
  const graceEvictMs = opts.graceEvictMs != null ? opts.graceEvictMs : 60_000;
  const heartbeatMs = opts.heartbeatMs != null ? opts.heartbeatMs : 5000;

  /** @type {Map<string, any>} */
  const runs = new Map();

  function clearRunTimers(run) {
    if (run.heartbeatTimer) {
      clearInterval(run.heartbeatTimer);
      run.heartbeatTimer = null;
    }
    if (run.maxRunTimer) {
      clearTimeout(run.maxRunTimer);
      run.maxRunTimer = null;
    }
    if (run.evictTimer) {
      clearTimeout(run.evictTimer);
      run.evictTimer = null;
    }
  }

  /**
   * @param {any} run
   * @param {number} seq
   * @param {string} line
   */
  function pushBuffer(run, seq, line) {
    if (run.events.length >= maxBufferedEvents) {
      const tseq = run.nextSeq++;
      const truncLine = JSON.stringify({
        seq: tseq,
        bufferTruncated: true,
        message: `Event buffer exceeded ${maxBufferedEvents}; earlier events were dropped.`,
      });
      run.events.push({ seq: tseq, line: truncLine });
      while (run.events.length > maxBufferedEvents) {
        run.events.shift();
      }
    }
    run.events.push({ seq, line });
  }

  /**
   * @param {any} run
   * @param {Record<string, unknown>} payload
   */
  function emit(run, payload) {
    if (run.streamEnded) return;
    const seq = run.nextSeq++;
    const obj = { seq, ...payload };
    const line = JSON.stringify(obj);
    pushBuffer(run, seq, line);
    const dataLine = `data: ${line}\n\n`;
    for (const res of run.subscribers) {
      try {
        if (!res.writableEnded) res.write(dataLine);
      } catch (_) {}
    }
  }

  /**
   * @param {any} run
   */
  function endAllSubscribers(run) {
    for (const res of run.subscribers) {
      try {
        if (!res.writableEnded) {
          res.write('data: [DONE]\n\n');
          res.end();
        }
      } catch (_) {}
    }
    run.subscribers.clear();
  }

  /**
   * @param {any} run
   * @param {'done' | 'error'} terminalStatus
   * @param {Record<string, unknown>} [finalPayload]
   */
  function finalizeRun(run, terminalStatus, finalPayload) {
    if (run.streamEnded) return;
    run.status = terminalStatus;
    run.finishedAt = Date.now();
    clearRunTimers(run);
    if (finalPayload && Object.keys(finalPayload).length) {
      emit(run, finalPayload);
    }
    run.streamEnded = true;
    endAllSubscribers(run);
    run.evictTimer = setTimeout(() => {
      runs.delete(run.convId);
    }, graceEvictMs);
  }

  /**
   * @param {object} args
   * @param {string} args.convId
   * @param {string} args.tenantKey
   * @param {(emit: (p: Record<string, unknown>) => void, signal: AbortSignal) => Promise<void>} args.runFn
   * @param {number} [args.startedAtMs]
   */
  function start({ convId, tenantKey, runFn, startedAtMs }) {
    if (runs.has(convId)) {
      const existing = runs.get(convId);
      if (existing && existing.status === 'running' && !existing.streamEnded) {
        throw new RunAlreadyActiveError(convId);
      }
      runs.delete(convId);
    }
    const startedAt = startedAtMs != null ? startedAtMs : Date.now();
    const run = {
      convId,
      tenantKey,
      status: 'running',
      startedAt,
      finishedAt: null,
      nextSeq: 1,
      events: [],
      subscribers: new Set(),
      abortController: new AbortController(),
      proc: null,
      heartbeatTimer: null,
      maxRunTimer: null,
      evictTimer: null,
      streamEnded: false,
      /** @type {null | (() => void)} Best-effort persist of streamed assistant text (see chat routes). */
      partialFlush: null,
    };
    runs.set(convId, run);

    const signal = run.abortController.signal;
    const emitBound = (payload) => emit(run, payload);

    run.heartbeatTimer = setInterval(() => {
      if (run.streamEnded) return;
      const elapsedSec = Math.floor((Date.now() - startedAt) / 1000);
      emit(run, { heartbeat: true, elapsedSec });
    }, heartbeatMs);

    run.maxRunTimer = setTimeout(() => {
      if (run.streamEnded) return;
      try {
        run.abortController.abort(new Error('BRAIN_CHAT_RUN_MAX_MS exceeded'));
      } catch (_) {}
      if (run.proc && run.proc.exitCode === null && !run.proc.killed) {
        try {
          run.proc.kill();
        } catch (_) {}
      }
    }, maxRunMs);

    Promise.resolve()
      .then(() => runFn(emitBound, signal))
      .then(() => {
        if (!run.streamEnded) finalizeRun(run, 'done', { done: true, ok: true });
      })
      .catch((err) => {
        const msg = err && err.message ? err.message : String(err);
        if (!run.streamEnded) finalizeRun(run, 'error', { done: true, ok: false, runError: msg });
      });

    return run;
  }

  /**
   * @param {string} convId
   * @param {import('express').Response} res
   * @param {{ fromSeq?: number, tenantKey: string, abortRunWhenResponseCloses?: boolean }} opts
   * @returns {() => void}
   */
  function attach(convId, res, opts) {
    const fromSeq = Number(opts.fromSeq) || 0;
    const tenantKey = opts.tenantKey != null ? String(opts.tenantKey) : '';
    const abortRunWhenResponseCloses = Boolean(opts.abortRunWhenResponseCloses);
    const run = runs.get(convId);
    if (!run || run.streamEnded || run.status !== 'running') {
      try {
        res.write(`data: ${JSON.stringify({ seq: 0, noActiveRun: true })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
      } catch (_) {}
      return () => {};
    }
    if (run.tenantKey !== tenantKey) {
      try {
        res.status(403).json({ error: 'Forbidden' });
      } catch (_) {}
      return () => {};
    }

    for (const e of run.events) {
      if (e.seq <= fromSeq) continue;
      try {
        res.write(`data: ${e.line}\n\n`);
      } catch (_) {}
    }

    run.subscribers.add(res);
    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      run.subscribers.delete(res);
      if (abortRunWhenResponseCloses && run.status === 'running' && !run.streamEnded) {
        try {
          run.abortController.abort();
        } catch (_) {}
        if (run.proc && run.proc.exitCode === null && !run.proc.killed) {
          try {
            run.proc.kill();
          } catch (_) {}
        }
      }
    };
    res.on('close', cleanup);
    res.on('error', cleanup);
    return cleanup;
  }

  /**
   * @param {string} convId
   */
  function abort(convId) {
    const run = runs.get(convId);
    if (!run || run.streamEnded) return;
    try {
      run.abortController.abort();
    } catch (_) {}
    if (run.proc && run.proc.exitCode === null && !run.proc.killed) {
      try {
        run.proc.kill();
      } catch (_) {}
    }
  }

  /**
   * @param {string} convId
   */
  function summary(convId) {
    const run = runs.get(convId);
    if (!run) return { active: false, status: null, lastSeq: 0 };
    const active = run.status === 'running' && !run.streamEnded;
    const lastSeq = run.nextSeq > 1 ? run.nextSeq - 1 : 0;
    return { active, status: run.status, lastSeq };
  }

  /**
   * @param {string} convId
   * @param {import('child_process').ChildProcess | null} proc
   */
  function setProc(convId, proc) {
    const r = runs.get(convId);
    if (r) r.proc = proc;
  }

  /**
   * @param {string} convId
   * @param {null | (() => void)} fn
   */
  function setPartialFlush(convId, fn) {
    const run = runs.get(convId);
    if (run && run.status === 'running' && !run.streamEnded) run.partialFlush = typeof fn === 'function' ? fn : null;
  }

  /**
   * @param {string} convId
   */
  function clearPartialFlush(convId) {
    const run = runs.get(convId);
    if (run) run.partialFlush = null;
  }

  function flushAllPartialsSync() {
    for (const run of runs.values()) {
      if (run.status !== 'running' || run.streamEnded) continue;
      if (typeof run.partialFlush !== 'function') continue;
      try {
        run.partialFlush();
      } catch (e) {
        const m = e && e.message ? e.message : String(e);
        console.warn('[chat-run-registry] partialFlush failed:', m);
      }
    }
  }

  return {
    start,
    attach,
    abort,
    summary,
    setProc,
    setPartialFlush,
    clearPartialFlush,
    flushAllPartialsSync,
    RunAlreadyActiveError,
  };
}

module.exports = {
  createChatRunRegistry,
  RunAlreadyActiveError,
};
