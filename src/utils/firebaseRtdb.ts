import { initializeApp, getApps, getApp } from 'firebase/app';
import { getDatabase, ref, onValue, off } from 'firebase/database';

export const RTDB_URL = 'https://my-sc-tools-default-rtdb.firebaseio.com';

const firebaseConfig = {
  databaseURL: RTDB_URL,
  projectId: 'my-sc-tools-default-rtdb',
};

export function getRtdb() {
  const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
  return getDatabase(app);
}

export interface ScreenSharePayload {
  active: boolean;
  streamData: string | null;
  timestamp?: number | string;
  source?: string;
  raw?: any;
}

/**
 * Subscribes in real-time to screen_share/live in Firebase Realtime Database via onValue
 * When data is received:
 * - If active and data exists, emits { active: true, streamData: ... }
 * - If stopped or cleared, emits { active: false, streamData: null } (Standby Mode)
 */
export function subscribeToLiveScreenShare(
  onUpdate: (payload: ScreenSharePayload) => void
): () => void {
  let isCleanedUp = false;
  let sseSource: EventSource | null = null;
  let rtdbConnected = false;

  const db = getRtdb();
  const screenShareRef = ref(db, 'screen_share/live');

  // Process snapshot payload
  const processData = (val: any) => {
    if (!val) {
      onUpdate({ active: false, streamData: null, raw: val });
      return;
    }

    let streamData: string | null = null;
    let isActive = true;
    let timestamp: number | string | undefined;

    if (typeof val === 'string') {
      streamData = val.trim();
    } else if (typeof val === 'object') {
      // Check for active flag
      if (val.active === false || val.status === 'stopped' || val.status === 'idle') {
        isActive = false;
      }
      // Check data.data or val.data
      streamData = val.data || val.image || val.video || val.frame || val.src || null;
      timestamp = val.timestamp || val.time;
    }

    if (!isActive || !streamData || streamData.length === 0) {
      onUpdate({ active: false, streamData: null, timestamp, raw: val });
    } else {
      onUpdate({ active: true, streamData, timestamp, source: 'firebase_rtdb', raw: val });
    }
  };

  // Primary: Official Firebase SDK onValue listener
  try {
    onValue(
      screenShareRef,
      (snapshot) => {
        if (isCleanedUp) return;
        rtdbConnected = true;
        const val = snapshot.val();
        processData(val);
      },
      (error) => {
        console.warn('[Firebase RTDB] onValue error, activating SSE fallback:', error);
        initSseFallback();
      }
    );
  } catch (err) {
    console.warn('[Firebase RTDB] Error initializing onValue listener:', err);
    initSseFallback();
  }

  // Backup: Native Firebase REST EventSource (Server-Sent Events)
  function initSseFallback() {
    if (isCleanedUp || sseSource) return;
    try {
      sseSource = new EventSource(`${RTDB_URL}/screen_share/live.json`);
      sseSource.addEventListener('put', (event) => {
        if (isCleanedUp) return;
        try {
          const parsed = JSON.parse(event.data);
          // parsed is { path: "/", data: ... }
          const val = parsed?.data !== undefined ? parsed.data : parsed;
          processData(val);
        } catch (e) {
          console.error('[Firebase SSE] Error parsing put event:', e);
        }
      });

      sseSource.addEventListener('patch', (event) => {
        if (isCleanedUp) return;
        try {
          const parsed = JSON.parse(event.data);
          const val = parsed?.data !== undefined ? parsed.data : parsed;
          processData(val);
        } catch (e) {
          console.error('[Firebase SSE] Error parsing patch event:', e);
        }
      });

      sseSource.onerror = (e) => {
        console.warn('[Firebase SSE] EventSource notice:', e);
      };
    } catch (e) {
      console.warn('[Firebase SSE] EventSource not available:', e);
    }
  }

  // Also check if onValue doesn't fire after 3.5s, start SSE just in case
  const fallbackTimer = setTimeout(() => {
    if (!rtdbConnected && !isCleanedUp) {
      initSseFallback();
    }
  }, 3500);

  return () => {
    isCleanedUp = true;
    clearTimeout(fallbackTimer);
    try {
      off(screenShareRef);
    } catch {
      // ignore
    }
    if (sseSource) {
      sseSource.close();
      sseSource = null;
    }
  };
}
