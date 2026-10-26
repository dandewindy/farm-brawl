import * as THREE from 'three';
import { CFG, radiusOf } from '@shared/constants';
import type { Input } from '@shared/protocol';

const KEY_DIR: Record<string, [number, number]> = {
  KeyW: [0, -1], ArrowUp: [0, -1],
  KeyS: [0, 1], ArrowDown: [0, 1],
  KeyA: [-1, 0], ArrowLeft: [-1, 0],
  KeyD: [1, 0], ArrowRight: [1, 0],
};

export class InputManager {
  aimA = 0;
  aimMove = false;
  holding = false;
  holdStart = 0;

  private readonly keysDown = new Set<string>();
  private keyAim = false;

  private readonly pointer = { x: window.innerWidth / 2, y: window.innerHeight * 0.35, has: true };
  private isTouch: boolean;
  private stickVec: { x: number; y: number } | null = null;

  private readonly raycaster = new THREE.Raycaster();
  private readonly ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly hit = new THREE.Vector3();
  private readonly ndc = new THREE.Vector2();

  private readonly stickEl: HTMLElement | null;
  private readonly stickKnob: HTMLElement | null;
  private readonly dashBtn: HTMLElement | null;

  onPressRam?: () => void;
  onReleaseRam?: (heldSeconds: number) => void;

  constructor() {
    this.isTouch = window.matchMedia('(pointer: coarse)').matches;
    this.stickEl = document.getElementById('stick');
    this.stickKnob = document.getElementById('stickKnob');
    this.dashBtn = document.getElementById('dashBtn');

    this.bindMouseAndKeyboard();
    this.bindTouch();
  }

  private isTyping(): boolean {
    const el = document.activeElement;
    return !!el && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA');
  }

  private keyVec(): number | null {
    let x = 0, z = 0;
    for (const k of this.keysDown) {
      const d = KEY_DIR[k];
      if (d) { x += d[0]; z += d[1]; }
    }
    return x || z ? Math.atan2(z, x) : null;
  }

  private pressRam(): void {
    if (this.holding) return;
    this.holding = true;
    this.holdStart = performance.now();
    this.onPressRam?.();
  }

  cancelRam(): void {
    this.holding = false;
  }

  private releaseRam(): void {
    if (!this.holding) return;
    const held = (performance.now() - this.holdStart) / 1000;
    this.holding = false;
    this.onReleaseRam?.(held);
  }

  private bindMouseAndKeyboard(): void {
    const handleMove = (clientX: number, clientY: number) => {
      this.pointer.x = clientX;
      this.pointer.y = clientY;
      this.pointer.has = true;
      this.keyAim = false;
    };

    window.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'touch') return;
      handleMove(e.clientX, e.clientY);
    });

    window.addEventListener('mousemove', (e) => {
      handleMove(e.clientX, e.clientY);
    });

    window.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse') {
        handleMove(e.clientX, e.clientY);
        const target = e.target as HTMLElement | null;
        if (target && target.closest('button, input, select, textarea, a, .screen, .modal, .card, .dialog, #start, #death, #pcSettingsMenu, #gameDrawerModal, #netPerf, #gameControls')) {
          return;
        }
        if (e.button === 0) this.pressRam();
      }
    });

    window.addEventListener('pointerup', (e) => {
      if (e.pointerType === 'mouse' && e.button === 0) {
        this.releaseRam();
      }
    });

    window.addEventListener('keydown', (e) => {
      if (this.isTyping()) return;
      if (KEY_DIR[e.code] && !e.metaKey && !e.ctrlKey && !e.altKey) {
        this.keysDown.add(e.code);
        e.preventDefault();
        return;
      }
      if (e.code === 'Space') {
        if (!e.repeat) this.pressRam();
        e.preventDefault();
      }
    });

    window.addEventListener('keyup', (e) => {
      if (KEY_DIR[e.code]) {
        this.keysDown.delete(e.code);
      }
      if (e.code === 'Space') {
        this.releaseRam();
      }
    });

    window.addEventListener('blur', () => {
      this.releaseRam();
      this.keysDown.clear();
    });
  }

  private bindTouch(): void {
    const isMobileDevice = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
      (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
    if (isMobileDevice) {
      document.body.classList.add('touch');
    }
    if (!this.isTouch && !('ontouchstart' in window) && !navigator.maxTouchPoints) return;

    let touchStartX = 0, touchStartY = 0;
    let stickTouchId: number | null = null;

    window.addEventListener('touchstart', (e) => {
      this.isTouch = true;
      if (isMobileDevice) {
        document.body.classList.add('touch');
      }
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        const target = t.target as HTMLElement | null;
        if (target && target.closest('button, input, select, textarea, a, #gameDrawerModal, #pcSettingsMenu, #netPerf, .drawer-modal, .card, .dialog, #gameControls, #dashBtn')) {
          continue;
        }
        if (t.clientX < window.innerWidth * 0.5 && stickTouchId === null) {
          stickTouchId = t.identifier;
          touchStartX = t.clientX;
          touchStartY = t.clientY;
          this.stickVec = { x: 0, y: 0 };
          if (this.stickEl) {
            this.stickEl.style.left = `${t.clientX}px`;
            this.stickEl.style.top = `${t.clientY}px`;
            this.stickEl.hidden = false;
          }
        } else if (stickTouchId === null) {
          // Direct touch aim outside stick zone
          this.pointer.x = t.clientX;
          this.pointer.y = t.clientY;
          this.pointer.has = true;
        }
      }
    }, { passive: true });

    window.addEventListener('touchmove', (e) => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        if (t.identifier === stickTouchId && this.stickVec) {
          const dx = t.clientX - touchStartX;
          const dy = t.clientY - touchStartY;
          const dist = Math.hypot(dx, dy);
          const maxR = 55;
          const k = dist > 0 ? Math.min(1, dist / maxR) : 0;
          const angle = Math.atan2(dy, dx);
          this.stickVec = { x: Math.cos(angle) * k, y: Math.sin(angle) * k };
          if (this.stickKnob) {
            const kx = Math.cos(angle) * Math.min(dist, maxR);
            const ky = Math.sin(angle) * Math.min(dist, maxR);
            this.stickKnob.style.transform = `translate(${kx}px, ${ky}px)`;
          }
        } else if (stickTouchId === null) {
          this.pointer.x = t.clientX;
          this.pointer.y = t.clientY;
          this.pointer.has = true;
        }
      }
    }, { passive: true });

    const endStick = (e: TouchEvent) => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        if (e.changedTouches[i].identifier === stickTouchId) {
          stickTouchId = null;
          this.stickVec = null;
          if (this.stickEl) this.stickEl.hidden = true;
          if (this.stickKnob) this.stickKnob.style.transform = '';
        }
      }
    };

    window.addEventListener('touchend', endStick, { passive: true });
    window.addEventListener('touchcancel', endStick, { passive: true });

    if (this.dashBtn) {
      this.dashBtn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.pressRam();
      });
      this.dashBtn.addEventListener('pointerup', () => this.releaseRam());
      this.dashBtn.addEventListener('pointercancel', () => this.releaseRam());
    }
  }

  /** Làm mới mốc thời gian tích lực (gọi khi hết stun hoặc hết cooldown trong lúc vẫn đang giữ nút) */
  resetHoldStart(): void {
    if (this.holding) {
      this.holdStart = performance.now();
    }
  }

  computeAim(
    camera: THREE.Camera,
    meX: number,
    meZ: number,
    meMass: number = CFG.START_MASS
  ): void {
    const ka = this.keyVec();
    if (ka !== null) {
      this.aimA = ka;
      this.aimMove = true;
      this.keyAim = true;
      return;
    }
    if (this.keyAim) {
      this.aimMove = false;
      this.keyAim = false;
    }
    if (this.stickVec !== null) {
      if (Math.hypot(this.stickVec.x, this.stickVec.y) > 0.15) {
        this.aimA = Math.atan2(this.stickVec.y, this.stickVec.x);
        this.aimMove = true;
      } else {
        this.aimMove = false;
      }
      return;
    }
    if (!this.pointer.has) {
      this.aimMove = false;
      return;
    }
    this.ndc.set((this.pointer.x / window.innerWidth) * 2 - 1, -(this.pointer.y / window.innerHeight) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, camera);
    if (!this.raycaster.ray.intersectPlane(this.ground, this.hit)) return;

    // Đo vector chuột trực tiếp từ vị trí con vật (meX, meZ)
    const dx = this.hit.x - meX;
    const dz = this.hit.z - meZ;
    const dist = Math.hypot(dx, dz);

    // Cập nhật góc ngắm khi chuột cách tâm con vật
    if (dist > 0.12) {
      this.aimA = Math.atan2(dz, dx);
    }

    // Dừng khi chuột ở sát con vật, chạy khi chuột đưa ra ngoài
    const baseR = radiusOf(meMass);
    this.aimMove = dist > baseR + 0.35;
  }

  getInput(): Input {
    return {
      a: this.aimA,
      mv: this.aimMove,
      btn: this.holding,
    };
  }
}
