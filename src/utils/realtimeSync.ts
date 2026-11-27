import {LeakPoint} from '../types/leak';

export const CLIENT_ID =
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `client-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

const BROADCAST_CHANNEL_NAME = 'hydropin_realtime_v1';

export type RealtimeAction = 'upsert' | 'delete' | 'replace';

export interface RealtimeMutationPayload {
  action: RealtimeAction;
  version: number;
  leak?: LeakPoint;
  id?: string;
  leaks?: LeakPoint[];
  sourceClientId?: string;
  reason?: string;
  silent?: boolean;
  timestamp?: string;
}

export interface PublishMutationInput {
  action: 'upsert' | 'delete' | 'replace' | 'seed_if_empty';
  leak?: LeakPoint;
  id?: string;
  leaks?: LeakPoint[];
  reason?: string;
  silent?: boolean;
  authToken?: string | null;
}

let sharedChannel: BroadcastChannel | null = null;
function getChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === 'undefined') return null;
  if (!sharedChannel) {
    try {
      sharedChannel = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
    } catch {
      return null;
    }
  }
  return sharedChannel;
}

export async function fetchServerLeaks(): Promise<{
  ok: boolean;
  version: number;
  leaks: LeakPoint[];
}> {
  try {
    const res = await fetch('/api/leaks', {
      method: 'GET',
      cache: 'no-store',
    });
    if (!res.ok) return {ok: false, version: 0, leaks: []};
    const data = (await res.json()) as {
      ok?: boolean;
      version?: number;
      leaks?: LeakPoint[];
    };
    return {
      ok: Boolean(data?.ok),
      version: typeof data?.version === 'number' ? data.version : 0,
      leaks: Array.isArray(data?.leaks) ? data.leaks : [],
    };
  } catch {
    return {ok: false, version: 0, leaks: []};
  }
}

export async function publishRealtimeMutation(
  input: PublishMutationInput
): Promise<number | null> {
  // 1) Instant same-browser tab-to-tab broadcast
  if (input.action !== 'seed_if_empty') {
    const ch = getChannel();
    if (ch) {
      try {
        ch.postMessage({
          action: input.action,
          version: 0,
          leak: input.leak,
          id: input.id,
          leaks: input.leaks,
          sourceClientId: CLIENT_ID,
          reason: input.reason,
          silent: input.silent,
          timestamp: new Date().toISOString(),
        } satisfies RealtimeMutationPayload);
      } catch {
        // ignore channel serialization errors
      }
    }
  }

  // 2) Server-authoritative broadcast to all connected browsers & devices
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (input.authToken) {
      headers.Authorization = `Bearer ${input.authToken}`;
    }

    const res = await fetch('/api/leaks/mutate', {
      method: 'POST',
      headers,
      cache: 'no-store',
      body: JSON.stringify({
        action: input.action,
        leak: input.leak,
        id: input.id,
        leaks: input.leaks,
        sourceClientId: CLIENT_ID,
        reason: input.reason,
        silent: input.silent,
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {ok?: boolean; version?: number};
    return typeof data?.version === 'number' ? data.version : null;
  } catch {
    return null;
  }
}

export function subscribeRealtimeSync(options: {
  getLocalVersion: () => number;
  onSyncEvent: (payload: RealtimeMutationPayload) => void;
}): () => void {
  const {getLocalVersion, onSyncEvent} = options;
  let closed = false;
  let lastNotifiedVersion = getLocalVersion();
  let checkingServer = false;

  const syncFromServerIfNewer = async (minVersion?: number) => {
    if (closed || checkingServer) return;
    const currentLocal = Math.max(getLocalVersion(), lastNotifiedVersion);
    if (typeof minVersion === 'number' && minVersion <= currentLocal) {
      return;
    }
    checkingServer = true;
    try {
      const srv = await fetchServerLeaks();
      if (
        !closed &&
        srv.ok &&
        srv.version > Math.max(getLocalVersion(), lastNotifiedVersion) &&
        srv.leaks.length > 0
      ) {
        lastNotifiedVersion = srv.version;
        onSyncEvent({
          action: 'replace',
          version: srv.version,
          leaks: srv.leaks,
          silent: true,
        });
      }
    } finally {
      checkingServer = false;
    }
  };

  // Same-browser tab channel
  const ch = getChannel();
  const onChannelMessage = (evt: MessageEvent<RealtimeMutationPayload>) => {
    const payload = evt.data;
    if (!payload || payload.sourceClientId === CLIENT_ID) return;
    onSyncEvent(payload);
  };
  ch?.addEventListener('message', onChannelMessage);

  // Cross-browser / cross-device SSE stream
  let eventSource: EventSource | null = null;
  if (typeof EventSource !== 'undefined') {
    eventSource = new EventSource('/api/realtime/stream');

    eventSource.addEventListener('connected', (evt) => {
      try {
        const data = JSON.parse((evt as MessageEvent).data) as {
          version?: number;
        };
        if (typeof data?.version === 'number' && data.version > 0) {
          void syncFromServerIfNewer(data.version);
        }
      } catch {
        // ignore malformed handshake
      }
    });

    eventSource.addEventListener('leak_sync', (evt) => {
      try {
        const payload = JSON.parse(
          (evt as MessageEvent).data
        ) as RealtimeMutationPayload;
        if (!payload) return;
        if (typeof payload.version === 'number') {
          lastNotifiedVersion = Math.max(lastNotifiedVersion, payload.version);
        }
        if (payload.sourceClientId === CLIENT_ID) return;
        onSyncEvent(payload);
      } catch {
        // ignore malformed SSE event
      }
    });
  }

  // Catch up immediately when returning to tab or regaining network
  const onFocusOrVisible = () => {
    if (document.visibilityState === 'hidden') return;
    void syncFromServerIfNewer();
  };
  window.addEventListener('focus', onFocusOrVisible);
  window.addEventListener('online', onFocusOrVisible);
  document.addEventListener('visibilitychange', onFocusOrVisible);

  return () => {
    closed = true;
    ch?.removeEventListener('message', onChannelMessage);
    eventSource?.close();
    window.removeEventListener('focus', onFocusOrVisible);
    window.removeEventListener('online', onFocusOrVisible);
    document.removeEventListener('visibilitychange', onFocusOrVisible);
  };
}
