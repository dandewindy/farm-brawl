// Firebase Realtime Lobby & Room Metadata Service
// Hybrid architecture: Cloudflare Durable Objects manages 20Hz physics & WebSockets,
// while Firebase tracks room metadata, active friend rooms, and presence.

export interface FriendRoomMeta {
  code: string;
  host: string;
  players: number;
  max: number;
  createdAt: number;
  updatedAt: number;
}

const FIREBASE_API_KEY = 'AIzaSyBDgKuwPN1fUZ2sSv4PmfcsQe-OBepjk5U';

// Configurable Firebase Realtime Database URL
// Can be set via window.FIREBASE_DB_URL or localStorage 'fb_rtdb_url'
export function getFirebaseDbUrl(): string | null {
  if (typeof window !== 'undefined') {
    const custom = (window as any).FIREBASE_DB_URL || localStorage.getItem('fb_rtdb_url');
    if (custom) return custom.replace(/\/+$/, '');
  }
  return null;
}

export function setFirebaseDbUrl(url: string): void {
  if (typeof window !== 'undefined') {
    localStorage.setItem('fb_rtdb_url', url.trim());
    (window as any).FIREBASE_DB_URL = url.trim();
  }
}

/** Register or update a friend room in Firebase / Lobby */
export async function registerFriendRoom(code: string, host: string, players = 1): Promise<void> {
  const normCode = code.toUpperCase().trim();
  const roomData: FriendRoomMeta = {
    code: normCode,
    host: host.slice(0, 16),
    players,
    max: 12,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  const dbUrl = getFirebaseDbUrl();
  if (dbUrl) {
    try {
      await fetch(`${dbUrl}/rooms/${encodeURIComponent(normCode)}.json?key=${FIREBASE_API_KEY}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(roomData),
      });
    } catch (err) {
      console.warn('[Firebase] Failed to write room metadata:', err);
    }
  }

  // Also cache locally for instant lookup
  try {
    sessionStorage.setItem(`fb_room_${normCode}`, JSON.stringify(roomData));
  } catch {}
}

/** Check if a friend room exists and get active metadata */
export async function getFriendRoomInfo(code: string): Promise<FriendRoomMeta | null> {
  const normCode = code.toUpperCase().trim();
  const dbUrl = getFirebaseDbUrl();

  if (dbUrl) {
    try {
      const res = await fetch(`${dbUrl}/rooms/${encodeURIComponent(normCode)}.json?key=${FIREBASE_API_KEY}`);
      if (res.ok) {
        const data = await res.json();
        if (data && data.code) return data as FriendRoomMeta;
      }
    } catch (err) {
      console.warn('[Firebase] Failed to fetch room metadata:', err);
    }
  }

  // Fallback to Cloudflare Workers live room-info endpoint
  try {
    const isViteDev = window.location.port === '5180';
    const proto = window.location.protocol;
    const host = isViteDev ? 'localhost:8787' : window.location.host;
    const res = await fetch(`${proto}//${host}/api/room-info?room=priv-${encodeURIComponent(normCode)}`);
    if (res.ok) {
      const data = await res.json();
      return {
        code: normCode,
        host: 'Bạn bè',
        players: data.players || 0,
        max: 12,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
    }
  } catch {}

  // Local session cache fallback
  try {
    const cached = sessionStorage.getItem(`fb_room_${normCode}`);
    if (cached) return JSON.parse(cached) as FriendRoomMeta;
  } catch {}

  return null;
}
