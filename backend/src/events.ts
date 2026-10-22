import { EventEmitter } from 'node:events';

/**
 * In-process bus bridging the worker (which executes runs) to HTTP SSE streams.
 * Events are keyed by runId. For a multi-instance deployment this would be backed
 * by Redis pub/sub; for the hackathon scope a single worker + API process share it,
 * and SSE clients also poll the DB as a fallback so no event is ever lost.
 */
export const bus = new EventEmitter();
bus.setMaxListeners(0);

export interface RunEvent {
  type: 'run.status' | 'node.status' | 'log';
  runId: string;
  payload: any;
}

export function emitRunEvent(e: RunEvent) {
  bus.emit(e.runId, e);
  bus.emit('*', e);
}
