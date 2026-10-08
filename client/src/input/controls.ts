import * as THREE from 'three';
import { radiusOf } from '@shared/constants';
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
  private keyA = 0;

  private readonly pointer = { x: window.innerWidth / 2, y: window.innerHeight / 2, has: false };
  private readonly isTouch: boolean;
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
    window.addEventListener('pointermove', (e) => {
      if (this.isTouch) return;
      this.pointer.x = e.clientX;
      this.pointer.y = e.clientY;
      this.pointer.has = true;
      this.keyAim = false;
    });

    window.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse') {
        this.pointer.x = e.clientX;
        this.pointer.y = e.clientY;
        this.pointer.has = true;
        this.keyAim = false;
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
    if (!this.isTouch && !('ontouchstart' in window) && !navigator.maxTouchPoints) return;
    document.body.classList.add('touch');

    let touchStartX = 0, touchStartY = 0;
    let stickTouchId: number | null = null;

    window.addEventListener('touchstart', (e) => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        // Only create stick for touches on the left half that aren't already tracked
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
        }
      }
    }, { passive: true });

    window.addEventListener('touchmove', (e) => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        // Only track the stick finger by its identifier (not by screen position)
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
        e.stopPropagation();
        this.pressRam();
      });
      this.dashBtn.addEventListener('pointerup', () => this.releaseRam());
      this.dashBtn.addEventListener('pointercancel', () => this.releaseRam());
    }
  }

  computeAim(camera: THREE.Camera, meX: number, meZ: number, meMass: number): void {
    const ka = this.keyVec();
    if (ka !== null) {
      this.aimA = this.keyA = ka;
      this.aimMove = true;
      this.keyAim = true;
      return;
    }
    if (this.keyAim) {
      this.aimA = this.keyA;
      this.aimMove = false;
      return;
    }
    if (this.isTouch) {
      if (this.stickVec && Math.hypot(this.stickVec.x, this.stickVec.y) > 0.15) {
        this.aimA = Math.atan2(this.stickVec.y, this.stickVec.x);
        this.aimMove = true;
      } else {
        this.aimMove = false;
      }
      return;
    }
    if (!this.pointer.has) return;
    this.ndc.set((this.pointer.x / window.innerWidth) * 2 - 1, -(this.pointer.y / window.innerHeight) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, camera);
    if (!this.raycaster.ray.intersectPlane(this.ground, this.hit)) return;
    this.aimA = Math.atan2(this.hit.z - meZ, this.hit.x - meX);
    this.aimMove = Math.hypot(this.hit.x - meX, this.hit.z - meZ) > radiusOf(meMass) + 0.6;
  }

  getInput(): Input {
    return {
      a: this.aimA,
      mv: this.aimMove,
      btn: this.holding,
    };
  }
}
