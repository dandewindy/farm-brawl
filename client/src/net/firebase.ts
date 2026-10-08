// Firebase & Firestore Realtime Lobby Service
// Hybrid architecture: Cloudflare Durable Objects manages 20Hz authoritative physics & WebSockets,
// while Google Cloud Firestore tracks room presence, metadata, and active friend rooms.

export interface FriendRoomMeta {
  code: string;
  host: string;
  players: number;
  max: number;
  createdAt: number;
  updatedAt: number;
}

const FIREBASE_API_KEY = 'AIzaSyBDgKuwPN1fUZ2sSv4PmfcsQe-OBepjk5U';
const FIRESTORE_PROJECT_ID = 'farm-arena-game';
const FIRESTORE_DATABASE_ID = 'farmarena';

function getFirestoreDocUrl(code: string): string {
  return `https://firestore.googleapis.com/v1/projects/${FIRESTORE_PROJECT_ID}/databases/${FIRESTORE_DATABASE_ID}/documents/rooms/${encodeURIComponent(code)}?key=${FIREBASE_API_KEY}`;
}

/** Register or update a friend room in Firestore */
export async function registerFriendRoom(code: string, host: string, players = 1): Promise<void> {
  const normCode = code.toUpperCase().trim();
  const now = Date.now();
  const roomData: FriendRoomMeta = {
    code: normCode,
    host: host.slice(0, 16),
    players,
    max: 12,
    createdAt: now,
    updatedAt: now,
  };

  try {
    const fsUrl = getFirestoreDocUrl(normCode);
    await fetch(fsUrl, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fields: {
          code: { stringValue: normCode },
          host: { stringValue: roomData.host },
          players: { integerValue: String(players) },
          max: { integerValue: '12' },
          createdAt: { integerValue: String(now) },
          updatedAt: { integerValue: String(now) },
        },
      }),
    });
  } catch (err) {
    console.warn('[Firestore] Failed to write room metadata:', err);
  }

  // Also cache locally for instant lookup
  try {
    sessionStorage.setItem(`fb_room_${normCode}`, JSON.stringify(roomData));
  } catch {}
}

/** Check if a friend room exists and get active metadata */
export async function getFriendRoomInfo(code: string): Promise<FriendRoomMeta | null> {
  const normCode = code.toUpperCase().trim();

  // 1. Try Firestore REST API directly
  try {
    const fsUrl = getFirestoreDocUrl(normCode);
    const res = await fetch(fsUrl);
    if (res.ok) {
      const data = await res.json();
      if (data && data.fields) {
        return {
          code: data.fields.code?.stringValue || normCode,
          host: data.fields.host?.stringValue || 'Bạn bè',
          players: Number(data.fields.players?.integerValue || 1),
          max: Number(data.fields.max?.integerValue || 12),
          createdAt: Number(data.fields.createdAt?.integerValue || Date.now()),
          updatedAt: Number(data.fields.updatedAt?.integerValue || Date.now()),
        };
      }
    }
  } catch (err) {
    console.warn('[Firestore] Failed to fetch room metadata:', err);
  }

  // 2. Fallback to Cloudflare Workers live room-info endpoint
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

  // 3. Local session cache fallback
  try {
    const cached = sessionStorage.getItem(`fb_room_${normCode}`);
    if (cached) return JSON.parse(cached) as FriendRoomMeta;
  } catch {}

  return null;
}

/** Delete or leave friend room from Firestore */
export async function deleteFriendRoom(code: string): Promise<void> {
  const normCode = code.toUpperCase().trim();
  try {
    const fsUrl = getFirestoreDocUrl(normCode);
    await fetch(fsUrl, { method: 'DELETE' });
  } catch {}
}
