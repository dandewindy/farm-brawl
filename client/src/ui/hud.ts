import { SPECIES, type Species } from '@shared/constants';
import type { GameEvent, LeaderRow } from '@shared/protocol';
import { t } from '../i18n';

export interface FloatingText {
  el: HTMLDivElement;
  x: number;
  y: number;
  born: number;
}

export class HudManager {
  private readonly massEl: HTMLElement;
  private readonly rankTxt: HTMLElement;
  private readonly koTxt: HTMLElement;
  private readonly lbList: HTMLElement;
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

  private readonly startScreen: HTMLElement;
  private readonly deathScreen: HTMLElement;
  private readonly hudEl: HTMLElement;

  private readonly nameInput: HTMLInputElement;
  private readonly speciesContainer: HTMLElement;
  private readonly speciesHint: HTMLElement;
  private readonly playBtn: HTMLButtonElement;
  private readonly againBtn: HTMLButtonElement;
  private readonly changeBtn: HTMLButtonElement;

  private selectedSpecies: Species = 'pig';
  private floatingTexts: FloatingText[] = [];

  constructor(
    private readonly onStartPlay: (name: string, species: Species) => void
  ) {
    this.massEl = document.getElementById('mass')!;
    this.rankTxt = document.getElementById('rankTxt')!;
    this.koTxt = document.getElementById('koTxt')!;
    this.lbList = document.getElementById('lbList')!;
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

    this.initSpeciesPicker();
    this.initEvents();
  }

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
      this.onStartPlay(name, this.selectedSpecies);
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
    causeEl.textContent = killerName ? t('fenceBy', { killer: killerName }) : t('fenceSelf');
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

  updateLeaderboard(lb: LeaderRow[], myId: number): void {
    this.lbList.innerHTML = '';
    lb.forEach(([id, name, mass, kills]) => {
      const li = document.createElement('li');
      if (id === myId) li.classList.add('me');
      const row = document.createElement('div');
      const n = document.createElement('span');
      n.className = 'n';
      n.textContent = name;
      const k = document.createElement('span');
      k.className = 'k';
      k.textContent = kills > 0 ? `💥${kills}` : '';
      const v = document.createElement('span');
      v.className = 'v';
      v.textContent = `${mass} kg`;

      row.append(n, k, v);
      li.appendChild(row);
      this.lbList.appendChild(li);
    });
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

  showBanner(head: string, sub: string): void {
    this.bannerEl.innerHTML = '';
    const b = document.createElement('div');
    b.className = 'b';
    const h = document.createElement('div');
    h.className = 'h';
    h.textContent = head;
    const s = document.createElement('div');
    s.className = 's';
    s.textContent = sub;
    b.append(h, s);
    this.bannerEl.appendChild(b);
    setTimeout(() => b.remove(), 3000);
  }

  spawnFloat(text: string, screenX: number, screenY: number, isBig = false, isLoss = false): void {
    const el = document.createElement('div');
    el.className = `float ${isBig ? 'big' : ''} ${isLoss ? 'loss' : ''}`;
    el.textContent = text;
    el.style.left = `${screenX}px`;
    el.style.top = `${screenY}px`;
    this.floatsEl.appendChild(el);
    this.floatingTexts.push({ el, x: screenX, y: screenY, born: performance.now() });
  }

  updateFloats(): void {
    const now = performance.now();
    for (let i = this.floatingTexts.length - 1; i >= 0; i--) {
      const f = this.floatingTexts[i];
      const age = (now - f.born) / 1000;
      if (age > 0.9) {
        f.el.remove();
        this.floatingTexts.splice(i, 1);
        continue;
      }
      f.el.style.transform = `translate(-50%, calc(-50% - ${age * 45}px))`;
      f.el.style.opacity = String(1 - age / 0.9);
    }
  }
}
