/**
 * Pub/sub for run events. Server-side fan-out for WS clients.
 *
 * The executor calls `publish(runId, event)`. The WebSocket handler
 * subscribes per run id. Events are also persisted by the executor
 * via the events repo, so reconnecting clients can replay history.
 */
import { EventEmitter } from "node:events";
import type { RunEvent } from "@ccqa/shared";

const emitter = new EventEmitter();
emitter.setMaxListeners(0);

export function publish(runId: string, e: RunEvent): void {
  emitter.emit(runId, e);
  emitter.emit("*", e);
}

export function subscribe(runId: string, listener: (e: RunEvent) => void) {
  emitter.on(runId, listener);
  return () => emitter.off(runId, listener);
}
