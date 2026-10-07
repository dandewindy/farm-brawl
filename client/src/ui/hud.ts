import * as THREE from 'three';
import { CFG, radiusOf, SPECIES, type Species } from '@shared/constants';
import type { ChoiceWire, GameEvent, HofRow, LeaderRow } from '@shared/protocol';
import { t } from '../i18n';

export interface FloatingText {
  el: HTMLDivElement;
  born: number;
  id: number;
  ax?: number;
  az?: number;
  ah?: number;
}

export class HudManager {
  private readonly massEl: HTMLElement;
  private readonly rankTxt: HTMLElement;
  private readonly koTxt: HTMLElement;
  private readonly lbList: HTMLElement;
  private readonly hofList: HTMLElement | null;
  private readonly reignEl: HTMLElement | null;
  private readonly ruleNameEl: HTMLElement | null;
  private readonly ruleDescEl: HTMLElement | null;
  private readonly feedEl: HTMLElement;
  private readonly ramEl: HTMLElement;
  private readonly ramFill: HTMLElement;
  private readonly ramTxt: HTMLElement;
  private readonly captureEl: HTMLElement;
  private readonly capFillEl: HTMLElement;
  private readonly capTxtEl: HTMLElement;
  private readonly floatsEl: HTMLElement;
  private readonly toastsEl: HTMLElement;
  private readonly bannerEl: HTMLElement;
  private bannerTimer = 0;

  private readonly startScreen: HTMLElement;
  private readonly deathScreen: HTMLElement;
  private readonly hudEl: HTMLElement;

  private readonly nameInput: HTMLInputElement;
  private readonly speciesContainer: HTMLElement;
  private readonly speciesHint: HTMLElement;
  private readonly playBtn: HTMLButtonElement;
  private readonly againBtn: HTMLButtonElement;
  private readonly changeBtn: HTMLButtonElement;

  private readonly choiceEl: HTMLElement | null;
  private readonly choiceLeftEl: HTMLElement | null;
  private readonly choiceCardsEl: HTMLElement | null;
  private readonly teamBarEl: HTMLElement | null;
  private readonly ts0El: HTMLElement | null;
  private readonly ts1El: HTMLElement | null;
  private readonly tClockEl: HTMLElement | null;
  private readonly muteBtn: HTMLElement | null;
  private readonly modesContainer: HTMLElement | null;
  private readonly roomTagEl: HTMLElement | null;

  public onPickRule?: (id: string) => void;
  public onToggleMute?: () => void;
  public onSelectMode?: (mode: 'ffa' | 'team') => void;
  private currentChoiceOptions: string[] = [];

  private selectedSpecies: Species = 'pig';
  private floatingTexts: FloatingText[] = [];

  constructor(
    private readonly onStartPlay: (name: string, species: Species, mode: 'ffa' | 'team') => void
  ) {
    this.massEl = document.getElementById('mass')!;
    this.rankTxt = document.getElementById('rankTxt')!;
    this.koTxt = document.getElementById('koTxt')!;
    this.lbList = document.getElementById('lbList')!;
    this.hofList = document.getElementById('hofList');
    this.reignEl = document.getElementById('reign');
    this.ruleNameEl = document.getElementById('ruleName');
    this.ruleDescEl = document.getElementById('ruleDesc');
    this.feedEl = document.getElementById('feed')!;
    this.ramEl = document.getElementById('ram')!;
    this.ramFill = document.getElementById('ramFill')!;
    this.ramTxt = document.getElementById('ramTxt')!;
    this.captureEl = document.getElementById('capture')!;
    this.capFillEl = document.getElementById('capFill')!;
    this.capTxtEl = document.getElementById('capTxt')!;
    this.floatsEl = document.getElementById('floats')!;
    this.toastsEl = document.getElementById('toasts')!;
    this.bannerEl = document.getElementById('banner')!;

    this.startScreen = document.getElementById('start')!;
    this.deathScreen = document.getElementById('death')!;
    this.hudEl = document.getElementById('hud')!;

    this.nameInput = document.getElementById('name') as HTMLInputElement;
    this.speciesContainer = document.getElementById('species')!;
    this.speciesHint = document.getElementById('speciesHint')!;
    this.playBtn = document.getElementById('play') as HTMLButtonElement;
    this.againBtn = document.getElementById('again') as HTMLButtonElement;
    this.changeBtn = document.getElementById('change') as HTMLButtonElement;

    this.choiceEl = document.getElementById('choice');
    this.choiceLeftEl = document.getElementById('choiceLeft');
    this.choiceCardsEl = document.getElementById('choiceCards');
    this.teamBarEl = document.getElementById('teamBar');
    this.ts0El = document.getElementById('ts0');
    this.ts1El = document.getElementById('ts1');
    this.tClockEl = document.getElementById('tClock');
    this.muteBtn = document.getElementById('mute');
    this.modesContainer = document.getElementById('modes');
    this.roomTagEl = document.getElementById('roomTag');

    this.initSpeciesPicker();
    this.initEvents();
  }

  private selectedMode: 'ffa' | 'team' = 'ffa';

  private initSpeciesPicker(): void {
    const emojis: Record<Species, string> = {
      chicken: '🐔', sheep: '🐑', horse: '🐴', cow: '🐄', duck: '🦆', pig: '🐷',
    };

    SPECIES.forEach((sp) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = emojis[sp];
      btn.dataset.species = sp;
      if (sp === this.selectedSpecies) btn.classList.add('on');

      btn.addEventListener('click', () => {
        this.selectedSpecies = sp;
        this.speciesContainer.querySelectorAll('button').forEach((b) => b.classList.remove('on'));
        btn.classList.add('on');
        this.speciesHint.textContent = t(`sp_${sp}`);
      });
      this.speciesContainer.appendChild(btn);
    });

    this.speciesHint.textContent = t(`sp_${this.selectedSpecies}`);
    this.nameInput.placeholder = t('namePh');
    this.nameInput.value = localStorage.getItem('fb_name') || '';
  }

  private initEvents(): void {
    const play = () => {
      const name = this.nameInput.value.trim() || t('defaultName');
      localStorage.setItem('fb_name', name);
      this.onStartPlay(name, this.selectedSpecies, this.selectedMode);
    };

    this.playBtn.addEventListener('click', play);
    this.nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') play();
    });

    this.againBtn.addEventListener('click', () => {
      this.deathScreen.hidden = true;
      play();
    });

    this.changeBtn.addEventListener('click', () => {
      this.deathScreen.hidden = true;
      this.startScreen.hidden = false;
      document.body.classList.add('menu');
    });

    if (this.muteBtn) {
      this.muteBtn.addEventListener('click', () => {
        this.onToggleMute?.();
      });
    }

    if (this.modesContainer) {
      this.modesContainer.querySelectorAll('button').forEach((btn) => {
        btn.addEventListener('click', () => {
          const mode = btn.dataset.mode as 'ffa' | 'team';
          if (mode) {
            this.selectedMode = mode;
            this.modesContainer?.querySelectorAll('button').forEach((b) => b.classList.remove('on'));
            btn.classList.add('on');
            this.onSelectMode?.(mode);
          }
        });
      });
    }

    window.addEventListener('keydown', (e) => {
      if (this.choiceEl && !this.choiceEl.hidden && this.currentChoiceOptions.length) {
        if (e.key === '1' && this.currentChoiceOptions[0]) {
          this.pickChoice(this.currentChoiceOptions[0]);
        } else if (e.key === '2' && this.currentChoiceOptions[1]) {
          this.pickChoice(this.currentChoiceOptions[1]);
        } else if (e.key === '3' && this.currentChoiceOptions[2]) {
          this.pickChoice(this.currentChoiceOptions[2]);
        }
      }
    });
  }

  public pickChoice(id: string): void {
    this.onPickRule?.(id);
    if (this.choiceEl) this.choiceEl.hidden = true;
    this.currentChoiceOptions = [];
  }

  public showChoice(c?: ChoiceWire | null): void {
    if (!c || !c.options || c.options.length === 0) {
      if (this.choiceEl) this.choiceEl.hidden = true;
      this.currentChoiceOptions = [];
      return;
    }
    this.currentChoiceOptions = c.options;
    if (this.choiceLeftEl) {
      this.choiceLeftEl.textContent = t('choiceLeft', { s: c.left });
    }
    if (this.choiceCardsEl) {
      this.choiceCardsEl.innerHTML = '';
      c.options.forEach((ruleId, idx) => {
        const b = document.createElement('button');
        b.className = 'plank';
        const kbd = document.createElement('kbd');
        kbd.textContent = String(idx + 1);
        const name = document.createElement('span');
        name.className = 'painted';
        name.textContent = t(`r_${ruleId}`);
        const desc = document.createElement('span');
        desc.className = 'd';
        desc.textContent = t(`d_${ruleId}`);
        b.append(kbd, name, desc);
        b.onclick = (e) => {
          e.stopPropagation();
          this.pickChoice(ruleId);
        };
        this.choiceCardsEl!.appendChild(b);
      });
    }
    if (this.choiceEl) this.choiceEl.hidden = false;
  }

  public updateTeamBar(t0: number, t1: number, clockSec: number): void {
    if (this.teamBarEl) this.teamBarEl.hidden = false;
    if (this.ts0El) this.ts0El.textContent = String(t0);
    if (this.ts1El) this.ts1El.textContent = String(t1);
    if (this.tClockEl) this.tClockEl.textContent = this.fmtTime(clockSec);
  }

  public setRoomTag(name: string): void {
    if (this.roomTagEl) {
      this.roomTagEl.hidden = false;
      this.roomTagEl.textContent = name;
    }
  }

  public setMuteState(muted: boolean): void {
    if (this.muteBtn) {
      this.muteBtn.innerHTML = muted
        ? `<span class="ico">🔇</span> <span>${t('sound')}</span>`
        : `<span class="ico">🔊</span> <span>${t('sound')}</span>`;
    }
  }

  showInGame(): void {
    this.startScreen.hidden = true;
    this.deathScreen.hidden = true;
    this.hudEl.hidden = false;
    document.body.classList.remove('menu');
  }

  showDeath(ev: Extract<GameEvent, { k: 'die' }>, killerName?: string): void {
    this.deathScreen.hidden = false;
    this.hudEl.hidden = true;
    document.body.classList.add('menu');

    const titleEl = document.getElementById('deathTitle')!;
    const causeEl = document.getElementById('deathCause')!;
    const dMass = document.getElementById('dMass')!;
    const dKills = document.getElementById('dKills')!;
    const dTime = document.getElementById('dTime')!;

    titleEl.textContent = t(`t_${ev.cause}`);
    causeEl.textContent = killerName ? t(`${ev.cause}By`, { killer: killerName }) : t(`${ev.cause}Self`);
    dMass.textContent = String(ev.best);
    dKills.textContent = String(ev.kills);
    const mins = Math.floor(ev.alive / 60);
    const secs = String(ev.alive % 60).padStart(2, '0');
    dTime.textContent = `${mins}:${secs}`;
  }

  updateStats(mass: number, rank: number, total: number, kills: number): void {
    this.massEl.textContent = String(Math.round(mass));
    this.rankTxt.textContent = t('rank', { r: rank || '–', n: total || '–' });
    this.koTxt.textContent = t('kos', { k: kills });
  }

  updateRamMeter(cd: number, charging: boolean, chargeLevel: number): void {
    if (cd > 0) {
      this.ramEl.className = 'cd';
      const pct = Math.max(0, 1 - cd / 1.3) * 100;
      this.ramFill.style.width = `${pct}%`;
      this.ramTxt.textContent = t('ramCd');
    } else if (charging) {
      this.ramEl.className = 'charging';
      this.ramFill.style.width = `${chargeLevel * 100}%`;
      this.ramTxt.textContent = t('ramCharge', { p: Math.round(chargeLevel * 100) });
    } else {
      this.ramEl.className = '';
      this.ramFill.style.width = '100%';
      this.ramTxt.textContent = t('ramReady');
    }
  }

  updateCapture(capId: number, progress: number, contested: boolean, myId: number, capName: string, isKing: boolean): void {
    const p = Math.round(progress * 100);
    if (contested) {
      this.captureEl.hidden = false;
      this.captureEl.classList.add('contested');
      this.capFillEl.style.width = '100%';
      this.capTxtEl.textContent = t('contested');
    } else if (capId > 0 && progress > 0.02) {
      this.captureEl.hidden = false;
      this.captureEl.classList.remove('contested');
      this.capFillEl.style.width = `${p}%`;
      if (capId === myId) {
        this.capTxtEl.textContent = isKing ? t('kingYou') : t('capYou', { p });
      } else {
        this.capTxtEl.textContent = isKing ? t('kingOther', { name: capName }) : t('capOther', { name: capName, p });
      }
    } else {
      this.captureEl.hidden = true;
    }
  }

  fmtTime(sec: number): string {
    const m = Math.floor(sec / 60);
    const s = String(sec % 60).padStart(2, '0');
    return `${m}:${s}`;
  }

  updateLeaderboard(lb: LeaderRow[], myId: number, napoleonId = 0): void {
    this.lbList.innerHTML = '';
    lb.forEach(([id, name, mass, kills, reign]) => {
      const li = document.createElement('li');
      if (id === myId) li.classList.add('me');
      const isKing = id === napoleonId && id > 0;
      if (isKing) li.classList.add('nap');

      const row = document.createElement('div');
      row.className = 'r';

      const n = document.createElement('span');
      n.className = 'n';
      n.textContent = name;

      const k = document.createElement('span');
      k.className = 'k';
      k.textContent = kills > 0 ? `💥${kills}` : '';

      const v = document.createElement('span');
      v.className = 'v';
      v.textContent = (isKing && reign && reign > 0) ? `👑 ${this.fmtTime(reign)} · ${mass} kg` : `${mass} kg`;

      row.append(n, k, v);
      li.appendChild(row);
      this.lbList.appendChild(li);
    });
  }

  updateHof(hof: HofRow[]): void {
    if (!this.hofList) return;
    const emojis: Record<Species, string> = {
      chicken: '🐔', sheep: '🐑', horse: '🐴', cow: '🐄', duck: '🦆', pig: '🐷',
    };
    this.hofList.innerHTML = '';
    for (const [name, sp, dur] of hof) {
      const li = document.createElement('li');
      const n = document.createElement('span');
      n.className = 'n';
      n.textContent = `${emojis[sp] || ''} ${name}`;
      const v = document.createElement('span');
      v.className = 'v';
      v.textContent = this.fmtTime(dur);
      li.append(n, v);
      this.hofList.appendChild(li);
    }
  }

  addFeed(text: string, isMine = false): void {
    const div = document.createElement('div');
    if (isMine) div.classList.add('mine');
    div.textContent = text;
    this.feedEl.appendChild(div);
    setTimeout(() => div.remove(), 4000);
  }

  showToast(text: string): void {
    const div = document.createElement('div');
    div.textContent = text;
    this.toastsEl.appendChild(div);
    setTimeout(() => div.remove(), 2600);
  }

  showRuleBanner(ruleId: string): void {
    const ruleTitle = t(`r_${ruleId}`);
    const ruleDesc = t(`d_${ruleId}`);
    this.showBanner(t('ruleNew', { rule: ruleTitle }), ruleDesc);
  }

  updateBoard(ruleId?: string, reignSec?: number, kingName?: string, isMe = false): void {
    if (this.ruleNameEl && this.ruleDescEl) {
      if (ruleId) {
        this.ruleNameEl.textContent = t(`r_${ruleId}`);
        this.ruleDescEl.textContent = t(`d_${ruleId}`);
      } else if (kingName) {
        this.ruleNameEl.textContent = t('r_equal');
        this.ruleDescEl.textContent = t('d_equal');
      } else {
        this.ruleNameEl.textContent = t('noNap');
        this.ruleDescEl.textContent = t('noNapDesc');
      }
    }
    if (this.reignEl) {
      if (kingName && reignSec !== undefined) {
        this.reignEl.hidden = false;
        const text = isMe
          ? t('reignYou', { t: this.fmtTime(reignSec) })
          : t('reignOther', { name: kingName, t: this.fmtTime(reignSec) });
        this.reignEl.textContent = `👑 ${text}`;
      } else {
        this.reignEl.hidden = true;
      }
    }
  }

  showBanner(head: string, sub: string): void {
    this.bannerEl.innerHTML = '';
    const h = document.createElement('span');
    h.className = 'head';
    h.textContent = head;
    this.bannerEl.appendChild(h);
    if (sub) {
      const s = document.createElement('span');
      s.className = 'sub';
      s.textContent = sub;
      this.bannerEl.appendChild(s);
    }
    this.bannerEl.classList.remove('show');
    void this.bannerEl.offsetWidth;
    this.bannerEl.classList.add('show');
    clearTimeout(this.bannerTimer);
    this.bannerTimer = window.setTimeout(() => this.bannerEl.classList.remove('show'), 3500);
  }

  floatText(text: string, cls = '', id = 0, initialPos?: { x: number; z: number; mass: number }): void {
    const el = document.createElement('div');
    el.className = `float ${cls}`.trim();
    el.textContent = text;
    this.floatsEl.appendChild(el);
    const item: FloatingText = {
      el,
      born: performance.now(),
      id,
    };
    if (initialPos) {
      item.ax = initialPos.x;
      item.az = initialPos.z;
      item.ah = radiusOf(initialPos.mass) * 3.6 + 1.5;
    }
    this.floatingTexts.push(item);
  }

  spawnFloat(text: string, screenX: number, screenY: number, isBig = false, isLoss = false): void {
    this.floatText(text, isLoss ? 'loss' : isBig ? 'big' : '', 0);
  }

  updateFloats(
    camera?: THREE.Camera,
    posResolver?: ((id: number) => { x: number; z: number; mass: number } | undefined) | Map<number, { x: number; z: number; mass: number }>
  ): void {
    const now = performance.now();
    for (let i = this.floatingTexts.length - 1; i >= 0; i--) {
      const f = this.floatingTexts[i];
      const age = (now - f.born) / 1000;
      if (age > 1.1) {
        f.el.remove();
        this.floatingTexts.splice(i, 1);
        continue;
      }

      if (posResolver && f.id) {
        const st = typeof posResolver === 'function' ? posResolver(f.id) : posResolver.get(f.id);
        if (st) {
          f.ax = st.x;
          f.az = st.z;
          f.ah = radiusOf(st.mass) * 3.6 + 1.5;
        }
      }

      if (camera && f.ax !== undefined && f.az !== undefined && f.ah !== undefined) {
        const v = new THREE.Vector3(f.ax, f.ah, f.az).project(camera);
        if (v.z > 1) {
          f.el.style.display = 'none';
          continue;
        }
        f.el.style.display = '';
        const sx = (v.x * 0.5 + 0.5) * window.innerWidth;
        const sy = (-v.y * 0.5 + 0.5) * window.innerHeight;
        f.el.style.transform = `translate(${sx}px, ${sy - age * 60}px) translate(-50%, -100%) scale(${age < 0.12 ? 0.6 + age * 3.3 : 1})`;
        f.el.style.opacity = String(age > 0.7 ? (1.1 - age) / 0.4 : 1);
      } else {
        const sx = window.innerWidth / 2;
        const sy = window.innerHeight / 2 - 40;
        f.el.style.transform = `translate(${sx}px, ${sy - age * 60}px) translate(-50%, -100%) scale(${age < 0.12 ? 0.6 + age * 3.3 : 1})`;
        f.el.style.opacity = String(age > 0.7 ? (1.1 - age) / 0.4 : 1);
      }
    }
  }
}
