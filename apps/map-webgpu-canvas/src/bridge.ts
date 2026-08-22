/**
 * postMessage bridge between the map iframe and the embedding dashboard.
 * See PROTOCOL.md for the wire contract.
 */

import {
  type DashboardToMap,
  isDashboardToMap,
  type MapEvent,
  makeMapEvent,
} from "./protocol";

export class DashboardBridge {
  /** Origin the dashboard must post from; null = accept any (prototype). */
  private readonly allowedOrigin: string | null;

  constructor(
    allowedOrigin: string | null,
    private readonly onCommand: (command: DashboardToMap) => void,
  ) {
    this.allowedOrigin = allowedOrigin;
    window.addEventListener("message", (event: MessageEvent) => {
      if (this.allowedOrigin && event.origin !== this.allowedOrigin) return;
      if (!isDashboardToMap(event.data)) return;
      this.onCommand(event.data);
    });
  }

  get embedded(): boolean {
    return window.self !== window.top;
  }

  send(event: MapEvent, id?: string): void {
    if (!this.embedded) return;
    window.parent.postMessage(
      makeMapEvent(event, id),
      this.allowedOrigin ?? "*",
    );
  }
}
