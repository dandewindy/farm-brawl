import type * as THREE from 'three';
import type { Species } from '@shared/constants';

export interface CowboySpeciesConfig {
  species: Species;
  nameVi: string;
  tier: 1 | 2 | 3 | 4; // 1: Cơ bản, 2: Trung cấp, 3: Tiến hóa / Cao điểm, 4: Huyền thoại
  scale: number;
  speed: number;
  score: number;
  catchRate: number; // Tỉ lệ bắt dính thành công (0..1)
  spawnWeight: number; // Trọng số xuất hiện ngẫu nhiên
}

export const COWBOY_SPECIES_LIST: CowboySpeciesConfig[] = [
  // Tier 1: Thú cơ bản nông trại (Dễ bắt, tích lũy điểm cơ sở)
  { species: 'chicken', nameVi: 'Gà Con', tier: 1, scale: 0.70, speed: 7.2, score: 2, catchRate: 0.80, spawnWeight: 14 },
  { species: 'duck', nameVi: 'Vịt Vàng', tier: 1, scale: 0.85, speed: 6.0, score: 3, catchRate: 0.74, spawnWeight: 12 },
  { species: 'pig', nameVi: 'Heo Hồng', tier: 1, scale: 1.00, speed: 5.0, score: 4, catchRate: 0.68, spawnWeight: 11 },
  { species: 'sheep', nameVi: 'Cừu Bông', tier: 1, scale: 1.05, speed: 5.5, score: 5, catchRate: 0.62, spawnWeight: 10 },
  { species: 'dog', nameVi: 'Chó Shiba', tier: 1, scale: 0.95, speed: 7.0, score: 6, catchRate: 0.56, spawnWeight: 9 },

  // Tier 2: Thú trung cấp đồng cỏ & rừng
  { species: 'cow', nameVi: 'Bò Sữa', tier: 2, scale: 1.35, speed: 4.2, score: 8, catchRate: 0.48, spawnWeight: 8 },
  { species: 'horse', nameVi: 'Ngựa Đua', tier: 2, scale: 1.40, speed: 7.2, score: 10, catchRate: 0.44, spawnWeight: 7 },
  { species: 'monkey', nameVi: 'Khỉ Tinh Nghịch', tier: 2, scale: 0.90, speed: 8.0, score: 12, catchRate: 0.40, spawnWeight: 6 },
  { species: 'elephant', nameVi: 'Voi Bản Đôn', tier: 2, scale: 2.20, speed: 3.8, score: 15, catchRate: 0.35, spawnWeight: 5 },

  // Tier 3: Thần thú tiến hóa (Điểm cao, có voice thông báo riêng)
  { species: 'swan', nameVi: 'Thiên Nga Băng Giá', tier: 3, scale: 1.30, speed: 6.8, score: 20, catchRate: 0.28, spawnWeight: 4.0 },
  { species: 'ram', nameVi: 'Cừu Kim Cương', tier: 3, scale: 1.65, speed: 6.5, score: 25, catchRate: 0.25, spawnWeight: 3.5 },
  { species: 'wolf', nameVi: 'Sói Băng', tier: 3, scale: 1.55, speed: 7.5, score: 30, catchRate: 0.22, spawnWeight: 3.0 },
  { species: 'boar', nameVi: 'Heo Rừng Húc Đất', tier: 3, scale: 1.75, speed: 6.0, score: 35, catchRate: 0.20, spawnWeight: 2.5 },
  { species: 'gorilla', nameVi: 'Khỉ Đột Gorilla', tier: 3, scale: 1.85, speed: 6.2, score: 40, catchRate: 0.18, spawnWeight: 2.0 },
  { species: 'bull', nameVi: 'Bò Tót Cuồng Nộ', tier: 3, scale: 2.05, speed: 7.0, score: 50, catchRate: 0.16, spawnWeight: 1.6 },

  // Tier 4: Huyền thoại cực phẩm (Siêu điểm số, cực hiếm)
  { species: 'pegasus', nameVi: 'Kỳ Lân Cầu Vồng', tier: 4, scale: 1.70, speed: 7.5, score: 60, catchRate: 0.14, spawnWeight: 1.2 },
  { species: 'phoenix', nameVi: 'Phượng Hoàng Lửa', tier: 4, scale: 1.80, speed: 8.2, score: 80, catchRate: 0.12, spawnWeight: 0.9 },
  { species: 'mammoth', nameVi: 'Voi Ma Mút Khổng Lồ', tier: 4, scale: 2.65, speed: 3.6, score: 100, catchRate: 0.10, spawnWeight: 0.6 },
];

export interface ActiveCowboyAnimal {
  id: number;
  species: Species;
  config: CowboySpeciesConfig;
  root: THREE.Group;
  legs: THREE.Group[];
  x: number;
  y: number;
  z: number;
  vx: number;
  dir: 1 | -1; // 1: Trái sang phải, -1: Phải sang trái
  lane: number; // 0: Gần, 1: Giữa, 2: Xa
  state: 'running' | 'tug' | 'caught' | 'escaped';
  isRainbow: boolean;
  isSparkleX2: boolean; // Hiệu ứng lấp lánh nhân đôi điểm (x2)
  score: number;
  catchRate: number;
  tugTimer: number;
  runCycle: number;
  sparkleGroup?: THREE.Group;
  rainbowMats?: THREE.MeshStandardMaterial[];
  badgeEl?: HTMLElement;
  trollSprite?: THREE.Sprite;
  trollTimer?: number;
}

export interface LassoRope {
  id: number;
  lane: number; // 0..4 (tương ứng 5 tia quăng dây theo hình cánh quạt)
  state: 'idle' | 'ready' | 'flying' | 'tug' | 'pulling' | 'miss';
  progress: number; // 0..1
  startX: number;
  startY: number;
  startZ: number;
  targetX: number;
  targetY: number;
  targetZ: number;
  caughtAnimalId: number | null;
  isRainbowNet?: boolean;
  ribbonMesh: THREE.Mesh;
  loopMesh: THREE.Group;
  lineGeo: THREE.BufferGeometry;
  knotMesh?: THREE.Mesh;
}

export interface CowboyWalletData {
  credits: number;
  lastClaimDate: string;
  lastClaimTimestamp: number;
  lastAccumulateTimestamp: number;
  dailyReliefCount: number;
  totalScore: number;
  totalCatches: number;
  highestPayout: number;
}

export type CowboyThemeId = 'farm' | 'prairie' | 'ice';

export interface CowboyThemeConfig {
  id: CowboyThemeId;
  nameVi: string;
  icon: string;
  bgColor: number;
  fogColor: number;
  groundColor: number;
  fenceColor: number;
  skyDesc: string;
}

export type CowboyItemKind =
  | 'speed_boots'      // Giày Thần Tốc: Tăng tốc độ quăng và kéo +60%
  | 'lucky_shield'     // Khiên May Mắn: Không bị miss (bảo vệ 1 lần kéo hụt)
  | 'rainbow_net'      // Kẹo Cầu Vồng / Lưới Khổng Lồ: Quét sạch mọi thú trên màn hình
  | 'strength_potion'  // Thuốc Tăng Lực: Giật kéo về tức thì, bỏ qua 2s giằng co
  | 'time_clock'       // Đồng Hồ Gia Hạn: Cộng thêm +60s cho vòng 3 phút
  | 'lucky_clover';    // Cỏ 4 Lá: Tăng +30% tỉ lệ thú Lấp lánh x2 & Thú Cầu vồng

export interface CowboyItemDef {
  kind: CowboyItemKind;
  nameVi: string;
  icon: string;
  price: number; // Giá credit
  descVi: string;
  effectLabel: string;
  maxPerRound: number;
}

export interface CowboyKidsConfig {
  enabled: boolean;
  parentPin: string; // Mã PIN 4 số của phụ huynh
  timeLimitMinutes: number; // 15, 30, 45, 60
  maxDailyCredits: number; // Max 20
  usedCreditsToday: number;
  lastPlayedDate: string;
}


export const HORSE_COWBOY_SVG = `
<svg class="horse-cowboy-ico" viewBox="0 0 48 48" width="100%" height="100%" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M10 16 L6 6 L15 10 Z" fill="#935128" stroke="#4a250e" stroke-width="1.8" stroke-linejoin="round"/>
  <path d="M9 12 L7 7 L12 10 Z" fill="#f09898"/>
  <path d="M38 16 L42 6 L33 10 Z" fill="#935128" stroke="#4a250e" stroke-width="1.8" stroke-linejoin="round"/>
  <path d="M39 12 L41 7 L36 10 Z" fill="#f09898"/>
  <rect x="11" y="14" width="26" height="24" rx="11" fill="#b06432" stroke="#4a250e" stroke-width="2"/>
  <path d="M20 13 C21 9, 27 9, 28 13 Z" fill="#381c0b"/>
  <path d="M14 15 C14 5, 18 3, 24 4.5 C30 3, 34 5, 34 15 Z" fill="#754320" stroke="#361a08" stroke-width="1.8"/>
  <path d="M21 4.5 C23 6, 25 6, 27 4.5" stroke="#361a08" stroke-width="1.6" stroke-linecap="round"/>
  <path d="M14 13.5 C19 12, 29 12, 34 13.5 L34 15.5 C29 14, 19 14, 14 15.5 Z" fill="#2d1405"/>
  <circle cx="24" cy="13.8" r="2.2" fill="#ffca28" stroke="#361a08" stroke-width="0.8"/>
  <path d="M3 15 C12 8, 36 8, 45 15 C47 17.5, 39 19, 24 19 C9 19, 1 17.5, 3 15 Z" fill="#8d5227" stroke="#361a08" stroke-width="1.8"/>
  <ellipse cx="18" cy="24.5" rx="3.2" ry="3.8" fill="#1b1008"/>
  <circle cx="19.2" cy="23.2" r="1.3" fill="#ffffff"/>
  <circle cx="17.2" cy="26" r="0.6" fill="#ffffff"/>
  <ellipse cx="30" cy="24.5" rx="3.2" ry="3.8" fill="#1b1008"/>
  <circle cx="31.2" cy="23.2" r="1.3" fill="#ffffff"/>
  <circle cx="29.2" cy="26" r="0.6" fill="#ffffff"/>
  <ellipse cx="24" cy="34" rx="8" ry="5" fill="#f5d5b8" stroke="#8d5227" stroke-width="1.2"/>
  <ellipse cx="20.5" cy="33.8" rx="1.4" ry="1.7" fill="#4a250e"/>
  <ellipse cx="27.5" cy="33.8" rx="1.4" ry="1.7" fill="#4a250e"/>
  <path d="M21.5 36.5 C23 37.5, 25 37.5, 26.5 36.5" stroke="#4a250e" stroke-width="1.3" stroke-linecap="round"/>
</svg>`;
