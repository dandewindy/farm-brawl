import type { Input } from '@shared/protocol';

export class InputManager {
  private angle = 0;
  private moving = false;
  private buttonDown = false;
  private touchActive = false;
  private stickStart = { x: 0, y: 0 };
  private stickCurrent = { x: 0, y: 0 };

  private readonly stickEl: HTMLElement | null;
  private readonly stickKnob: HTMLElement | null;
  private readonly dashBtn: HTMLElement | null;

  constructor() {
    this.stickEl = document.getElementById('stick');
    this.stickKnob = document.getElementById('stickKnob');
    this.dashBtn = document.getElementById('dashBtn');

    this.bindMouseAndKeyboard();
    this.bindTouch();
  }

  private bindMouseAndKeyboard(): void {
    window.addEventListener('mousemove', (e) => {
      if (this.touchActive) return;
      const cx = window.innerWidth / 2;
      const cy = window.innerHeight / 2;
      this.angle = Math.atan2(e.clientY - cy, e.clientX - cx);
      this.moving = true;
    });

    window.addEventListener('mousedown', (e) => {
      if (e.button === 0 && !this.touchActive) {
        this.buttonDown = true;
      }
    });

    window.addEventListener('mouseup', (e) => {
      if (e.button === 0 && !this.touchActive) {
        this.buttonDown = false;
      }
    });

    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space') {
        this.buttonDown = true;
      }
    });

    window.addEventListener('keyup', (e) => {
      if (e.code === 'Space') {
        this.buttonDown = false;
      }
    });
  }

  private bindTouch(): void {
    if (!('ontouchstart' in window) && !navigator.maxTouchPoints) return;
    document.body.classList.add('touch');

    window.addEventListener('touchstart', (e) => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        if (t.clientX < window.innerWidth * 0.5) {
          // Left side: virtual stick
          this.touchActive = true;
          this.stickStart = { x: t.clientX, y: t.clientY };
          this.stickCurrent = { x: t.clientX, y: t.clientY };
          if (this.stickEl) {
            this.stickEl.style.left = `${t.clientX}px`;
            this.stickEl.style.top = `${t.clientY}px`;
            this.stickEl.hidden = false;
          }
          this.moving = true;
        }
      }
    }, { passive: true });

    window.addEventListener('touchmove', (e) => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        if (t.clientX < window.innerWidth * 0.5 && this.touchActive) {
          this.stickCurrent = { x: t.clientX, y: t.clientY };
          const dx = this.stickCurrent.x - this.stickStart.x;
          const dy = this.stickCurrent.y - this.stickStart.y;
          const dist = Math.hypot(dx, dy);
          if (dist > 5) {
            this.angle = Math.atan2(dy, dx);
            this.moving = true;
          }
          if (this.stickKnob) {
            const maxR = 40;
            const kx = dist > maxR ? (dx / dist) * maxR : dx;
            const ky = dist > maxR ? (dy / dist) * maxR : dy;
            this.stickKnob.style.transform = `translate(${kx}px, ${ky}px)`;
          }
        }
      }
    }, { passive: true });

    const endStick = () => {
      this.touchActive = false;
      this.moving = false;
      if (this.stickEl) this.stickEl.hidden = true;
      if (this.stickKnob) this.stickKnob.style.transform = '';
    };

    window.addEventListener('touchend', endStick, { passive: true });
    window.addEventListener('touchcancel', endStick, { passive: true });

    if (this.dashBtn) {
      this.dashBtn.addEventListener('touchstart', (e) => {
        e.preventDefault();
        this.buttonDown = true;
      });
      this.dashBtn.addEventListener('touchend', (e) => {
        e.preventDefault();
        this.buttonDown = false;
      });
    }
  }

  getInput(): Input {
    return {
      a: this.angle,
      mv: this.moving,
      btn: this.buttonDown,
    };
  }

  isButtonDown(): boolean {
    return this.buttonDown;
  }
}
