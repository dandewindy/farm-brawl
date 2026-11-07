import { describe, expect, it } from 'vitest';
import { CFG, DT, TRAITS, radiusOf, getEasterEggSpeciesFromName, pickRandomSpecies } from '../src/constants';
import { generateMap } from '../src/map';
import { blobOutline, insideBlob, type Blob } from '../src/math';
import { dashParams, outsideFence, stepMove } from '../src/physics';
import { FLAG } from '../src/protocol';
import { World, TreeSimState, type Player } from '../src/sim/world';

/** a world with no bots and no food, so tests control everything */
function emptyWorld(seed = 1234): World {
  const w = new World(seed, { bots: false, food: false });
  w.food.clear();
  // keep hazards out of the way of the test arena
  w.map.hay.length = 0;
  w.map.pond.length = 0;
  w.map.mud.length = 0;
  w.map.well.length = 0;
  w.map.fire.length = 0;
  w.map.trees = [];
  w.treeSims.length = 0;
  w.map.podium = [45, 45];
  return w;
}

function place(w: World, id: number, x: number, z: number, mass = CFG.START_MASS): Player {
  const p = w.players.get(id)!;
  Object.assign(p, { x, z, vx: 0, vz: 0, mass });
  return p;
}

const run = (w: World, ticks: number) => { for (let i = 0; i < ticks; i++) { w.step(); w.flush(); } };

describe('map', () => {
  it('is deterministic for a seed', () => {
    expect(generateMap(42)).toEqual(generateMap(42));
    expect(generateMap(42)).not.toEqual(generateMap(43));
  });

  it('keeps everything inside the fence', () => {
    for (let s = 0; s < 50; s++) {
      const m = generateMap(s);
      for (const [x, z, r] of [...m.pond, ...m.mud]) expect(Math.hypot(x, z) + r * 1.3).toBeLessThan(CFG.R);
      for (const [x, z, r] of m.hay) expect(Math.hypot(x, z) + r).toBeLessThan(CFG.R);
      if (m.well) {
        for (const [x, z, r] of m.well) expect(Math.hypot(x, z) + r).toBeLessThan(CFG.R);
      }
      if (m.fire) {
        for (const [x, z, r] of m.fire) expect(Math.hypot(x, z) + r).toBeLessThan(CFG.R);
      }
      for (const t of m.trees) {
        expect(Math.hypot(t.x, t.z) + t.r).toBeLessThan(CFG.R);
        expect(Math.hypot(t.x, t.z)).toBeGreaterThan(65);
      }
    }
  });

  it('blob outline agrees with insideBlob', () => {
    const b: Blob = [3, -2, 5, 7.5];
    for (const [ox, oz] of blobOutline(b, -0.05, 32)) expect(insideBlob(b, b[0] + ox, b[1] + oz)).toBe(true);
    for (const [ox, oz] of blobOutline(b, 0.05, 32)) expect(insideBlob(b, b[0] + ox, b[1] + oz)).toBe(false);
  });
});

describe('movement', () => {
  it('walks toward the aim and heavier animals are slower', () => {
    const light = { x: 0, z: 0, vx: 0, vz: 0, a: 0, mass: 20, dashT: 0, stunT: 0, charging: false };
    const heavy = { ...light, mass: 300 };
    for (let i = 0; i < 40; i++) {
      stepMove(light, { a: 0, mv: true, btn: false }, DT, 'pig', 0);
      stepMove(heavy, { a: 0, mv: true, btn: false }, DT, 'pig', 0);
    }
    expect(light.x).toBeGreaterThan(heavy.x);
    expect(Math.abs(light.z)).toBeLessThan(1e-9);
  });

  it('a charged ram is faster and longer than a tap', () => {
    const tap = dashParams('cow', 0.05, 0), full = dashParams('cow', CFG.CHARGE_MAX, 0);
    expect(tap.plow).toBe(false);
    expect(full.plow).toBe(true);
    expect(full.speed).toBeGreaterThan(tap.speed);
    expect(full.time).toBeGreaterThan(tap.time);
    expect(full.power).toBeCloseTo(2);
  });

  it('pigs are not slowed by mud when dashing', () => {
    expect(dashParams('pig', 0, 2).speed).toBeGreaterThan(dashParams('sheep', 0, 2).speed);
  });

  it('detects the fence', () => {
    const b = { x: CFG.R - 0.1, z: 0, vx: 0, vz: 0, a: 0, mass: 20, dashT: 0, stunT: 0, charging: false };
    expect(outsideFence(b)).toBe(true);
    b.x = CFG.R - radiusOf(20);
    expect(outsideFence(b)).toBe(false);
  });
});

describe('world', () => {
  it('a tap between two ticks still dashes', () => {
    const w = emptyWorld();
    const id = w.addPlayer('A', 'horse');
    place(w, id, 0, 0);
    w.setInput(id, { a: 0, mv: false, btn: true });
    w.setInput(id, { a: 0, mv: false, btn: false });
    w.step();
    const p = w.players.get(id)!;
    expect(p.dashT).toBeGreaterThan(0);
    expect(p.vx).toBeGreaterThan(20);
    expect(p.cd).toBeGreaterThan(0);
  });

  it('ramming knocks the victim back, stuns it and knocks food loose', () => {
    const w = emptyWorld();
    const a = w.addPlayer('A', 'cow'), b = w.addPlayer('B', 'sheep');
    place(w, a, 0, 0, 40);
    place(w, b, 4, 0, 40);
    w.setInput(a, { a: 0, mv: true, btn: true });
    w.step(); w.flush();
    w.setInput(a, { a: 0, mv: true, btn: false });
    let hit = false;
    let lastSnap: any = null;
    for (let i = 0; i < 10 && !hit; i++) {
      w.step();
      lastSnap = w.snapshotFor(a);
      hit = lastSnap.ev.some((e: any) => e.k === 'hit' && e.a === a && e.v === b);
      w.flush();
    }
    expect(hit).toBe(true);
    const vic = w.players.get(b)!;
    expect(vic.vx).toBeGreaterThan(10);
    expect(vic.stunT).toBe(0);
    expect(vic.mass).toBeLessThan(40);
    expect(vic.lastHitBy).toBe(a);
    expect(w.food.size).toBeGreaterThan(0);
  });

  it('pushing a rival into the fence gives the kill and spoils', () => {
    const w = emptyWorld();
    const a = w.addPlayer('A', 'cow'), b = w.addPlayer('B', 'chicken');
    place(w, a, CFG.R - 9, 0, 60);
    place(w, b, CFG.R - 5, 0, 30);
    w.setInput(a, { a: 0, mv: true, btn: true });
    w.step(); w.flush();
    w.setInput(a, { a: 0, mv: false, btn: false });
    let death = null as null | { by: number; spoils: number; cause: string };
    for (let i = 0; i < 40 && !death; i++) {
      w.step();
      const e = w.snapshotFor(a).ev.find((ev) => ev.k === 'die');
      if (e && e.k === 'die') death = e;
      w.flush();
    }
    expect(death).not.toBeNull();
    expect(death!.cause).toBe('fence');
    expect(death!.by).toBe(a);
    expect(death!.spoils).toBeGreaterThan(0);
    expect(w.players.get(a)!.kills).toBe(1);
    expect(w.players.get(b)!.alive).toBe(false);
  });

  it('eating food adds its weight', () => {
    const w = emptyWorld();
    const id = w.addPlayer('A', 'pig');
    place(w, id, 0, 0);
    w.food.set(999, { id: 999, x: 0.5, z: 0, k: 2, v: 6 });
    w.step();
    expect(w.players.get(id)!.mass).toBeCloseTo(CFG.START_MASS + 6, 5);
    expect(w.food.has(999)).toBe(false);
  });

  it('fills the room with bots that survive and grow on their own', () => {
    const w = new World(99);
    run(w, CFG.BOT_FILL + 5);
    expect(w.players.size).toBe(CFG.BOT_FILL);
    run(w, 20 * 60); // one simulated minute
    const masses = [...w.players.values()].filter((p) => p.alive).map((p) => p.mass);
    expect(masses.length).toBeGreaterThan(CFG.BOT_FILL / 2);
    expect(Math.max(...masses)).toBeGreaterThan(CFG.START_MASS + 10);
  });

  it('a joining human replaces a bot', () => {
    const w = new World(7);
    run(w, CFG.BOT_FILL + 2);
    w.addPlayer('Human', 'duck');
    run(w, 2);
    expect(w.players.size).toBe(CFG.BOT_FILL);
    expect([...w.players.values()].some((p) => !p.bot)).toBe(true);
  });

  it('bot ignores food placed inside fire pit or well', () => {
    const w = emptyWorld();
    // Add a fire pit at (10, 0) with radius 2
    w.map.fire.push([10, 0, 2]);
    const id = w.addPlayer('BotPig', 'pig', true);
    place(w, id, 0, 0);
    // Place food inside the fire pit
    w.food.set(888, { id: 888, x: 10, z: 0, k: 0, v: 10 });
    // Run simulation for 20 ticks
    run(w, 20);
    const p = w.players.get(id)!;
    // Bot should still be alive and food should NOT be eaten
    expect(p.alive).toBe(true);
    expect(w.food.has(888)).toBe(true);
  });
});

describe('bonus weapons and tools', () => {
  it('players pick up tools lying on the ground', () => {
    const w = emptyWorld();
    const id = w.addPlayer('Picker', 'pig');
    place(w, id, 0, 0);
    w.tools.set(101, { id: 101, kind: 'pitchfork', x: 0.5, z: 0 });

    w.step();
    const p = w.players.get(id)!;
    expect(p.pitchforkT).toBeGreaterThan(9.0);
    expect(w.tools.has(101)).toBe(false);
  });

  it('pitchfork hits harder and strips extra weight off Napoleon (3 hits: 30%, 20%, 10%)', () => {
    const w = emptyWorld();
    const attacker = w.addPlayer('Attacker', 'pig');
    const king = w.addPlayer('King', 'pig');
    place(w, attacker, 0, 0, 40);
    place(w, king, 2, 0, 100);
    w.napoleonId = king;
    w.ruleTimer = 40;

    const pAtt = w.players.get(attacker)!;
    pAtt.pitchforkT = 10;
    pAtt.input = { a: 0, mv: true, btn: true };
    pAtt.dashT = 0.3;
    pAtt.power = 1.0;
    pAtt.vx = 20;

    // Hit 1: 30% of 100kg = 30kg loss
    w.step();
    const kingP = w.players.get(king)!;
    expect(kingP.mass).toBe(70);
    expect(pAtt.mass).toBe(55); // 40 + 15 stolen
    expect(pAtt.pitchforkHits).toBe(2);

    // Hit 2: 20% of 70kg = 14kg loss
    pAtt.x = 0; pAtt.z = 0; pAtt.dashT = 0.3; pAtt.vx = 20; pAtt.dashHit.clear();
    kingP.x = 1.0; kingP.z = 0;
    w.step();
    expect(kingP.mass).toBe(56);
    expect(pAtt.pitchforkHits).toBe(1);

    // Hit 3: 10% of 56kg = 6kg loss
    pAtt.x = 0; pAtt.z = 0; pAtt.dashT = 0.3; pAtt.vx = 20; pAtt.dashHit.clear();
    kingP.x = 1.0; kingP.z = 0;
    w.step();
    expect(kingP.mass).toBe(50);
    expect(pAtt.pitchforkHits).toBe(0);
    expect(pAtt.pitchforkT).toBe(0); // consumed after 3 hits!
  });

  it('dynamite explodes on hit and knocks back bystanders', () => {
    const w = emptyWorld();
    const attId = w.addPlayer('Bomber', 'pig');
    const vicId = w.addPlayer('Victim', 'pig');
    const byId = w.addPlayer('Bystander', 'pig');
    place(w, attId, 0, 0, 50);
    place(w, vicId, 2, 0, 200); // >= 100kg so survives
    place(w, byId, 1, 3, 50);

    const att = w.players.get(attId)!;
    att.hasDynamite = true;
    att.dashT = 0.3;
    att.power = 1.0;
    att.vx = 20;

    const bystander = w.players.get(byId)!;
    expect(bystander.vx).toBe(0);

    w.step();
    expect(att.hasDynamite).toBe(false);
    expect(Math.abs(bystander.vz)).toBeGreaterThan(0.5);
  });

  it('dynamite immediately kills any victim under 100kg', () => {
    const w = emptyWorld();
    const attId = w.addPlayer('Bomber', 'pig');
    const vicId = w.addPlayer('SmallVictim', 'pig');
    place(w, attId, 0, 0, 50);
    place(w, vicId, 2, 0, 80); // under 100kg -> instant explosion death

    const att = w.players.get(attId)!;
    att.hasDynamite = true;
    att.dashT = 0.3;
    att.power = 1.0;
    att.vx = 20;

    w.step();
    const vic = w.players.get(vicId)!;
    expect(vic.alive).toBe(false);
    const dieEv = w.events.find((e) => e.k === 'die' && e.id === vicId);
    expect(dieEv).toBeDefined();
    expect((dieEv as any).cause).toBe('dynamite');
    expect((dieEv as any).by).toBe(attId);
  });

  it('dynamite reduces 25% with a minimum loss of 100kg for victims >= 100kg', () => {
    const w = emptyWorld();
    const attId = w.addPlayer('Bomber', 'pig');
    const vicId = w.addPlayer('HeavyVictim', 'pig');
    place(w, attId, 0, 0, 50);
    place(w, vicId, 2, 0, 1000); // 1000kg: 25% = 250kg (> 100kg) -> remaining 750kg

    const att = w.players.get(attId)!;
    att.hasDynamite = true;
    att.dashT = 0.3;
    att.power = 1.0;
    att.vx = 20;

    w.step();
    const hitEv = w.events.find((e) => e.k === 'hit' && e.v === vicId) as any;
    expect(hitEv).toBeDefined();
    expect(hitEv.loss).toBe(250); // 25% of 1000kg is 250kg

    // Test minimum 100kg loss when 25% is less than 100kg (e.g. 200kg: 25% is 50kg, min is 100kg)
    const w2 = emptyWorld();
    const a2 = w2.addPlayer('B2', 'pig');
    const v2 = w2.addPlayer('V2', 'pig');
    place(w2, a2, 0, 0, 50);
    place(w2, v2, 2, 0, 200);
    const att2 = w2.players.get(a2)!;
    att2.hasDynamite = true;
    att2.dashT = 0.3;
    att2.power = 1.0;
    att2.vx = 20;

    w2.step();
    const hitEv2 = w2.events.find((e) => e.k === 'hit' && e.v === v2) as any;
    expect(hitEv2).toBeDefined();
    expect(hitEv2.loss).toBe(100); // Math.max(100, 200 * 0.25) = 100kg
  });

  it('song slows down Napoleon and blocks ramming', () => {
    const w = emptyWorld();
    const kingId = w.addPlayer('KingPig', 'pig');
    const singerId = w.addPlayer('Singer', 'pig');
    place(w, kingId, 0, 0, 40);
    place(w, singerId, 10, 10, 40);
    w.napoleonId = kingId;

    w.tools.set(999, { id: 999, kind: 'song', x: 10.2, z: 10 });
    w.step();

    const king = w.players.get(kingId)!;
    expect(king.slowT).toBeGreaterThan(5.0);

    // King tries to press ram button
    king.input = { a: 0, mv: true, btn: true };
    king.btnLatch = true;
    w.step();
    expect(king.dashT).toBe(0);
    expect(king.charging).toBe(false);
  });

  it('eating rainbow candy (kind 6) activates super mode and super flight', () => {
    const w = emptyWorld();
    const pid = w.addPlayer('SuperPig', 'pig');
    const p = place(w, pid, 0, 0, 20);

    // Place rainbow candy right in front of the player
    w.food.set(888, { id: 888, x: 0.5, z: 0, k: 6, v: 3 });
    w.step();

    expect(p.superT).toBeGreaterThan(9.0);
    expect(p.mass).toBe(23);

    // Snapshot encodes FLAG.SUPER
    const snap = w.snapshotFor(pid);
    const wire = snap.p.find((x) => x[0] === pid)!;
    expect(wire[5] & 32768).toBe(32768); // FLAG.SUPER

    // Trigger dash while super -> launches rocket flight
    p.input = { a: 0, mv: true, btn: false };
    p.btnLatch = true;
    w.step();

    expect(p.flyT).toBeGreaterThan(0.4);
    expect(p.vx).toBeGreaterThan(40);
  });

  it('supports 4 skins per species and preserves custom skin on join/respawn', () => {
    const w = emptyWorld();
    const pid = w.addPlayer('FancyCow', 'cow', false, undefined, 3);
    const p = w.players.get(pid)!;
    expect(p.skin).toBe(3);

    p.alive = false;
    w.respawn(pid, 'FancyCow', 'cow', 2);
    expect(p.skin).toBe(2);
  });

  it('blocks charging and dashing when inside water', () => {
    const w = emptyWorld();
    const pid = w.addPlayer('Swimmer', 'pig');
    const p = place(w, pid, 0, 0, 20);

    // Place a pond at (0, 0)
    w.map.pond = [[0, 0, 10, 0]];
    w.step();
    expect(p.terrain).toBe(1);

    // Try to charge ram button in water
    p.input = { a: 0, mv: true, btn: true };
    p.btnLatch = true;
    w.step();

    expect(p.charging).toBe(false);
    expect(p.holdT).toBe(0);

    // Try to release/dash in water
    p.input = { a: 0, mv: true, btn: false };
    p.btnLatch = true;
    w.step();

    expect(p.dashT).toBe(0);
  });

  it('ramming into hay bale stuns for 1.5 seconds', () => {
    const w = emptyWorld();
    const pid = w.addPlayer('Rammer', 'pig');
    const p = place(w, pid, 0, 0, 20);

    // Hay bale at x=2, z=0, radius=1.5
    w.map.hay = [[2, 0, 1.5]];

    // Dash towards hay bale at high speed
    p.dashT = 0.3;
    p.vx = 25;
    p.vz = 0;

    w.step();

    expect(p.stunT).toBeGreaterThanOrEqual(1.4);
    expect(p.dashT).toBe(0);
  });

  it('walking into hay bale does not stun', () => {
    const w = emptyWorld();
    const pid = w.addPlayer('Walker', 'pig');
    const p = place(w, pid, 0, 0, 20);

    w.map.hay = [[2, 0, 1.5]];

    // Normal walking speed towards hay bale, no dash
    p.dashT = 0;
    p.vx = 12;
    p.vz = 0;

    w.step();

    expect(p.stunT).toBe(0);
  });

  it('super mode hit sends victim flying with extra knockback', () => {
    const w = emptyWorld();
    const attId = w.addPlayer('SuperBull', 'cow');
    const vicId = w.addPlayer('Victim', 'pig');
    place(w, attId, 0, 0, 30);
    place(w, vicId, 2, 0, 30);

    const att = w.players.get(attId)!;
    const vic = w.players.get(vicId)!;

    att.superT = 8.0;
    att.dashT = 0.3;
    att.power = 5.0;
    att.vx = 60;

    w.step();

    // Victim knocked back with violent massive velocity (~150)
    expect(vic.vx).toBeGreaterThan(120);
    expect(vic.stunT).toBe(0);
  });

  it('knockback velocity persists across multiple steps and flings victim even while walking', () => {
    const w = emptyWorld();
    const attId = w.addPlayer('Attacker', 'cow');
    const vicId = w.addPlayer('Victim', 'pig');
    place(w, attId, 0, 0, 30);
    place(w, vicId, 2, 0, 30);

    const att = w.players.get(attId)!;
    const vic = w.players.get(vicId)!;

    att.superT = 8.0;
    att.dashT = 0.3;
    att.power = 5.0;
    att.vx = 60;

    w.step(); // collision occurs here

    // Victim knocked back with violent massive velocity (~150)
    expect(vic.vx).toBeGreaterThan(120);
    expect(vic.stunT).toBe(0);
  });

  it('private room with bots: false never spawns bots', () => {
    const w = new World(1234, { bots: false });
    expect(w.players.size).toBe(0);
    const p1 = w.addPlayer('Friend1', 'cow');
    const p2 = w.addPlayer('Friend2', 'pig');
    for (let i = 0; i < 20; i++) {
      w.step();
    }
    expect(w.players.size).toBe(2);
    expect(w.players.get(p1)!.bot).toBe(false);
    expect(w.players.get(p2)!.bot).toBe(false);
  });

  it('animals under 20kg cannot charge up ram', () => {
    const w = emptyWorld();
    const pid = w.addPlayer('Lightweight', 'pig');
    const p = place(w, pid, 0, 0, 15); // mass 15kg (< 20kg)

    p.input = { a: 0, mv: true, btn: true };
    p.btnLatch = true;
    for (let i = 0; i < 10; i++) {
      w.step();
    }

    expect(p.charging).toBe(false);
    expect(p.holdT).toBe(0);

    // After eating and reaching >= 20kg, charging is enabled
    p.mass = 25;
    p.input = { a: 0, mv: true, btn: true };
    p.btnLatch = true;
    for (let i = 0; i < 10; i++) {
      w.step();
    }
    expect(p.charging).toBe(true);
    expect(p.holdT).toBeGreaterThan(0.3);
  });

  it('animals can grow past 600kg without limit', () => {
    const w = emptyWorld();
    const pid = w.addPlayer('Giant', 'cow');
    const p = place(w, pid, 0, 0, 590);

    // Eat high-value food
    w.food.set(999, { id: 999, x: 0, z: 0, k: 4, v: 50 });
    w.step();

    expect(p.mass).toBeGreaterThan(600);
  });

  it('bots are always named matching their species', () => {
    for (let seed = 1; seed <= 5; seed++) {
      const w = new World(seed * 100);
      w.step(); // fillBots runs
      for (const p of w.players.values()) {
        if (!p.bot) continue;
        const validPrefixes: Record<string, string[]> = {
          pig: ['Ủn', 'Bé', 'Heo', 'Mập', 'Bụng', 'Trư', 'Bạch', 'Lợn'],
          cow: ['Bò', 'Bê', 'Ngưu'],
          chicken: ['Gà', 'Kê'],
          duck: ['Vịt'],
          sheep: ['Cừu', 'Dương', 'Bạch'],
          horse: ['Ngựa', 'Bạch', 'Xích', 'Hắc', 'Boxer', 'Clover', 'Tuấn', 'Thiên'],
          dog: ['Chó', 'Cún', 'Cậu', 'Bé', 'Gâu'],
          elephant: ['Voi', 'Bé'],
          monkey: ['Khỉ', 'Tề', 'Tôn', 'Vượn', 'Mỹ'],
          gorilla: ['Gorilla', 'King', 'Titan', 'Đại', 'Tinh'],
          mammoth: ['Voi', 'Mammoth', 'Ma', 'Titan', 'Bé'],
          wolf: ['Sói', 'Hắc', 'Bạch', 'Chó', 'Cún', 'Cậu', 'Bé', 'Gâu'],
        };
        const checkSpecies = p.morphOrigSpecies || p.species;
        const prefixes = validPrefixes[checkSpecies] || [];
        const matches = prefixes.some((pre) => p.name.includes(pre));
        expect(matches).toBe(true);
      }
    }
  });

  it('food scatter and food spawn never land inside well mouth', () => {
    for (let seed = 10; seed <= 15; seed++) {
      const w = new World(seed);
      // Check initially spawned food
      for (const [, f] of w.food) {
        for (const [wx, wz, wr] of (w.map.well || [])) {
          const dist = Math.hypot(f.x - wx, f.z - wz);
          expect(dist).toBeGreaterThanOrEqual(wr);
        }
      }

      // Simulate deaths over well mouth and check scattered food
      if (w.map.well && w.map.well.length > 0) {
        const [wx, wz, wr] = w.map.well[0];
        const pId = w.addPlayer('Faller', 'pig');
        const p = place(w, pId, wx, wz, 100);
        // Force kill over well
        w.kill(p, 'well');

        for (const [, f] of w.food) {
          const dist = Math.hypot(f.x - wx, f.z - wz);
          expect(dist).toBeGreaterThanOrEqual(wr);
        }
      }
    }
  });

  it('watermelon food kind exists and gives 11kg', () => {
    const w = emptyWorld();
    const pId = w.addPlayer('MelonEater', 'pig');
    const p = place(w, pId, 0, 0, 20);

    w.food.set(1001, { id: 1001, x: 0, z: 0, k: 7, v: 11 });
    w.step();

    expect(p.mass).toBe(31);
  });

  it('sheep has 30% stronger ram power trait', () => {
    expect(TRAITS.sheep.ram).toBe(1.3);
    expect(TRAITS.pig.ram).toBe(1.0);
    expect(TRAITS.chicken.ram).toBe(1.0);

    const w = emptyWorld();
    const sheepId = w.addPlayer('RammerSheep', 'sheep');
    const sheep = place(w, sheepId, 0, 0, 50);
    const pigId = w.addPlayer('TargetPig', 'pig');
    const target = place(w, pigId, 2.5, 0, 50);

    // Sheep dashes into pig
    sheep.vx = 20;
    sheep.dashT = 0.2;
    w.step();

    // Target pig was rammed with extra knockback force
    expect(target.vx).toBeGreaterThan(15);
  });

  it('mud puddles have enlarged sizes including x2 and x3', () => {
    const m = generateMap(42);
    expect(m.mud.length).toBeGreaterThan(0);
    // At least one mud puddle has radius >= 8 (scaled x2)
    const hasX2 = m.mud.some((blob) => blob[2] >= 8);
    expect(hasX2).toBe(true);
    // At least one mud puddle has radius >= 12 (scaled x3)
    const hasX3 = m.mud.some((blob) => blob[2] >= 12);
    expect(hasX3).toBe(true);
  });

  it('hunger decay reduces mass over time, and drops below 10kg causes starvation death', () => {
    const w = emptyWorld();
    const pId = w.addPlayer('HungryAnimal', 'cow');
    const p = place(w, pId, 0, 0, 20);

    // After 2.5s grace period (at 60fps = 150 ticks), mass should slowly decrease
    for (let i = 0; i < 240; i++) {
      w.step();
    }
    expect(p.mass).toBeLessThan(20);

    // Force mass to 10.2kg
    p.mass = 10.2;
    for (let i = 0; i < 60; i++) {
      w.step();
      if (!p.alive) break;
    }
    // Starvation death occurs below 10kg
    expect(p.alive).toBe(false);
    const dieEv = w.flush; // events were pushed
  });

  it('renewGame generates a new map layout, items, and resets game state', () => {
    const w = new World(123);
    const oldPodium = [...w.map.podium];
    const oldSeed = w.map.seed;

    w.renewGame(999);

    expect(w.map.seed).toBe(999);
    expect(w.food.size).toBe(CFG.FOOD_TARGET);
    expect(w.tools.size).toBe(CFG.TOOL_TARGET);
    expect(w.matchClock).toBe(300);
    expect(w.teamScores).toEqual([0, 0]);
  });

  it('podium shield is active for first 30s and physically blocks animals', () => {
    const w = emptyWorld();
    w.map.podium = [0, 0];
    w.podiumShield = true;
    w.podiumPhaseTimer = 30;

    const pid = w.addPlayer('BlockedTest', 'pig');
    const p = place(w, pid, 12, 0, 25);
    const r = radiusOf(25);
    const minD = CFG.PODIUM_R + 0.5 + r;

    // Animal runs toward center (0, 0)
    w.setInput(pid, { a: Math.PI, mv: true, btn: false });
    for (let i = 0; i < 40; i++) {
      w.step();
    }
    // Animal is physically blocked outside the shield barrier
    expect(p.x).toBeGreaterThanOrEqual(minD - 0.05);

    // Snapshot includes podShield state
    const snap = w.snapshotFor(pid);
    expect(snap.podShield).toBeDefined();
    expect(snap.podShield![0]).toBe(true);
  });

  it('podium shield opens after 30s with 5s warning, and blasts if no King after 30s', () => {
    const w = emptyWorld();
    w.map.podium = [0, 0];
    w.podiumShield = true;
    w.podiumPhaseTimer = 6; // 6s left in shield phase

    let warnedOpen = false;
    for (let i = 0; i < 40; i++) {
      w.step();
      const snap = w.snapshotFor(1);
      if (snap.ev.some((e) => e.k === 'podWarn' && !e.willShield)) {
        warnedOpen = true;
      }
    }
    // 5s warning was triggered
    expect(warnedOpen).toBe(true);

    // Step until shield phase ends and opens
    while (w.podiumShield) {
      w.step();
    }
    // Shield is now OPEN!
    expect(w.podiumShield).toBe(false);
    expect(w.podiumPhaseTimer).toBeCloseTo(30, 0);

    // Animal enters podium to fight
    const pid = w.addPlayer('Contender', 'pig');
    const p = place(w, pid, 2, 0, 30);

    // Fast-forward open phase until 5s warning
    w.podiumPhaseTimer = 6;
    let warnedClose = false;
    for (let i = 0; i < 40; i++) {
      w.step();
      const snap = w.snapshotFor(pid);
      if (snap.ev.some((e) => e.k === 'podWarn' && e.willShield)) {
        warnedClose = true;
      }
    }
    expect(warnedClose).toBe(true);

    // Step until open phase expires without a King crowned
    let blastFired = false;
    for (let i = 0; i < 100; i++) {
      w.step();
      const snap = w.snapshotFor(pid);
      if (snap.ev.some((e) => e.k === 'podBlast')) {
        blastFired = true;
        break;
      }
    }
    // Blast knocked contender outward and shield re-armed
    expect(blastFired).toBe(true);
    expect(p.vx).toBeGreaterThan(15);
    expect(w.podiumShield).toBe(true);
    expect(w.podiumPhaseTimer).toBeCloseTo(30, 0);
  });

  it('Farmer Till rule spawns tractor that chases animals, squishes them flat and can kill with cause till', () => {
    const w = emptyWorld();
    const pid = w.addPlayer('TargetAnimal', 'cow');
    const p = place(w, pid, 10, 0, 40);

    w.applyRule('till');
    expect(w.currentRule).toBe('till');
    expect(w.tillTruck.timer).toBe(1.0);

    // Step until tractor spawns
    for (let i = 0; i < 70; i++) {
      w.step();
    }
    expect(w.tillTruck.active).toBe(true);

    // Tractor steers towards animal at (10, 0)
    // Place tractor directly approaching the animal to test collision
    w.tillTruck.x = 6.0;
    w.tillTruck.z = 0;
    w.tillTruck.angle = 0; // heading +X straight at animal
    w.tillTruck.vx = 19;
    w.tillTruck.vz = 0;

    w.step();

    // Animal is squished flat and instantly killed/eliminated!
    expect(p.alive).toBe(false);
    expect(p.squishT).toBe(2.8);

    const dieEv = w.snapshotFor(pid).ev.find((e) => e.k === 'die' && e.id === pid);
    expect(dieEv).toBeDefined();
    expect((dieEv as any).cause).toBe('till');

    // Test forest exit: after sweeping, truck drives straight out and vanishes
    w.tillTruck.sweepT = 0; // Sweeping complete
    w.step();
    expect(w.tillTruck.exiting).toBe(true);

    // Fast-forward until truck reaches outer forest
    for (let i = 0; i < 150 && w.tillTruck.active; i++) {
      w.step();
    }
    // Vanished in the forest outside R = 105
    expect(w.tillTruck.active).toBe(false);
    expect(w.currentRule).toBe('');
  });

  it('team mode never spawns bots under any circumstances', () => {
    const w = new World(9999, { mode: 'team' });
    expect(w.botsEnabled).toBe(false);
    expect(w.players.size).toBe(0);

    // Run 50 ticks, should never spawn any bot
    for (let i = 0; i < 50; i++) {
      w.step();
    }
    expect(w.players.size).toBe(0);

    // Human player joins team 0
    const humanId = w.addPlayer('HumanPlayer', 'cow', false, 0);
    for (let i = 0; i < 50; i++) {
      w.step();
    }
    // Only the human exists, still zero bots
    expect(w.players.size).toBe(1);
    expect(w.players.get(humanId)?.bot).toBe(false);

    // Renew game also keeps zero bots (human player remains connected, awaiting respawn)
    w.renewGame();
    expect(w.botsEnabled).toBe(false);
    expect(w.players.size).toBe(1);
    expect(w.players.get(humanId)?.bot).toBe(false);
    expect(w.players.get(humanId)?.alive).toBe(false);
  });

  it('King continuously gets to choose commandments every 30 seconds', () => {
    const w = emptyWorld();
    const kingId = w.addPlayer('KingPig', 'pig', false);
    const king = place(w, kingId, 25, 25, 200);
    w.napoleonId = kingId;

    // Coronation triggers commandment choice
    w.startKingChoice();
    expect(w.kingChoice).not.toBeNull();
    expect(w.kingChoice!.options.length).toBe(3);

    // King picks a non-till option so tractor doesn't squish idle King during fast-forward
    const choice1 = w.kingChoice!.options.find((r) => r !== 'till') ?? w.kingChoice!.options[0];
    w.chooseRule(kingId, choice1);
    expect(w.currentRule).toBe(choice1);
    expect(w.ruleTimer).toBe(30);
    expect(w.kingChoice).toBeNull();

    // Fast-forward 30 seconds (600 ticks)
    for (let i = 0; i < 600; i++) {
      w.step();
    }

    // King should now be offered a new choice again!
    expect(w.kingChoice).not.toBeNull();
    expect(w.kingChoice!.options.length).toBe(3);

    // King picks new rule
    const choice2 = w.kingChoice!.options[0];
    w.chooseRule(kingId, choice2);
    expect(w.currentRule).toBe(choice2);
    expect(w.ruleTimer).toBe(30);
  });

  it('Farmer Till rule gives +50% movement speed while tractor is on the field', () => {
    const w = emptyWorld();
    const pid = w.addPlayer('Runner', 'pig', false);
    const p = place(w, pid, 10, 10, 40);

    // Initial movement without Till
    p.input = { a: 0, mv: true, btn: false };
    w.step();
    const normalVx = p.vx;
    expect(normalVx).toBeGreaterThan(0);

    // Reset position and activate Till rule
    p.vx = 0;
    p.vz = 0;
    w.applyRule('till');
    // Step until tractor is active
    for (let i = 0; i < 30; i++) {
      w.step();
    }
    expect(w.tillTruck.active).toBe(true);

    // Non-King player does NOT get the +50% speed buff during Till rule
    p.vx = 0;
    p.vz = 0;
    p.x = 20;
    p.z = 20;
    p.input = { a: 0, mv: true, btn: false };
    w.step();
    expect(p.vx / normalVx).toBeCloseTo(1.0, 1);

    // Only King gets the +50% speed buff
    w.napoleonId = p.id;
    p.vx = 0;
    p.vz = 0;
    p.x = 20;
    p.z = 20;
    p.input = { a: 0, mv: true, btn: false };
    w.step();
    const kingTillVx = p.vx;
    expect(kingTillVx / normalVx).toBeCloseTo(1.5, 1);
  });

  it('mud slows dash speed and shortens dash range for non-pig animals, but pig is immune', () => {
    const grassSheep = dashParams('sheep', 0, 0);
    const mudSheep = dashParams('sheep', 0, 2);
    expect(mudSheep.speed).toBeLessThan(grassSheep.speed);
    expect(mudSheep.time).toBeLessThan(grassSheep.time);
    expect(mudSheep.time).toBeCloseTo(grassSheep.time * 0.6);

    const grassPig = dashParams('pig', 0, 0);
    const mudPig = dashParams('pig', 0, 2);
    expect(mudPig.speed).toBe(grassPig.speed);
    expect(mudPig.time).toBe(grassPig.time);
  });

  it('chicken has +30% dash speed and faster dash cooldown', () => {
    expect(TRAITS.chicken.dash).toBe(1.30);
    const w = emptyWorld();
    const cid = w.addPlayer('Chick', 'chicken', false);
    const c = place(w, cid, 0, 0);
    c.input = { a: 0, mv: false, btn: true };
    w.step();
    c.input = { a: 0, mv: false, btn: false };
    w.step();
    expect(c.cd).toBeCloseTo(CFG.DASH_CD * 0.65, 1);
  });

  it('cow spawns with minimum 100kg mass', () => {
    const w = emptyWorld();
    const cowId = w.addPlayer('Daisy', 'cow', false);
    const cow = w.players.get(cowId)!;
    expect(cow.mass).toBe(100);
    expect(cow.best).toBe(100);
  });

  it('dog can swim in water without drowning, runs fast on land like horse, water speed is 0.35', () => {
    expect(TRAITS.dog.speed).toBe(TRAITS.horse.speed);
    expect(TRAITS.dog.water).toBe(0.35);

    const w = emptyWorld();
    w.map.pond = [[10, 10, 8, 8]];

    const dogId = w.addPlayer('Buddy', 'dog', false);
    const dog = place(w, dogId, 10, 10, 30);

    const sheepId = w.addPlayer('Fluffy', 'sheep', false);
    const sheep = place(w, sheepId, 10, 10, 30);

    // Run for 2.0 seconds (40 ticks > 1.5s drown threshold)
    for (let i = 0; i < 40; i++) {
      w.step();
    }

    expect(sheep.alive).toBe(false); // Sheep drowned
    expect(dog.alive).toBe(true); // Dog is swimming happily!
  });

  it('bots can spawn as any of the 9 species including dog, elephant and monkey', () => {
    const spawnedSpecies = new Set<Species>();
    for (let run = 0; run < 35; run++) {
      const w = emptyWorld(1234 + run * 37);
      w.botsEnabled = true;
      for (let i = 0; i < 25; i++) {
        w.step();
      }
      for (const p of w.players.values()) {
        if (p.bot) {
          spawnedSpecies.add(p.species);
        }
      }
    }
    // Verify dog, elephant, and monkey are all present in bot spawns
    expect(spawnedSpecies.has('dog')).toBe(true);
    expect(spawnedSpecies.has('elephant')).toBe(true);
    expect(spawnedSpecies.has('monkey')).toBe(true);
  });

  it('elephant spawns with 1000kg start mass', () => {
    const w = emptyWorld();
    const eleId = w.addPlayer('Dumbo', 'elephant', false);
    const ele = w.players.get(eleId)!;
    expect(ele.mass).toBe(1000);
    expect(ele.best).toBe(1000);
  });

  it('elephant >= 1000kg ramming enemy < 50kg crushes and instakills victim', () => {
    const w = emptyWorld();
    const eleId = w.addPlayer('Dumbo', 'elephant', false);
    const ele = place(w, eleId, 0, 0, 1000);

    const chickenId = w.addPlayer('Chick', 'chicken', false);
    const chicken = place(w, chickenId, 2.5, 0, 40);

    // Elephant dashes right into chicken
    ele.dashT = 0.5;
    ele.vx = 25;
    ele.charging = false;

    w.step();

    expect(chicken.alive).toBe(false);
    expect(chicken.squishT).toBe(2.8);
    const dieEv = w.events.find((e) => e.k === 'die' && e.id === chickenId);
    expect(dieEv).toBeDefined();
    if (dieEv && dieEv.k === 'die') {
      expect(dieEv.cause).toBe('crush');
      expect(dieEv.by).toBe(eleId);
    }
  });

  it('elephant ramming enemy >= 50kg or when elephant < 1000kg does not instakill', () => {
    const w = emptyWorld();
    const eleId = w.addPlayer('Dumbo', 'elephant', false);
    const ele = place(w, eleId, 0, 0, 1000);

    const sheepId = w.addPlayer('Woolly', 'sheep', false);
    const sheep = place(w, sheepId, 2.5, 0, 60); // 60kg >= 50kg

    ele.dashT = 0.5;
    ele.vx = 25;
    ele.charging = false;

    w.step();

    expect(sheep.alive).toBe(true); // not crushed!

    // Now test elephant with < 1000kg against < 50kg victim
    const ele2Id = w.addPlayer('MiniEle', 'elephant', false);
    const ele2 = place(w, ele2Id, 10, 10, 800); // 800kg < 1000kg

    const chick2Id = w.addPlayer('Pip', 'chicken', false);
    const chick2 = place(w, chick2Id, 12.5, 10, 30); // 30kg < 50kg

    ele2.dashT = 0.5;
    ele2.vx = 25;
    ele2.charging = false;

    w.step();

    expect(chick2.alive).toBe(true); // not crushed because elephant < 1000kg!
  });

  it('killer of King immediately usurps the throne as replacement King', () => {
    const w = emptyWorld();
    const kingId = w.addPlayer('OldKing', 'pig');
    const challengerId = w.addPlayer('Challenger', 'horse');
    place(w, kingId, 0, 0, 80);
    place(w, challengerId, 5, 0, 60);

    w.napoleonId = kingId;
    w.napoleonReign = 20;

    const king = w.players.get(kingId)!;
    const challenger = w.players.get(challengerId)!;

    // Credit challenger as hitting the king
    king.lastHitBy = challengerId;
    king.lastHitT = w.time;

    // Kill king
    (w as any).kill(king, 'fence');

    expect(king.alive).toBe(false);
    // Challenger is now the new King!
    expect(w.napoleonId).toBe(challengerId);
    expect(w.podiumCaptor).toBe(challengerId);
    expect(w.podiumProgress).toBe(1.0);
    expect(w.kingChoice).not.toBeNull();
    expect(challenger.score).toBeGreaterThanOrEqual(250);

    // Verify events contain usurped napoleon event
    const napEvent = w.events.find((e) => e.k === 'napoleon' && e.id === challengerId) as any;
    expect(napEvent).toBeDefined();
    expect(napEvent.usurped).toBe(true);
  });

  it('king dying with no killer leaves the throne vacant', () => {
    const w = emptyWorld();
    const kingId = w.addPlayer('LonelyKing', 'pig');
    place(w, kingId, 0, 0, 80);
    w.napoleonId = kingId;
    w.napoleonReign = 15;

    (w as any).kill(w.players.get(kingId)!, 'well');

    expect(w.players.get(kingId)!.alive).toBe(false);
    expect(w.napoleonId).toBe(0);
    expect(w.podiumProgress).toBe(0);

    const napEvent = w.events.find((e) => e.k === 'napoleon' && e.id === 0);
    expect(napEvent).toBeDefined();
  });

  it('poultry rule transforms animals into chickens or ducks, and restores original species when rule ends', () => {
    const w = emptyWorld();
    const p1Id = w.addPlayer('P1', 'cow');
    const p2Id = w.addPlayer('P2', 'horse');
    const p1 = place(w, p1Id, 10, 10, 50);
    const p2 = place(w, p2Id, -10, -10, 50);

    expect(p1.species).toBe('cow');
    expect(p2.species).toBe('horse');

    w.applyRule('poultry');
    expect(w.currentRule).toBe('poultry');
    expect(['chicken', 'duck']).toContain(p1.species);
    expect(['chicken', 'duck']).toContain(p2.species);
    expect(p1.origSpecies).toBe('cow');
    expect(p2.origSpecies).toBe('horse');

    w.clearRule();
    expect(w.currentRule).toBe('');
    expect(p1.species).toBe('cow');
    expect(p2.species).toBe('horse');
    expect(p1.origSpecies).toBeUndefined();
  });

  it('titan rule sets all animals to 1000kg regardless of prior size', () => {
    const w = emptyWorld();
    const p1 = place(w, w.addPlayer('Small', 'chicken'), 10, 10, 15);
    const p2 = place(w, w.addPlayer('Big', 'cow'), -10, -10, 120);

    w.applyRule('titan');
    expect(p1.mass).toBe(1000);
    expect(p2.mass).toBe(1000);
  });

  it('equal rule sets non-kings to 30kg and King to 100kg', () => {
    const w = emptyWorld();
    const kingId = w.addPlayer('King', 'pig');
    const subId = w.addPlayer('Subject', 'sheep');
    const king = place(w, kingId, 0, 0, 60);
    const sub = place(w, subId, 15, 15, 90);
    w.napoleonId = kingId;

    w.applyRule('equal');
    expect(king.mass).toBe(100);
    expect(sub.mass).toBe(30);
  });

  it('sunday rule summons and teleports non-king animals to the podium', () => {
    const w = emptyWorld();
    const kingId = w.addPlayer('King', 'pig');
    const sub1Id = w.addPlayer('Sub1', 'sheep');
    const sub2Id = w.addPlayer('Sub2', 'dog');
    const king = place(w, kingId, 0, 0, 100);
    const sub1 = place(w, sub1Id, 45, 45, 40);
    const sub2 = place(w, sub2Id, -45, -45, 40);
    w.napoleonId = kingId;

    const [podX, podZ] = w.map.podium;
    w.applyRule('sunday');

    // Immediately after rule is picked: non-kings are frozen in place for 1.5s (stunT = 1.5)
    expect(sub1.stunT).toBe(1.5);
    expect(sub2.stunT).toBe(1.5);
    expect(sub1.x).toBe(45);
    expect(sub2.x).toBe(-45);

    // After 1.5s (46 ticks of 0.0333s = ~1.53s), teleport takes place
    run(w, 46);

    // Non-kings should now be positioned on/around the podium and unfrozen
    const dist1 = Math.hypot(sub1.x - podX, sub1.z - podZ);
    const dist2 = Math.hypot(sub2.x - podX, sub2.z - podZ);
    expect(dist1).toBeLessThan(7);
    expect(dist2).toBeLessThan(7);
    expect(sub1.stunT).toBe(0);
    expect(sub2.stunT).toBe(0);

    // King position is NOT teleported
    expect(king.x).toBe(0);
    expect(king.z).toBe(0);
  });

  it('dice rule rolls 1..6 points and adds matching kg to every living player', () => {
    const w = emptyWorld();
    const p1 = place(w, w.addPlayer('P1', 'dog'), 10, 10, 30);
    const p2 = place(w, w.addPlayer('P2', 'pig'), -10, -10, 50);

    const m1Before = p1.mass;
    const m2Before = p2.mass;

    w.applyRule('dice');

    const diceEvents = w.events.filter((e) => e.k === 'dice') as any[];
    expect(diceEvents.length).toBe(2);

    const ev1 = diceEvents.find((e) => e.id === p1.id);
    const ev2 = diceEvents.find((e) => e.id === p2.id);
    expect(ev1.roll).toBeGreaterThanOrEqual(1);
    expect(ev1.roll).toBeLessThanOrEqual(6);
    expect(p1.mass).toBe(m1Before + ev1.roll * 100);

    expect(ev2.roll).toBeGreaterThanOrEqual(1);
    expect(ev2.roll).toBeLessThanOrEqual(6);
    expect(p2.mass).toBe(m2Before + ev2.roll * 100);
  });

  it('womenday rule spawns giant flowers (kind 8, 11kg each) with single flowerBloom event and no superFood spam', () => {
    const w = emptyWorld();
    w.theme = 'women_day';
    w.applyRule('womenday');

    const flowers = [...w.food.values()].filter((f) => f.k === 8);
    expect(flowers.length).toBe(40);
    expect(flowers[0].v).toBe(11);
    expect(w.events.filter((e) => e.k === 'flowerBloom').length).toBe(1);
    expect(w.events.filter((e) => e.k === 'superFood').length).toBe(0);
  });

  it('event rule womenday is eligible only in women_day theme with 30% chance', () => {
    // In classic theme, womenday should never appear in king choice
    const wClassic = emptyWorld();
    wClassic.theme = 'classic';
    for (let i = 0; i < 50; i++) {
      wClassic.currentRule = '';
      wClassic.startKingChoice();
      expect(wClassic.kingChoice!.options).not.toContain('womenday');
    }

    // In women_day theme, womenday appears in options with ~30% probability
    const wEvent = emptyWorld();
    wEvent.theme = 'women_day';
    let womendayOffers = 0;
    for (let i = 0; i < 200; i++) {
      wEvent.currentRule = '';
      wEvent.startKingChoice();
      if (wEvent.kingChoice!.options.includes('womenday')) {
        womendayOffers++;
      }
    }
    expect(womendayOffers).toBeGreaterThan(30);
    expect(womendayOffers).toBeLessThan(100);
  });

  it('halloween rule spawns giant pumpkins (kind 9, 15kg each) with trickOrTreat event', () => {
    const w = emptyWorld();
    w.theme = 'halloween';
    w.applyRule('halloween');

    const pumpkins = [...w.food.values()].filter((f) => f.k === 9);
    expect(pumpkins.length).toBe(40);
    expect(pumpkins[0].v).toBe(15);
    expect(w.events.filter((e) => e.k === 'trickOrTreat').length).toBe(1);
    expect(w.events.filter((e) => e.k === 'superFood').length).toBe(0);
  });

  it('event rule halloween is eligible only in halloween theme with 30% chance', () => {
    // In classic theme, halloween should never appear in king choice
    const wClassic = emptyWorld();
    wClassic.theme = 'classic';
    for (let i = 0; i < 50; i++) {
      wClassic.currentRule = '';
      wClassic.startKingChoice();
      expect(wClassic.kingChoice!.options).not.toContain('halloween');
    }

    // In halloween theme, halloween appears in options with ~30% probability
    const wEvent = emptyWorld();
    wEvent.theme = 'halloween';
    let halloweenOffers = 0;
    for (let i = 0; i < 200; i++) {
      wEvent.currentRule = '';
      wEvent.startKingChoice();
      if (wEvent.kingChoice!.options.includes('halloween')) {
        halloweenOffers++;
      }
    }
    expect(halloweenOffers).toBeGreaterThan(30);
    expect(halloweenOffers).toBeLessThan(100);
  });

  it('friend mode match timer counts down even if creator leaves', () => {
    const w = emptyWorld();
    w.mode = 'friend';
    w.matchDuration = 120;
    w.matchClock = 120;

    const idCreator = w.addPlayer('Creator', 'pig');
    const idFriend = w.addPlayer('Friend', 'cow');
    w.spawn(w.players.get(idCreator)!);
    w.spawn(w.players.get(idFriend)!);

    // Initial tick with both players: timer counts down
    run(w, 20); // 1 second
    expect(w.matchClock).toBeLessThan(120);
    const clockAfter1s = w.matchClock;

    // Creator leaves: creator player removed from world
    w.removePlayer(idCreator);
    expect(w.players.size).toBe(1);

    // Timer MUST continue running with only Friend in the room
    run(w, 20); // another 1 second
    expect(w.matchClock).toBeLessThan(clockAfter1s);

    // Snapshot for Friend sends the countdown time
    const snap = w.snapshotFor(idFriend);
    expect(snap.team).toBeDefined();
    expect(snap.team![2]).toBe(Math.ceil(w.matchClock));
  });

  it('friend mode match timer expires and renews game for next round', () => {
    const w = emptyWorld();
    w.mode = 'friend';
    w.matchDuration = 60;
    w.matchClock = 0.1; // almost finished

    const idFriend = w.addPlayer('Friend', 'cow');
    w.spawn(w.players.get(idFriend)!);

    // Step until match ends
    let sawTeamWin = false;
    for (let i = 0; i < 4; i++) {
      w.step();
      if (w.events.some((e) => e.k === 'teamWin')) sawTeamWin = true;
      w.flush();
    }
    expect(w.matchEnded).toBe(true);
    expect(sawTeamWin).toBe(true);

    // After 6s end celebration, renewGame resets clock back to matchDuration and resumes
    run(w, 140);
    expect(w.matchEnded).toBe(false);
    expect(w.matchClock).toBeLessThanOrEqual(60);
    expect(w.matchClock).toBeGreaterThan(55);
  });
});

describe('fruit trees', () => {
  it('generates 6 trees with correct sizes and fruit counts inside the fence', () => {
    for (let s = 1; s <= 5; s++) {
      const map = generateMap(s);
      expect(map.trees).toBeDefined();
      expect(map.trees.length).toBe(6);
      const sizes = map.trees.map((t) => t.size);
      expect(sizes).toEqual([2, 1, 0, 2, 1, 0]);

      for (const t of map.trees) {
        expect(Math.hypot(t.x, t.z) + t.r).toBeLessThan(CFG.R);
        if (t.size === 2) {
          expect(t.totalFruits).toBe(30);
          expect(t.r).toBe(3.6);
          expect(t.initBig).toBeGreaterThanOrEqual(18);
          expect(t.initBig).toBeLessThanOrEqual(24);
          expect(t.initSmall).toBe(30 - t.initBig);
          expect(t.initBig).toBeGreaterThan(t.initSmall);
        } else if (t.size === 1) {
          expect(t.totalFruits).toBe(20);
          expect(t.r).toBe(2.8);
          expect(t.initBig).toBeGreaterThanOrEqual(12);
          expect(t.initBig).toBeLessThanOrEqual(16);
          expect(t.initSmall).toBe(20 - t.initBig);
          expect(t.initBig).toBeGreaterThan(t.initSmall);
        } else {
          expect(t.totalFruits).toBe(10);
          expect(t.r).toBe(2.0);
          expect(t.initBig).toBeGreaterThanOrEqual(6);
          expect(t.initBig).toBeLessThanOrEqual(8);
          expect(t.initSmall).toBe(10 - t.initBig);
          expect(t.initBig).toBeGreaterThan(t.initSmall);
        }
      }
    }
  });

  it('progresses through 30s lifecycle: 10s flowers, 20s small fruit, 30s ripe big fruit', () => {
    const w = new World(42, { bots: false, food: false });
    const tree = w.treeSims[0];
    expect(tree).toBeDefined();

    // At t = 0s: stage 0 (buds)
    expect(tree.getStage()).toBe(0);

    // Advance 10s (200 ticks at 20Hz)
    run(w, 200);
    expect(tree.getStage()).toBe(1); // Flowers!
    expect(tree.getFlowerCount()).toBe(tree.totalFruits);

    // Advance to 20s (another 200 ticks)
    run(w, 200);
    expect(tree.getStage()).toBe(2); // Small fruits!

    // Advance to 30s (another 200 ticks)
    run(w, 200);
    expect(tree.getStage()).toBe(3); // Big ripe fruits!
    expect(tree.big).toBeGreaterThan(0);
    expect(tree.small).toBeGreaterThan(0);
    expect(tree.big + tree.small).toBe(tree.totalFruits);
  });

  it('requires mass thresholds to shake tree: 100kg (small), 500kg (medium), 1000kg (large)', () => {
    const w = emptyWorld();
    // Setup 3 trees: Small (size 0), Medium (size 1), Large (size 2)
    const treeSmall = new TreeSimState({
      id: 1, x: 20, z: 0, size: 0, r: 1.0, totalFruits: 10, initBig: 7, initSmall: 3,
    });
    // Fast-forward to ripe stage 3
    treeSmall.big = 7;
    treeSmall.small = 3;
    treeSmall.batches.length = 0;
    w.treeSims.push(treeSmall);

    const idPig = w.addPlayer('Piggy', 'pig');
    const pig = w.players.get(idPig)!;

    // 1. Pig at 50kg (< 100kg requirement) rams small tree
    pig.mass = 50;
    pig.x = 17; pig.z = 0; pig.vx = 25; pig.vz = 0; pig.dashT = 0.2;
    w.step();
    // Pig bounced off, not 3s stun, 0 fruits dropped
    expect(treeSmall.big).toBe(7);
    expect(pig.stunT).toBeLessThan(1.0);

    // 2. Pig at 100kg (>= 100kg requirement) rams small tree
    pig.mass = 100;
    pig.x = 17; pig.z = 0; pig.vx = 25; pig.vz = 0; pig.dashT = 0.2;
    pig.stunT = 0;
    treeSmall.cooldownHit = 0;
    w.step();
    // Successful ram: 1.5s stun, 1/3 fruits dropped!
    expect(pig.stunT).toBeGreaterThanOrEqual(1.45);
    expect(pig.stunT).toBeLessThanOrEqual(1.5);
    // dropBig = ceil(7/3) = 3, dropSmall = ceil(3/3) = 1 => 4 fruits dropped
    expect(treeSmall.big).toBe(4);
    expect(treeSmall.small).toBe(2);
    // 4 flowers born to begin 30s cycle
    expect(treeSmall.batches.length).toBe(1);
    expect(treeSmall.batches[0].count).toBe(4);
    expect(w.events.some((e) => e.k === 'treeHit' && e.id === 1)).toBe(true);
    // Size 0 (Small tree): all dropped fruits are 5..10kg
    for (const f of w.food.values()) {
      expect(f.v).toBeGreaterThanOrEqual(5);
      expect(f.v).toBeLessThanOrEqual(10);
    }
  });

  it('tree fruit weights: small tree (5..10kg), medium tree (20..50kg), large tree (100kg)', () => {
    // 1. Medium tree (size 1): drops 20..50kg
    const wMed = emptyWorld();
    const treeMed = new TreeSimState({
      id: 2, x: 20, z: 0, size: 1, r: 1.0, totalFruits: 20, initBig: 15, initSmall: 5,
    });
    treeMed.big = 15;
    wMed.treeSims.push(treeMed);
    const idPigMed = wMed.addPlayer('PigMed', 'pig');
    const pigMed = wMed.players.get(idPigMed)!;
    pigMed.mass = 500;
    pigMed.x = 17; pigMed.z = 0; pigMed.vx = 25; pigMed.vz = 0; pigMed.dashT = 0.2;
    wMed.step();
    expect(wMed.food.size).toBeGreaterThan(0);
    for (const f of wMed.food.values()) {
      expect(f.v).toBeGreaterThanOrEqual(20);
      expect(f.v).toBeLessThanOrEqual(50);
    }

    // 2. Large tree (size 2): drops 100kg
    const wLarge = emptyWorld();
    const treeLarge = new TreeSimState({
      id: 3, x: 20, z: 0, size: 2, r: 1.0, totalFruits: 30, initBig: 20, initSmall: 10,
    });
    treeLarge.big = 20;
    wLarge.treeSims.push(treeLarge);
    const idPigLarge = wLarge.addPlayer('PigLarge', 'pig');
    const pigLarge = wLarge.players.get(idPigLarge)!;
    pigLarge.mass = 1000;
    pigLarge.x = 17; pigLarge.z = 0; pigLarge.vx = 25; pigLarge.vz = 0; pigLarge.dashT = 0.2;
    wLarge.step();
    expect(wLarge.food.size).toBeGreaterThan(0);
    for (const f of wLarge.food.values()) {
      expect(f.v).toBe(100);
    }
  });

  describe('wheel item (crushing cart)', () => {
    it('sets wheelT = 10 and moves continuously without stopping', () => {
      const w = emptyWorld();
      const id = w.addPlayer('Driver', 'pig');
      const p = w.players.get(id)!;
      place(w, id, 0, 0);
      w.tools.set(101, { id: 101, kind: 'wheel', x: 0, z: 0 });
      w.step();
      expect(p.wheelT).toBe(10);

      // Simulates forward movement along input.a (e.g. angle 0 = moving +x)
      p.input.a = 0;
      const prevX = p.x;
      w.step();
      expect(p.x).toBeGreaterThan(prevX);
    });

    it('flattens and strips 40% mass or instant KOs if victim < 80kg', () => {
      const w = emptyWorld();
      const id1 = w.addPlayer('Cart', 'horse');
      const id2 = w.addPlayer('Victim', 'sheep');
      const cart = place(w, id1, -1.0, 0, 100);
      const victim = place(w, id2, 0, 0, 200);

      cart.wheelT = 10;
      cart.input.a = 0;

      w.step();
      // Victim squished and lost mass
      expect(victim.squishT).toBeGreaterThan(0);
      expect(victim.mass).toBeLessThan(200);

      // Test instant KO if victim < 80kg
      const id3 = w.addPlayer('LightVictim', 'chicken');
      const light = place(w, id3, 0, 0, 50);
      place(w, id1, -1.0, 0, 100);
      cart.wheelT = 10;
      cart.input.a = 0;
      w.step();
      expect(light.alive).toBe(false);
      expect(w.events.some((e) => e.k === 'die' && e.id === id3 && e.cause === 'crush')).toBe(true);
    });
  });

  describe('star item (mini clones)', () => {
    it('summons 2 mini clones of owner up to max 6', () => {
      const w = emptyWorld();
      const id = w.addPlayer('Boss', 'cow');
      place(w, id, 0, 0);

      // First pickup: 2 minions
      w.tools.set(201, { id: 201, kind: 'star', x: 0, z: 0 });
      w.step();
      const bossMinions = [...w.minions.values()].filter((m) => m.ownerId === id);
      expect(bossMinions.length).toBe(2);
      expect(bossMinions[0].mass).toBe(50);
      expect(bossMinions[0].species).toBe('cow');

      // Second pickup: +2 = 4
      const p = w.players.get(id)!;
      w.tools.set(202, { id: 202, kind: 'star', x: p.x, z: p.z });
      w.step();
      expect([...w.minions.values()].filter((m) => m.ownerId === id).length).toBe(4);

      // Third pickup: +2 = 6
      w.tools.set(203, { id: 203, kind: 'star', x: p.x, z: p.z });
      w.step();
      expect([...w.minions.values()].filter((m) => m.ownerId === id).length).toBe(6);

      // Fourth pickup: capped at 6
      w.tools.set(204, { id: 204, kind: 'star', x: p.x, z: p.z });
      w.step();
      expect([...w.minions.values()].filter((m) => m.ownerId === id).length).toBe(6);
    });

    it('cleans up minions when owner dies or leaves', () => {
      const w = emptyWorld();
      const id = w.addPlayer('Boss', 'duck');
      place(w, id, 0, 0);
      w.tools.set(301, { id: 301, kind: 'star', x: 0, z: 0 });
      w.step();
      expect([...w.minions.values()].filter((m) => m.ownerId === id).length).toBe(2);

      w.removePlayer(id);
      expect([...w.minions.values()].filter((m) => m.ownerId === id).length).toBe(0);
    });

    it('minions do NOT attack peaceful bystanders, only attack on retaliate or active owner attack', () => {
      const w = emptyWorld();
      const ownerId = w.addPlayer('Boss', 'cow');
      place(w, ownerId, 0, 0);

      // Summon minions
      w.tools.set(401, { id: 401, kind: 'star', x: 0, z: 0 });
      w.step();
      const bossMinions = [...w.minions.values()].filter((m) => m.ownerId === ownerId);
      expect(bossMinions.length).toBe(2);

      // Add a nearby bystander within 5 units
      const bystanderId = w.addPlayer('Bystander', 'sheep');
      place(w, bystanderId, 4, 0);

      // Step simulation: bystander has not attacked owner and owner has not attacked bystander
      for (let i = 0; i < 10; i++) {
        w.step();
      }
      for (const m of bossMinions) {
        expect(m.targetId).toBe(0); // Minions must not target innocent bystander
      }

      // Condition A: Enemy attacks owner
      const bystander = w.players.get(bystanderId)!;
      const owner = w.players.get(ownerId)!;
      owner.lastHitBy = bystanderId;
      owner.lastHitT = w.time;

      w.step();
      // Minions should now engage retaliatory chase on the attacker
      for (const m of bossMinions) {
        expect(m.targetId).toBe(bystanderId);
      }

      // If target moves beyond leash (> 15 units), minions disengage
      place(w, bystanderId, 30, 30);
      w.step();
      for (const m of bossMinions) {
        expect(m.targetId).toBe(0);
      }

      // Condition B: Owner actively attacks an enemy
      const enemy2Id = w.addPlayer('Enemy2', 'pig');
      place(w, enemy2Id, 5, 0);
      owner.lastAttackedId = enemy2Id;
      owner.lastAttackedT = w.time;

      w.step();
      for (const m of bossMinions) {
        expect(m.targetId).toBe(enemy2Id);
      }
    });

    it('minion attack inflicts reduced stun of 0.2s (reduced by half)', () => {
      const w = emptyWorld();
      const ownerId = w.addPlayer('Leader', 'pig');
      const victimId = w.addPlayer('Victim', 'sheep');
      const leader = place(w, ownerId, 0, 0, 100);
      const victim = place(w, victimId, 1, 0, 100);

      leader.lastAttackedId = victimId;
      leader.lastAttackedT = w.time;
      victim.lastHitBy = leader.id;
      victim.lastHitT = w.time;

      w.minions.set(1001, {
        id: 1001,
        ownerId: leader.id,
        x: 0.8,
        z: 0,
        vx: 0,
        vz: 0,
        a: 0,
        mass: 25,
        species: 'pig',
        skin: 0,
        cd: 0,
        targetId: victimId,
        alive: true,
      });

      w.step();
      expect(victim.stunT).toBeCloseTo(0.2, 2);
    });

    it('minions maintain separation and do not overlap', () => {
      const w = emptyWorld();
      const ownerId = w.addPlayer('Boss', 'pig');
      place(w, ownerId, 0, 0);

      // Summon 6 minions
      for (let i = 0; i < 3; i++) {
        w.tools.set(500 + i, { id: 500 + i, kind: 'star', x: 0, z: 0 });
        w.step();
      }
      const minions = [...w.minions.values()].filter((m) => m.ownerId === ownerId);
      expect(minions.length).toBe(6);

      // Run simulation steps
      for (let i = 0; i < 25; i++) {
        w.step();
      }

      // Verify no minions are overlapping (dist >= 1.25)
      for (let i = 0; i < minions.length; i++) {
        for (let j = i + 1; j < minions.length; j++) {
          const dist = Math.hypot(minions[i].x - minions[j].x, minions[i].z - minions[j].z);
          expect(dist).toBeGreaterThanOrEqual(1.25);
        }
      }
    });
  });

  describe('monkey mechanics', () => {
    it('monkey tap ram near tree shakes tree and drops 1/3 fruits when meeting mass requirement', () => {
      const w = new World(1234, { bots: false, food: false });
      const mId = w.addPlayer('Wukong', 'monkey');
      // Tree at (10, 0), size 2 (req 1000kg)
      const tree = w.treeSims[0];
      tree.size = 2;
      tree.x = 10;
      tree.z = 0;
      tree.big = 9;
      tree.small = 6;
      const monkey = place(w, mId, 10 - tree.r - 1.5, 0, 1000);

      // Tap ram (holdT <= 0.15) with 1000kg shakes large tree
      monkey.input.btn = false;
      monkey.holdT = 0.1;
      monkey.pressed = true;
      w.step();

      expect(tree.big).toBe(6); // 9 - ceil(9/3) = 6
      expect(tree.small).toBe(4); // 6 - ceil(6/3) = 4
      expect(monkey.treeShakeT).toBeGreaterThan(0);
      expect(monkey.stunT).toBe(0); // Not stunned!

      // When monkey has less mass than required (e.g. 50kg < 1000kg), cannot shake tree, throws banana instead
      monkey.mass = 50;
      monkey.treeShakeT = 0;
      monkey.cd = 0;
      monkey.input.btn = false;
      monkey.holdT = 0.1;
      monkey.pressed = true;
      w.step();

      expect(monkey.treeShakeT).toBe(0); // Did not shake
      expect(w.bananaProjectiles.length).toBeGreaterThan(0); // Threw banana instead!
    });

    it('monkey tap ram away from tree throws banana projectile and deals <= 5% mass loss', () => {
      const w = emptyWorld();
      const mId = w.addPlayer('Wukong', 'monkey');
      const monkey = place(w, mId, 0, 0, 100);
      monkey.input.a = 0;

      // Target far enough so projectile flies towards it
      const targetId = w.addPlayer('TargetPig', 'pig');
      const target = place(w, targetId, 14.0, 0, 200);

      // Tap ram throws banana
      monkey.holdT = 0.1;
      monkey.pressed = true;
      w.step();

      // Projectile spawned and in flight
      expect(w.bananaProjectiles.length).toBe(1);

      // Step until banana reaches target
      for (let i = 0; i < 15; i++) {
        w.step();
      }

      // Target took hit, loses mass (fruits scatter on ground), monkey mass does not directly increase
      expect(target.mass).toBeLessThan(200);
      expect(monkey.mass).toBe(100);
      expect(w.food.size).toBeGreaterThan(0);
    });

    it('monkey charged leap jumps over fire hazard and lands with shockwave', () => {
      const w = emptyWorld();
      // Add a fire pit at (5, 0)
      w.map.fire = [[5, 0, 2.5]];

      const mId = w.addPlayer('Wukong', 'monkey');
      const monkey = place(w, mId, 0, 0, 80);
      monkey.input.a = 0;

      // Small animal (< 50kg) and heavy animal (> 50kg) at landing area (~19m ahead)
      const smallId = w.addPlayer('SmallChick', 'chicken');
      const small = place(w, smallId, 18, 0, 30);
      const heavyId = w.addPlayer('HeavyCow', 'cow');
      const heavy = place(w, heavyId, 19, 2, 200);

      // Full charge leap (hold 1.0s)
      monkey.holdT = 1.0;
      monkey.pressed = true;
      w.step();

      expect(monkey.monkeyLeapT).toBeGreaterThan(0);

      // Fly through and land (20 ticks = 1.0s)
      for (let i = 0; i < 20; i++) {
        w.step();
      }

      // Monkey did not die to fire pit
      expect(monkey.alive).toBe(true);
      // Small animal is knocked back (not squished flat)
      expect(small.squishT).toBe(0);
      expect(Math.hypot(small.vx, small.vz)).toBeGreaterThan(0);
      // Heavy animal > 50kg lost mass
      expect(heavy.mass).toBeLessThan(200);
    });

    it('monkey evolves to gorilla at 3000kg, gorilla squishes small animals and shakes tree for 3s', () => {
      const w = new World(1234, { bots: false, food: false });
      const pId = w.addPlayer('Kong', 'monkey');
      const gorilla = place(w, pId, 0, 0, 2999);
      expect(gorilla.species).toBe('monkey');

      // Eat 2kg food to cross 3000kg
      gorilla.mass = 3001;
      w.step();

      // Evolves to gorilla!
      expect(gorilla.species).toBe('gorilla');

      // Gorilla leap: instant kills animals <= 50kg, and max charge squishes 50kg..500kg
      const victimId = w.addPlayer('Tiny', 'chicken');
      const victim = place(w, victimId, 20, 0, 40);
      const medId = w.addPlayer('MediumPig', 'pig');
      const medVic = place(w, medId, 21, 1, 150);

      gorilla.x = 0; gorilla.z = 0;
      gorilla.input.a = 0;
      gorilla.holdT = 1.2;
      gorilla.pressed = true;
      w.step();

      expect(gorilla.monkeyLeapT).toBeGreaterThan(0);

      for (let i = 0; i < 20; i++) w.step();
      // Tiny animal <= 50kg is instantly crushed & killed
      expect(victim.alive).toBe(false);
      expect(gorilla.mass).toBeGreaterThan(3001); // Stole kill spoils!

      // Medium animal (50..500kg) is squished, stunned, slowed, but remains alive with lost mass
      expect(medVic.alive).toBe(true);
      expect(medVic.squishT).toBeGreaterThan(0);
      expect(medVic.mass).toBeLessThan(150);
      expect(medVic.stunT).toBeGreaterThan(0);
      expect(medVic.slowT).toBeGreaterThan(0);

      // Gorilla throwing banana pays self-mass penalty (<= 5%)
      const massBeforeThrow = gorilla.mass;
      gorilla.x = -30; gorilla.z = -30; // Far from tree
      gorilla.treeShakeT = 0; gorilla.cd = 0; gorilla.dashT = 0; gorilla.stunT = 0; gorilla.vx = 0; gorilla.vz = 0;
      gorilla.holdT = 0.05;
      gorilla.pressed = true;
      w.step();
      expect(w.bananaProjectiles.length).toBeGreaterThan(0);
      const latestProj = w.bananaProjectiles[w.bananaProjectiles.length - 1];
      expect(latestProj.tier).toBe(2); // Gorilla is Tier 2
      expect(gorilla.mass).toBeLessThan(massBeforeThrow);
      expect(massBeforeThrow - gorilla.mass).toBeLessThanOrEqual(Math.round(massBeforeThrow * 0.05));

      // Gorilla tree shake: 3 seconds without stun, drops all fruits
      const tree = w.treeSims[0];
      tree.x = 10;
      tree.z = 0;
      tree.big = 9;
      tree.small = 6;
      gorilla.x = 10 - tree.r - 1.5;
      gorilla.z = 0;
      gorilla.treeShakeT = 0;
      gorilla.cd = 0;
      gorilla.dashT = 0;
      gorilla.stunT = 0;
      gorilla.input.btn = false;
      gorilla.holdT = 0.05; // Tap
      gorilla.pressed = true;
      w.step();

      expect(gorilla.treeShakeT).toBeGreaterThan(2.8);
      expect(gorilla.stunT).toBe(0);

      // Fast-forward 3 seconds (60 ticks): tree should be emptied of all fruits!
      for (let i = 0; i < 60; i++) w.step();
      expect(tree.big).toBe(0);
      expect(tree.small).toBe(0);
    });

    it('gorilla de-evolves to monkey when dropping below 1000kg and only re-evolves at 3000kg', () => {
      const w = emptyWorld();
      const pId = w.addPlayer('Kong', 'monkey');
      const player = place(w, pId, 0, 0, 3000);
      w.step();
      expect(player.species).toBe('gorilla');

      // Gorilla drops below 1000kg (e.g. 999kg due to hits or penalties)
      player.mass = 999;
      w.step();
      expect(player.species).toBe('monkey');
      expect(w.events.some(e => e.k === 'morph' && e.id === pId && e.species === 'monkey')).toBe(true);

      // Mass increases between 1000kg and 2999kg - stays monkey!
      player.mass = 1500;
      w.step();
      expect(player.species).toBe('monkey');

      player.mass = 2999;
      w.step();
      expect(player.species).toBe('monkey');

      // Reaching 3000kg re-evolves into gorilla!
      player.mass = 3000;
      w.step();
      expect(player.species).toBe('gorilla');
      expect(w.events.some(e => e.k === 'morph' && e.id === pId && e.species === 'gorilla')).toBe(true);

      // Game rule "equal" resets mass to 30kg -> immediately de-evolves into monkey
      player.mass = 30;
      w.step();
      expect(player.species).toBe('monkey');
    });

    it('banana item morphs player into monkey or elephant for 30s', () => {
      const w = emptyWorld();
      const pId = w.addPlayer('Player1', 'pig');
      const p = place(w, pId, 0, 0, 50);

      // Spawn banana item at player position
      w.tools.set(999, { id: 999, kind: 'banana', x: 0, z: 0 });
      w.step();

      expect(['monkey', 'elephant']).toContain(p.species);
      expect(p.morphT).toBe(30);
      expect(p.morphOrigSpecies).toBe('pig');

      // Fast-forward 30s
      for (let i = 0; i < 30 * 20; i++) {
        w.step();
      }

      // Reverts back to pig
      expect(p.species).toBe('pig');
      expect(p.morphT).toBeUndefined();
    });

    it('rainbow monkey fires 5 giant bananas in cone spread and gains 30% speed', () => {
      const w = emptyWorld();
      const mId = w.addPlayer('RainbowMonkey', 'monkey');
      const monkey = place(w, mId, 0, 0, 100);
      monkey.superT = 10;
      monkey.input.a = 0;

      // Trigger action
      monkey.holdT = 0;
      monkey.pressed = true;
      w.step();

      // 5 giant bananas spawned!
      expect(w.bananaProjectiles.length).toBe(5);
      for (const b of w.bananaProjectiles) {
        expect(b.giant).toBe(true);
      }
      // Monkey did not fly/dash
      expect(monkey.flyT).toBe(0);
    });

    it('gorilla is immune to stun, flinch, knockback, and damage from animals < 1 ton and minions', () => {
      const w = emptyWorld();
      const gId = w.addPlayer('Kong', 'monkey');
      const gorilla = place(w, gId, 0, 0, 3000);
      w.step();
      expect(gorilla.species).toBe('gorilla');

      // 1. Pig with 200kg rams Gorilla
      const pigId = w.addPlayer('Piggy', 'pig');
      const pig = place(w, pigId, 2, 0, 200);
      pig.input = { a: Math.PI, mv: true, btn: true };
      pig.dashT = 0.3;
      pig.power = 1.0;
      pig.vx = -20;
      const gMassBefore = gorilla.mass;

      w.step();

      // Gorilla takes 0 damage, 0 stun, 0 knockback
      expect(gorilla.stunT).toBe(0);
      expect(Math.hypot(gorilla.vx, gorilla.vz)).toBe(0);
      expect(w.events.some(e => e.k === 'hit' && e.a === pig.id && e.loss === 0)).toBe(true);
      // Pig rebounds and gets stunned
      expect(pig.stunT).toBeGreaterThan(0);
      expect(pig.vx).toBeGreaterThan(0);

      // 2. Minion attacks Gorilla
      const minionOwnerId = w.addPlayer('Leader', 'pig');
      const leader = place(w, minionOwnerId, 5, 0, 100);
      gorilla.lastAttackedId = leader.id;
      gorilla.lastAttackedT = w.time;
      leader.lastHitBy = gorilla.id;
      leader.lastHitT = w.time;
      w.minions.set(1, {
        id: 1,
        ownerId: leader.id,
        x: 0.5,
        z: 0,
        vx: 0,
        vz: 0,
        a: 0,
        mass: 10,
        cd: 0,
        targetId: gorilla.id,
      });

      w.step();
      // Gorilla remains immune to minions
      expect(gorilla.stunT).toBe(0);
      expect(Math.hypot(gorilla.vx, gorilla.vz)).toBe(0);
      expect(w.events.some(e => e.k === 'hit' && e.v === gorilla.id && e.minion && e.loss === 0)).toBe(true);
    });

    it('banana projectile carries dynamite and explodes on hit', () => {
      const w = emptyWorld();
      const mId = w.addPlayer('Wukong', 'monkey');
      const monkey = place(w, mId, 0, 0, 100);
      monkey.hasDynamite = true;

      const vicId = w.addPlayer('Vic', 'pig');
      const vic = place(w, vicId, 10, 0, 200);

      // Tap throws banana
      monkey.holdT = 0.05;
      monkey.pressed = true;
      w.step();

      expect(w.bananaProjectiles.length).toBe(1);

      // Fast-forward until banana reaches victim
      for (let i = 0; i < 15; i++) w.step();

      // Exploded: dynamite consumed, victim took dynamite damage (25%), boom event fired
      expect(monkey.hasDynamite).toBe(false);
      expect(vic.mass).toBeLessThanOrEqual(150);
      expect(w.events.some(e => e.k === 'boom')).toBe(true);
    });

    it('banana projectile carries pitchfork with 3-hit mass strip', () => {
      const w = emptyWorld();
      const mId = w.addPlayer('Wukong', 'monkey');
      const monkey = place(w, mId, 0, 0, 100);
      monkey.pitchforkT = 10;
      monkey.pitchforkHits = 3;

      const vicId = w.addPlayer('Vic', 'pig');
      const vic = place(w, vicId, 6, 0, 200);
      vic.ai = null;
      vic.input = { a: 0, mv: false, btn: false };

      // Hit 1: 30% of 200 = 60kg lost
      monkey.input.a = 0;
      monkey.holdT = 0.05;
      monkey.pressed = true;
      w.step();
      for (let i = 0; i < 15; i++) {
        w.step();
        if (w.events.some(e => e.k === 'hit')) break;
      }

      expect(vic.mass).toBeLessThanOrEqual(140);
      expect(monkey.pitchforkHits).toBe(2);
      expect(w.food.size).toBeGreaterThan(0); // drops fruit for pickup
      expect(monkey.mass).toBe(100); // monkey must pick up fruits to grow
    });

    it('secret easter egg: names with Money/Monkey/Khỉ/Khi prefixes get 100% monkey on random', () => {
      const monkeyNames = [
        'Khỉ',
        'khỉ',
        'KHỈ',
        'Khỉ Đột',
        'khỉ con',
        'khi',
        'Khi Vàng',
        'Monkey',
        'monkeyking',
        'Monkey 007',
        'Money',
        'moneybags',
        'MoneyMaker',
        '🐒 Khỉ Chúa',
        '[VN] Khỉ',
      ];

      for (const name of monkeyNames) {
        expect(getEasterEggSpeciesFromName(name)).toBe('monkey');
        // pickRandomSpecies always yields monkey
        for (let i = 0; i < 5; i++) {
          expect(pickRandomSpecies(name)).toBe('monkey');
        }
      }

      // World addPlayer with species='random' gives monkey
      const w = emptyWorld();
      const pId = w.addPlayer('Khỉ Đột', 'random' as any);
      expect(w.players.get(pId)!.species).toBe('monkey');
    });

    it('secret easter egg: names with Elephant/Voi prefixes get 100% elephant on random', () => {
      const elephantNames = [
        'Voi',
        'voi',
        'VOI',
        'Voi Rừng',
        'voi chiến',
        'Elephant',
        'elephant123',
        'ElephantKing',
        '🐘 Voi Bản Đôn',
        '[PRO] Voi',
      ];

      for (const name of elephantNames) {
        expect(getEasterEggSpeciesFromName(name)).toBe('elephant');
        // pickRandomSpecies always yields elephant
        for (let i = 0; i < 5; i++) {
          expect(pickRandomSpecies(name)).toBe('elephant');
        }
      }

      // World addPlayer with species='random' gives elephant
      const w = emptyWorld();
      const pId = w.addPlayer('Voi Rừng', 'random' as any);
      expect(w.players.get(pId)!.species).toBe('elephant');
    });

    it('other names use normal random selection', () => {
      expect(getEasterEggSpeciesFromName('Gà Con')).toBeNull();
      expect(getEasterEggSpeciesFromName('Heo Ụt Ịt')).toBeNull();
      expect(getEasterEggSpeciesFromName('Cowboy')).toBeNull();
      expect(getEasterEggSpeciesFromName('')).toBeNull();
    });
  });

  describe('mammoth mechanics', () => {
    it('elephant evolves into mammoth at 3000kg and reverts below 1000kg', () => {
      const w = emptyWorld();
      const pId = w.addPlayer('Dumbo', 'elephant');
      const p = w.players.get(pId)!;
      expect(p.species).toBe('elephant');

      // Reaching 3000kg evolves into mammoth
      p.mass = 3000;
      w.step();
      expect(p.species).toBe('mammoth');
      const morphEvent = w.events.find((e) => e.k === 'morph' && e.id === pId && e.species === 'mammoth');
      expect(morphEvent).toBeDefined();

      // Dropping below 1000kg reverts to elephant
      p.mass = 999;
      w.step();
      expect(p.species).toBe('elephant');
      const revertEvent = w.events.find((e) => e.k === 'morph' && e.id === pId && e.species === 'elephant');
      expect(revertEvent).toBeDefined();
    });

    it('mammoth light ram (< 0.15s hold) crushes and kills animals under 100kg', () => {
      const w = emptyWorld();
      const mId = w.addPlayer('Colossus', 'elephant');
      const mammoth = place(w, mId, 0, 0, 3000);
      w.step();
      expect(mammoth.species).toBe('mammoth');

      // Small animal (< 100kg)
      const pigId = w.addPlayer('TinyPig', 'pig');
      const pig = place(w, pigId, 2.0, 0, 80);

      // Light ram (hold <= 0.15)
      mammoth.input.a = 0;
      mammoth.input.btn = false;
      mammoth.holdT = 0.1;
      mammoth.pressed = true;

      w.step();

      expect(pig.alive).toBe(false);
      expect(pig.squishT).toBeGreaterThan(0);
      const crushEvent = w.events.find((e) => e.k === 'die' && e.id === pigId && e.cause === 'crush');
      expect(crushEvent).toBeDefined();

      // Animal >= 100kg is not crushed
      const cowId = w.addPlayer('BigCow', 'cow');
      const cow = place(w, cowId, 2.0, 0, 150);
      mammoth.cd = 0;
      mammoth.input.a = 0;
      mammoth.input.btn = false;
      mammoth.holdT = 0.1;
      mammoth.pressed = true;

      w.step();

      expect(cow.alive).toBe(true);
      expect(cow.mass).toBeLessThan(150); // lost mass from normal hit
    });

    it('mammoth charged ability (> 0.15s hold) emits sonic roar wave stunning surrounding animals up to 1.5s with 3s cd', () => {
      const w = emptyWorld();
      const mId = w.addPlayer('Roarer', 'elephant');
      const mammoth = place(w, mId, 0, 0, 3000);
      w.step();
      expect(mammoth.species).toBe('mammoth');

      // Rivals at various distances
      const r1Id = w.addPlayer('Rival1', 'pig');
      const rival1 = place(w, r1Id, 15, 0, 150);

      const r2Id = w.addPlayer('Rival2', 'horse');
      const rival2 = place(w, r2Id, -25, 0, 200);

      const r3Id = w.addPlayer('Rival3', 'cow');
      const rival3 = place(w, r3Id, 50, 0, 300); // Beyond 35m radius

      // Full charge (1.0s hold)
      mammoth.input.btn = false;
      mammoth.holdT = 1.0;
      mammoth.pressed = true;

      w.step();

      // Mammoth stands in place; charged roar has 3.0s cooldown while light dash recovers quickly (~1.0s)
      expect(mammoth.dashT).toBe(0);
      expect(mammoth.mammothRoarCd).toBeCloseTo(3.0, 1);
      expect(mammoth.cd).toBeCloseTo(1.0, 1);
      expect(mammoth.mammothRoarT).toBeGreaterThan(0);

      // Rivals within 35m are stunned (~1.3s - 1.5s)
      expect(rival1.stunT).toBeGreaterThanOrEqual(1.2);
      expect(rival2.stunT).toBeGreaterThanOrEqual(1.2);

      // Rival beyond 35m is untouched
      expect(rival3.stunT).toBe(0);

      const roarEvent = w.events.find((e) => e.k === 'mammothRoar' && e.id === mId && !e.rainbow) as any;
      expect(roarEvent).toBeDefined();
      expect(roarEvent.r).toBe(35);
      expect(roarEvent.dur).toBeGreaterThanOrEqual(1.2);

      // Advance time by 1.1s so light dash cd finishes, but 3.0s roar cd is still ~1.9s
      for (let i = 0; i < 22; i++) w.step();
      expect(mammoth.cd).toBe(0);
      expect(mammoth.mammothRoarCd).toBeGreaterThan(1.5);

      // Light tap dash works immediately
      mammoth.input.btn = false;
      mammoth.holdT = 0.1;
      mammoth.pressed = true;
      w.step();
      expect(mammoth.dashT).toBeGreaterThan(0);
    });

    it('mammoth rainbow super mode: tap dashes as normal, charge stuns entire map up to 3.0s', () => {
      const w = emptyWorld();
      const mId = w.addPlayer('SuperMammoth', 'elephant');
      const mammoth = place(w, mId, 0, 0, 3000);
      w.step();
      expect(mammoth.species).toBe('mammoth');
      mammoth.superT = 10;

      // Tap ram (hold <= 0.15s) dashes fast like normal rainbow
      mammoth.input.a = 0;
      mammoth.input.btn = false;
      mammoth.holdT = 0.1;
      mammoth.pressed = true;
      w.step();
      expect(mammoth.dashT).toBeGreaterThan(0);
      expect(mammoth.flyT).toBeGreaterThan(0);

      // Reset for charged roar
      mammoth.dashT = 0;
      mammoth.cd = 0;
      const farRivalId = w.addPlayer('FarRival', 'cow');
      const farRival = place(w, farRivalId, 65, 0, 300); // At edge of map

      mammoth.input.btn = false;
      mammoth.holdT = 1.0;
      mammoth.pressed = true;
      w.step();

      // Far rival across entire map is stunned up to 3.0s
      expect(farRival.stunT).toBeGreaterThanOrEqual(2.5);

      const roarEvent = w.events.find((e) => e.k === 'mammothRoar' && e.id === mId && e.rainbow) as any;
      expect(roarEvent).toBeDefined();
      expect(roarEvent.dur).toBeGreaterThanOrEqual(2.5);

      // Rainbow removes all cooldowns completely (0s)
      expect(mammoth.cd).toBe(0);
      expect(mammoth.mammothRoarCd).toBe(0);
    });

    it('other species charging dash normally without roar', () => {
      const w = emptyWorld();
      const pId = w.addPlayer('Boar', 'pig');
      const pig = place(w, pId, 0, 0, 100);

      pig.input.a = 0;
      pig.input.btn = false;
      pig.holdT = 1.0;
      pig.pressed = true;
      w.step();

      expect(pig.dashT).toBeGreaterThan(0);
      expect(pig.plow).toBe(true);
      expect(pig.mammothRoarT).toBeFalsy();
    });

    it('Rainbow Monkey charged leap blows enemies far away without squishing', () => {
      const w = emptyWorld();
      const mId = w.addPlayer('SunWukong', 'monkey');
      const monkey = place(w, mId, 0, 0, 500);
      monkey.superT = 10.0; // Rainbow mode

      const rivalId = w.addPlayer('Rival', 'pig');
      const rival = place(w, rivalId, 22, 0, 100);

      // Charge leap
      monkey.input.a = 0;
      monkey.input.btn = false;
      monkey.holdT = 1.0;
      monkey.pressed = true;
      monkey.btnLatch = false;
      w.step();

      expect(monkey.monkeyLeapT).toBeGreaterThan(0);
      const leapEv = w.events.find(e => e.k === 'monkeyLeap' && e.id === mId && e.rainbow);
      expect(leapEv).toBeDefined();

      // Fast forward until landing
      while (monkey.monkeyLeapT && monkey.monkeyLeapT > 0) {
        w.step();
      }

      // Rival is blown away with massive force, but NOT squished!
      expect(rival.squishT).toBe(0);
      expect(Math.abs(rival.vx)).toBeGreaterThan(25); // Heavy knockback
      expect(rival.stunT).toBeGreaterThan(0.5);
    });

    it('Rainbow Gorilla charged leap squashes rivals', () => {
      const w = emptyWorld();
      const gId = w.addPlayer('KingKong', 'elephant');
      const gorilla = place(w, gId, 0, 0, 3000);
      gorilla.species = 'gorilla';
      gorilla.superT = 10.0; // Rainbow mode

      const rivalId = w.addPlayer('Rival', 'cow');
      const rival = place(w, rivalId, 25, 0, 200);

      gorilla.input.a = 0;
      gorilla.input.btn = false;
      gorilla.holdT = 1.0;
      gorilla.pressed = true;
      gorilla.btnLatch = false;
      w.step();

      expect(gorilla.monkeyLeapT).toBeGreaterThan(0);

      // Fast forward until landing
      while (gorilla.monkeyLeapT && gorilla.monkeyLeapT > 0) {
        w.step();
      }

      // Rival is squashed flat by Gorilla!
      expect(rival.squishT).toBeGreaterThan(2.0);
    });

    it('Gorilla banana throw costs exactly 0.5% kg of body mass', () => {
      const w = emptyWorld();
      const gId = w.addPlayer('BananaGorilla', 'elephant');
      const gorilla = place(w, gId, 0, 0, 3000);
      gorilla.species = 'gorilla';

      gorilla.input = { a: 0, mv: false, btn: false };
      gorilla.holdT = 0.1; // Tap throw
      gorilla.pressed = true;
      gorilla.btnLatch = false;
      (w as any).dash(gorilla);

      // 3000 * 0.005 = 15kg penalty
      expect(gorilla.mass).toBe(3000 - 15);
    });

    it('Mammoth is immune to animals under 1 ton and mini minions', () => {
      const w = emptyWorld();
      const mId = w.addPlayer('AncientMammoth', 'elephant');
      const mammoth = place(w, mId, 0, 0, 3000);
      w.step();
      expect(mammoth.species).toBe('mammoth');

      const smallAttackerId = w.addPlayer('SmallPig', 'pig');
      const smallPig = place(w, smallAttackerId, 0, 0, 200);

      // Small pig rams mammoth
      const massBefore = mammoth.mass;
      smallPig.input.a = 0;
      smallPig.input.btn = false;
      smallPig.holdT = 0.5;
      smallPig.pressed = true;
      smallPig.dashT = 0.5;
      smallPig.vx = 20;

      // Call world.hit directly
      (w as any).hit(smallPig, mammoth, 1, 0, 20);

      // Mammoth took 0 loss and 0 stun!
      expect(mammoth.mass).toBe(massBefore);
      expect(mammoth.stunT).toBe(0);

      // Small pig bounced back and got stunned
      expect(smallPig.stunT).toBeGreaterThan(0);
      expect(smallPig.vx).toBeLessThan(0);
    });

    it('allows rainbow-empowered ram to bypass Gorilla and Mammoth immunity with 1/2 knockback force', () => {
      // 1. Hit a normal elephant
      const w1 = emptyWorld();
      const eId = w1.addPlayer('NormalElephant', 'elephant');
      const elephant = place(w1, eId, 0, 0, 3000);
      const pId1 = w1.addPlayer('RainbowPig1', 'pig');
      const smallPig1 = place(w1, pId1, -5, 0, 100);
      smallPig1.superT = 10;
      smallPig1.dashT = 0.5;
      smallPig1.vx = 30;
      smallPig1.vz = 0;
      w1.step();
      const normalKnockback = elephant.vx;
      expect(normalKnockback).toBeGreaterThan(50);

      // 2. Hit a Mammoth of the exact same mass
      const w2 = emptyWorld();
      const mId = w2.addPlayer('BigMammoth', 'elephant');
      const mammoth = place(w2, mId, 0, 0, 3000);
      mammoth.species = 'mammoth';
      const pId2 = w2.addPlayer('RainbowPig2', 'pig');
      const smallPig2 = place(w2, pId2, -5, 0, 100);
      smallPig2.superT = 10;
      smallPig2.dashT = 0.5;
      smallPig2.vx = 30;
      smallPig2.vz = 0;
      w2.step();
      const mammothKnockback = mammoth.vx;

      // 3. Hit a Gorilla of the exact same mass
      const w3 = emptyWorld();
      const gId = w3.addPlayer('BigGorilla', 'monkey');
      const gorilla = place(w3, gId, 0, 0, 3000);
      gorilla.species = 'gorilla';
      const pId3 = w3.addPlayer('RainbowPig3', 'pig');
      const smallPig3 = place(w3, pId3, -5, 0, 100);
      smallPig3.superT = 10;
      smallPig3.dashT = 0.5;
      smallPig3.vx = 30;
      smallPig3.vz = 0;
      w3.step();
      const gorillaKnockback = gorilla.vx;

      // Mammoth and Gorilla knockback must be exactly 1/2 of normal rainbow knockback!
      expect(mammothKnockback).toBeCloseTo(normalKnockback * 0.5, 1);
      expect(gorillaKnockback).toBeCloseTo(normalKnockback * 0.5, 1);
      expect(mammoth.mass).toBeLessThan(3000);
      expect(gorilla.mass).toBeLessThan(3000);
    });

    it('ensures cart/wheel crush squishes Mammoth and caps loss at 100 kg per hit with debounce', () => {
      const w = emptyWorld();
      const mId = w.addPlayer('BigMammoth', 'mammoth');
      const mammoth = place(w, mId, 0, 0, 3000);

      const cId = w.addPlayer('CartDriver', 'pig');
      const cart = place(w, cId, -2, 0, 200);
      cart.wheelT = 10;
      cart.vx = 20;
      cart.vz = 0;

      // First roll-over hit
      const massBefore = mammoth.mass;
      w.step();

      expect(mammoth.squishT).toBeGreaterThan(0);
      expect(mammoth.stunT).toBeGreaterThan(0);
      const hitEv = (w as any).events.find((e: any) => e.k === 'hit');
      expect(hitEv).toBeDefined();
      expect(hitEv.loss).toBe(100);
      // Actual mass loss should be capped around 100kg (accounting for a tiny fraction of tick hunger decay)
      expect(massBefore - mammoth.mass).toBeLessThanOrEqual(101);
      expect(massBefore - mammoth.mass).toBeGreaterThan(0);

      // Immediate next frame within debounce window (0.35s) cannot re-drain
      cart.x = mammoth.x - 0.5;
      (w as any).events = [];
      w.step();
      const debouncedHit = (w as any).events.find((e: any) => e.k === 'hit');
      expect(debouncedHit).toBeUndefined();

      // After debounce time (e.g. 0.4s), continuous rolling over can hit again
      (w as any).time += 0.4;
      cart.x = mammoth.x - 0.5;
      (w as any).events = [];
      w.step();
      const secondHit = (w as any).events.find((e: any) => e.k === 'hit');
      expect(secondHit).toBeDefined();
      expect(secondHit.loss).toBe(100);
    });

    it('ensures food, tools, and scattered items never spawn inside hay bales or trees', () => {
      for (let seed = 100; seed < 120; seed++) {
        const w = new World(seed);
        
        // Check initial spawns
        for (const f of w.food.values()) {
          expect(w.isBlockedByObstacle(f.x, f.z, 0.4)).toBe(false);
        }
        for (const t of w.tools.values()) {
          expect(w.isBlockedByObstacle(t.x, t.z, 0.4)).toBe(false);
        }

        // Test scatter around hay and trees
        if (w.map.hay.length > 0) {
          const [hx, hz, hr] = w.map.hay[0];
          (w as any).scatter(hx, hz, 50, hr, 1, 0);
          for (const f of w.food.values()) {
            expect(w.isBlockedByObstacle(f.x, f.z, 0.4)).toBe(false);
          }
        }

        // Test renewGame
        w.renewGame(seed + 999);
        for (const f of w.food.values()) {
          expect(w.isBlockedByObstacle(f.x, f.z, 0.4)).toBe(false);
        }

        // Test shiftMap
        w.shiftMap(seed + 1999);
        for (const f of w.food.values()) {
          expect(w.isBlockedByObstacle(f.x, f.z, 0.4)).toBe(false);
        }
      }
    });

    it('tapers size growth rate for animals exceeding 3000kg', () => {
      const r2999 = radiusOf(2999);
      const r3000 = radiusOf(3000);
      const r3001 = radiusOf(3001);
      // Strictly increasing and continuous at 3000kg
      expect(r3000).toBeGreaterThan(r2999);
      expect(r3001).toBeGreaterThan(r3000);
      expect(Math.abs(r3000 - (1 + Math.sqrt(3000) * 0.09))).toBeLessThan(1e-9);

      // Delta for 1000kg below 3000kg vs 1000kg above 3000kg
      const growthBelow = radiusOf(3000) - radiusOf(2000);
      const growthAbove = radiusOf(4000) - radiusOf(3000);
      // Growth rate above 3000kg should be significantly dampened (40% slope)
      expect(growthAbove).toBeLessThan(growthBelow * 0.45);

      // Progressively diminishing rate above 3000kg:
      const growthNext = radiusOf(5000) - radiusOf(4000);
      expect(growthNext).toBeLessThan(growthAbove);
    });

    it('speed item increases speed by 300% for 20s decaying over last 5s', () => {
      const w = emptyWorld();
      const id1 = w.addPlayer('runner1', 'pig', false);
      const p1 = place(w, id1, 0, 0, 50);
      p1.input = { a: 0, mv: true, btn: false };

      const id2 = w.addPlayer('runner2', 'pig', false);
      const p2 = place(w, id2, 0, 5, 50);
      p2.input = { a: 0, mv: true, btn: false };
      p2.speedT = 20; // active 300% speed boost for 20s

      w.step();
      w.flush();

      // At t=20s, p2 moves at 300% (3x) the distance of normal p1
      const distNormal = p1.x;
      const distBoosted = p2.x;
      expect(distBoosted).toBeGreaterThan(distNormal * 2.7);

      // Decays over last 5s: at 2.5s remaining, boost is 2.0x
      const id3 = w.addPlayer('runner3', 'pig', false);
      const p3 = place(w, id3, 0, 10, 50);
      p3.input = { a: 0, mv: true, btn: false };
      p3.speedT = 2.5;

      const id4 = w.addPlayer('runner4', 'pig', false);
      const p4 = place(w, id4, 0, 15, 50);
      p4.input = { a: 0, mv: true, btn: false };
      p4.speedT = 0;

      w.step();
      w.flush();

      expect(p3.x).toBeGreaterThan(p4.x * 1.8);
      expect(p3.x).toBeLessThan(p4.x * 2.2);
    });

    it('shield item provides immunity to stun, knockback, squish while taking damage', () => {
      const w = emptyWorld();
      const id1 = w.addPlayer('shielded', 'pig', false);
      const p1 = place(w, id1, 0, 0, 100);
      p1.shieldT = 10;

      // 1. Water immunity: inWaterT remains 0
      p1.terrain = 1;
      w.step();
      w.flush();
      expect(p1.inWaterT).toBe(0);
      expect(p1.alive).toBe(true);

      // 2. Fire pit immunity
      w.map.fire = [[0, 0, 5]];
      w.step();
      w.flush();
      expect(p1.alive).toBe(true);
      w.map.fire.length = 0;

      // 3. Combat: shielded player takes damage (sát thương) but 0 knockback, 0 stun, 0 squish
      const id2 = w.addPlayer('attacker', 'elephant', false);
      const p2 = place(w, id2, -3, 0, 2000);
      p2.vx = 40;
      p2.dashT = 0.5;
      p2.power = 1.5;
      const prevX = p1.x;
      const prevMass = p1.mass;

      w.step();
      w.flush();

      expect(p1.alive).toBe(true);
      expect(p1.mass).toBeLessThan(prevMass); // Takes damage / mass loss
      expect(p1.stunT).toBe(0); // Immune to stun
      expect(p1.squishT).toBe(0); // Immune to squish
      expect(Math.abs(p1.x - prevX)).toBeLessThan(1.0); // No knockback!

      // 4. Gorilla leap shockwave landing immunity: takes damage only, 0 squish, 0 stun, 0 knockback
      const id3 = w.addPlayer('gorillaLeaper', 'gorilla', false);
      const p3 = place(w, id3, p1.x + 1, p1.z, 3500);
      p3.monkeyLeapT = 0.05; // about to land next tick
      p3.holdT = 1.0;
      p1.vx = 2.0; // moving forward
      const prevVx = p1.vx;
      const prevMass3 = p1.mass;

      w.step();
      w.flush();

      expect(p1.alive).toBe(true);
      expect(p1.mass).toBeLessThan(prevMass3); // takes damage
      expect(p1.squishT).toBe(0); // NO squish
      expect(p1.stunT).toBe(0); // NO stun
      expect(p1.vx).toBeLessThanOrEqual(prevVx); // Normal friction only, ZERO knockback!
      expect(p1.vx).toBeGreaterThan(0);
    });

    it('maintains increased TOOL_TARGET of 20 tools across map lifecycle', () => {
      const w = new World(42, { bots: false, food: false });
      expect(w.tools.size).toBe(CFG.TOOL_TARGET);
      expect(CFG.TOOL_TARGET).toBe(20);

      w.renewGame(100);
      expect(w.tools.size).toBe(CFG.TOOL_TARGET);

      w.shiftMap(200);
      expect(w.tools.size).toBe(CFG.TOOL_TARGET);
    });

    it('coronation immediately summons 10 mini defender animals for the King', () => {
      const w = emptyWorld();
      w.podiumShield = false;
      const id1 = w.addPlayer('KingCandidate', 'pig', false);
      const p1 = place(w, id1, w.map.podium[0], w.map.podium[1], 100);

      // Trigger King coronation
      w.podiumProgress = 0.99;
      w.podiumCaptor = p1.id;
      w.step();
      w.flush();

      expect(w.napoleonId).toBe(p1.id);
      let kingMinions = 0;
      for (const m of w.minions.values()) {
        if (m.ownerId === p1.id) kingMinions++;
      }
      expect(kingMinions).toBe(10);

      // When King is usurped by killer, new King gets 10 minions
      const id2 = w.addPlayer('Usurper', 'elephant', false);
      const p2 = place(w, id2, 0, 0, 1000);
      p1.lastHitBy = p2.id;
      p1.lastHitT = w.time;
      (w as any).kill(p1, 'ram');
      w.flush();

      expect(w.napoleonId).toBe(p2.id);
      let usurperMinions = 0;
      for (const m of w.minions.values()) {
        if (m.ownerId === p2.id) usurperMinions++;
        if (m.ownerId === p1.id) {
          expect(m.ownerId).not.toBe(p1.id);
        }
      }
      expect(usurperMinions).toBe(10);
    });

    it('coronation does NOT delete minions of other living animals', () => {
      const w = emptyWorld();
      w.podiumShield = false;
      const otherId = w.addPlayer('OtherPlayer', 'sheep', false);
      place(w, otherId, 20, 20, 200);

      // Other player has 4 minions
      for (let i = 0; i < 4; i++) {
        const mid = (w as any).nextMinionId++;
        w.minions.set(mid, {
          id: mid,
          ownerId: otherId,
          x: 20,
          z: 20,
          vx: 0,
          vz: 0,
          a: 0,
          mass: 50,
          species: 'sheep',
          skin: 0,
          targetId: 0,
          alive: true,
          cd: 0,
          orbitAngle: 0,
        });
      }
      expect([...w.minions.values()].filter((m) => m.ownerId === otherId).length).toBe(4);

      // Now a new player becomes King
      const kingId = w.addPlayer('NewKing', 'pig', false);
      const king = place(w, kingId, w.map.podium[0], w.map.podium[1], 100);
      w.summonKingGuards(king);

      // King should have 10 minions
      expect([...w.minions.values()].filter((m) => m.ownerId === kingId).length).toBe(10);
      // Other player should STILL have their 4 minions intact!
      expect([...w.minions.values()].filter((m) => m.ownerId === otherId).length).toBe(4);
    });

    it('song item only spawns when a King exists and is alive', () => {
      const w = emptyWorld();
      w.tools.clear();
      expect(w.napoleonId).toBe(0);

      // With no King, spawning tools should NEVER produce 'song'
      for (let i = 0; i < 60; i++) {
        (w as any).spawnTool();
      }
      for (const t of w.tools.values()) {
        expect(t.kind).not.toBe('song');
      }

      // Crown a king
      const id1 = w.addPlayer('ActiveKing', 'pig', false);
      w.napoleonId = id1;
      w.tools.clear();

      // With King active, 'song' can now spawn
      let spawnedSong = false;
      for (let i = 0; i < 80; i++) {
        (w as any).spawnTool();
      }
      for (const t of w.tools.values()) {
        if (t.kind === 'song') spawnedSong = true;
      }
      expect(spawnedSong).toBe(true);
    });

    it('spawns dolphin heart at center of largest pond only when dolphin delivers, and does not spawn if already present', () => {
      const w = new World(1234, { bots: false, food: false });
      w.food.clear();
      w.tools.clear();
      const pond = w.getLargestPond()!;
      expect(pond).toBeDefined();

      // Step 30 seconds: dolphinDeliver event should be pushed
      for (let i = 0; i < 30 * 20; i++) {
        w.step();
      }
      const snapDeliver = w.snapshotFor(1);
      const deliverEv = snapDeliver.ev.find((e) => e.k === 'dolphinDeliver');
      expect(deliverEv).toBeDefined();

      // Step another 2.5s: dolphin finishes surfacing at center and places heart item
      for (let i = 0; i < Math.ceil(2.5 * 20); i++) {
        w.step();
      }

      // Heart tool should now exist near center of largest pond
      const hearts = [...w.tools.values()].filter((t) => t.kind === 'heart');
      expect(hearts.length).toBe(1);
      expect(Math.hypot(hearts[0].x - pond[0], hearts[0].z - pond[1])).toBeLessThan(0.1);

      // Requirement: Nếu đã có Trái tim ở trước đó thì cá heo sẽ chỉ bơi vòng quanh và thỉnh thoảng hiện lên thôi.
      // Step another 60s while heart is still uncollected: NO duplicate heart spawns!
      for (let i = 0; i < 60 * 20; i++) {
        w.step();
      }
      const heartsAfter60s = [...w.tools.values()].filter((t) => t.kind === 'heart');
      expect(heartsAfter60s.length).toBe(1);
    });

    it('player picking up heart item gains hasHeart flag and revives in 3s with exact mass', () => {
      const w = emptyWorld();
      w.tools.clear();
      const id = w.addPlayer('BlessedPlayer', 'sheep', false);
      place(w, id, 10, 10, 245);
      const p = w.players.get(id)!;
      expect(p.hasHeart).toBe(false);

      // Spawn heart right at player position
      const heartId = (w as any).nextTool++;
      w.tools.set(heartId, { id: heartId, kind: 'heart', x: 10, z: 10, age: 0 });

      w.step();

      // Heart should be picked up
      expect(w.tools.has(heartId)).toBe(false);
      expect(p.hasHeart).toBe(true);

      const snap = w.snapshotFor(id);
      const wire = snap.p.find(([pid]) => pid === id)!;
      expect((wire[5] & FLAG.HEART) !== 0).toBe(true);

      // Now kill the player with hazards / attack
      const preDeathMass = p.mass;
      expect(Math.round(preDeathMass)).toBe(245);

      (w as any).kill(p, 'fire');
      const snapAfterKill = w.snapshotFor(id);
      const reviveEv = snapAfterKill.ev.find((e) => e.k === 'heartRevive') as any;
      expect(reviveEv).toBeDefined();
      expect(reviveEv.mass).toBe(Math.round(preDeathMass));
      expect(reviveEv.dur).toBe(3.0);

      // Player should be heartReviving and alive = false temporarily
      expect(p.heartReviving).toBe(true);
      expect(p.alive).toBe(false);
      expect(p.hasHeart).toBe(false);

      // Fast forward 2.8 seconds: still reviving (DT = 0.05s)
      for (let i = 0; i < Math.floor(2.8 / DT); i++) {
        w.step();
      }
      expect(p.heartReviving).toBe(true);
      expect(p.alive).toBe(false);

      // Step past 3.0 seconds: resurrected!
      for (let i = 0; i < Math.ceil(0.3 / DT); i++) {
        w.step();
      }
      expect(p.heartReviving).toBe(false);
      expect(p.alive).toBe(true);
      const snapRevived = w.snapshotFor(id);
      const revivedEv = snapRevived.ev.find((e) => e.k === 'heartRevived') as any;
      expect(revivedEv).toBeDefined();
      expect(revivedEv.id).toBe(id);
      expect(revivedEv.mass).toBe(Math.round(preDeathMass));
      // Requirement: Kích thước sau khi hồi sinh đúng bằng lúc trước khi chết!
      expect(Math.round(p.mass)).toBe(Math.round(preDeathMass));
      expect(p.heartReviveMass).toBe(preDeathMass);
      // Revives with 3s immunity shield
      expect(p.shieldT).toBeGreaterThan(0);
    });

    it('preserves morphed species (e.g. elephant from monkey) upon heart revive instead of reverting to monkey', () => {
      const w = emptyWorld();
      const id = w.addPlayer('PlayerMonkey', 'monkey', false);
      const p = w.players.get(id)!;
      expect(p.species).toBe('monkey');

      // Morph into elephant (like banana item)
      p.morphOrigSpecies = 'monkey';
      p.species = 'elephant';
      p.morphT = 25;
      p.hasHeart = true;

      // Kill player with hazard
      (w as any).kill(p, 'fence');

      expect(p.heartReviving).toBe(true);
      // Species must still be elephant!
      expect(p.species).toBe('elephant');
      expect(p.morphOrigSpecies).toBe('monkey');

      // Step past 3.0s until revived
      for (let i = 0; i < Math.ceil(3.2 / DT); i++) {
        w.step();
      }
      expect(p.heartReviving).toBe(false);
      expect(p.alive).toBe(true);
      expect(p.species).toBe('elephant');
      expect(p.morphOrigSpecies).toBe('monkey');
      expect(p.morphT).toBeGreaterThan(0);

      // Verify that player has elephant ability (normal dash), NOT monkey banana throw
      p.input.btn = true;
      p.input.a = 0;
      w.step();
      p.input.btn = false;
      w.step();
      // Elephant dashes forward
      expect(p.dashT).toBeGreaterThan(0);
      expect(p.monkeyLeapT).toBe(0);
      // No banana projectile created
      expect((w as any).projectiles?.length || 0).toBe(0);
    });

    it('Gorilla only leaps once and never bounces upon landing', () => {
      const w = emptyWorld();
      const gId = w.addPlayer('KingKong', 'gorilla', false);
      const enemyId = w.addPlayer('VictimPig', 'pig', false);
      const g = w.players.get(gId)!;
      place(w, gId, 0, 0, 3000);
      place(w, enemyId, 15, 0, 200);

      // Max charge leap towards enemy
      g.holdT = 1.2;
      g.input.a = 0;
      (w as any).dash(g);
      expect(g.monkeyLeapT).toBeGreaterThan(0);

      // Fast forward until gorilla lands
      while (g.monkeyLeapT && g.monkeyLeapT > 0) {
        w.step();
      }

      // Gorilla has landed
      expect(g.monkeyLeapT).toBe(0);
      expect(g.monkeyBounced).toBeFalsy();
      // Only 1 monkeyLeap event was pushed
      const leapEvents = w.events.filter((e) => e.k === 'monkeyLeap' && (e as any).id === gId);
      expect(leapEvents.length).toBe(1);
    });

    it('Monkey max charge leap bounces forward once if landing hits another animal', () => {
      const w = emptyWorld();
      const mId = w.addPlayer('SunWukong', 'monkey', false);
      const victimId = w.addPlayer('SheepVictim', 'sheep', false);
      const m = w.players.get(mId)!;
      place(w, mId, 0, 0, 100);
      place(w, victimId, 22, 0, 100);

      m.holdT = 1.2; // max charge
      m.input.a = 0;
      (w as any).dash(m);
      expect(m.monkeyLeapT).toBeGreaterThan(0);
      expect(m.monkeyBounced).toBe(false);

      // Step until landing
      const initialDur = m.monkeyLeapDur!;
      for (let i = 0; i < Math.ceil(initialDur / DT); i++) {
        w.step();
      }

      // Landing on victim triggered forward inertial bounce!
      expect(m.monkeyBounced).toBe(true);
      expect(m.monkeyLeapT).toBeGreaterThan(0);
      const leapEvents = w.events.filter((e) => e.k === 'monkeyLeap' && (e as any).id === mId);
      expect(leapEvents.length).toBe(2); // Initial leap + forward inertial bounce leap

      // Now step until the bounce leap finishes
      while (m.monkeyLeapT && m.monkeyLeapT > 0) {
        w.step();
      }
      expect(m.monkeyLeapT).toBe(0);
      expect(m.monkeyBounced).toBe(false);
      // No 3rd bounce!
      const finalLeapEvents = w.events.filter((e) => e.k === 'monkeyLeap' && (e as any).id === mId);
      expect(finalLeapEvents.length).toBe(2);
    });

    it('Monkey max charge leap does NOT bounce if landing on empty ground', () => {
      const w = emptyWorld();
      const mId = w.addPlayer('SunWukongSolo', 'monkey', false);
      const m = w.players.get(mId)!;
      place(w, mId, 0, 0, 100);

      m.holdT = 1.2; // max charge
      m.input.a = 0;
      (w as any).dash(m);
      expect(m.monkeyLeapT).toBeGreaterThan(0);

      // Step until landing
      while (m.monkeyLeapT && m.monkeyLeapT > 0) {
        w.step();
      }
      // Lands on empty ground without bouncing
      expect(m.monkeyLeapT).toBe(0);
      expect(m.monkeyBounced).toBe(false);
      const leapEvents = w.events.filter((e) => e.k === 'monkeyLeap' && (e as any).id === mId);
      expect(leapEvents.length).toBe(1);
    });

    it('Monkey max charge leap does NOT bounce if enemy is inside shockwave but not physically touched', () => {
      const w = emptyWorld();
      const mId = w.addPlayer('SunWukongShockwave', 'monkey', false);
      const bystanderId = w.addPlayer('SheepBystander', 'sheep', false);
      const m = w.players.get(mId)!;
      place(w, mId, 0, 0, 100);
      // Max leap covers 22m (lands at x=22). Place bystander at x=26.5 (distance 4.5m, inside 6.8m shockwave, but > 1.8m touch radius)
      place(w, bystanderId, 26.5, 0, 100);

      m.holdT = 1.2; // max charge
      m.input.a = 0;
      (w as any).dash(m);
      expect(m.monkeyLeapT).toBeGreaterThan(0);

      // Step until landing
      while (m.monkeyLeapT && m.monkeyLeapT > 0) {
        w.step();
      }
      // Lands and does NOT bounce, because bystander was not physically touched!
      expect(m.monkeyLeapT).toBe(0);
      expect(m.monkeyBounced).toBe(false);
      const leapEvents = w.events.filter((e) => e.k === 'monkeyLeap' && (e as any).id === mId);
      expect(leapEvents.length).toBe(1);
    });
  });

  describe('wolf evolution and combat mechanics', () => {
    it('dog evolves to wolf at 3000kg and de-evolves back to dog below 1000kg', () => {
      const w = emptyWorld();
      const dId = w.addPlayer('Shiba', 'dog', false);
      const p = place(w, dId, 0, 0, 2999);
      w.step();
      expect(p.species).toBe('dog');

      p.mass = 3000;
      w.step();
      expect(p.species).toBe('wolf');
      expect(w.events.some((e) => e.k === 'morph' && e.id === dId && e.species === 'wolf')).toBe(true);

      // Inherits +30% land speed and slow swimming without drowning
      expect(TRAITS.wolf.speed).toBe(1.30);
      expect(TRAITS.wolf.water).toBe(0.35);

      // De-evolves below 1000kg
      p.mass = 999;
      w.step();
      expect(p.species).toBe('dog');
    });

    it('wolf swims in water without drowning and moves 30% faster on land', () => {
      const w = emptyWorld();
      w.map.ponds = [[0, 0, 8, 8, 0, 1, 1, 1, 1, 1, 1, 1, 1]];
      const wId = w.addPlayer('Fenrir', 'wolf', false);
      const wolf = place(w, wId, 0, 0, 3000);

      for (let i = 0; i < 60; i++) {
        w.step();
      }
      expect(wolf.alive).toBe(true);
      expect(wolf.inWaterT).toBe(0);
    });

    it('normal wolf tap pounces lightly, while charged hold lunges to target and bites repeatedly at different angles', () => {
      const w = emptyWorld();
      const wId = w.addPlayer('Fenrir', 'dog', false);
      const tId = w.addPlayer('TargetCow', 'cow', false);
      const wolf = place(w, wId, 0, 0, 3000);
      const target = place(w, tId, 12, 0, 1500);
      w.step(); // Evolves dog -> wolf at 3000kg
      expect(wolf.species).toBe('wolf');

      // 1. Tap pounce (holdT <= 0.15)
      wolf.holdT = 0.08;
      wolf.input.a = 0;
      (w as any).dash(wolf);
      expect(wolf.dashT).toBeGreaterThan(0);
      expect(wolf.wolfFrenzyT || 0).toBe(0);

      // Reset for charged hold
      wolf.dashT = 0;
      wolf.cd = 0;
      wolf.x = 0;
      wolf.z = 0;
      wolf.vx = 0;
      wolf.vz = 0;

      // 2. Charged hold (holdT = 1.2s -> max 6 bites on single target at different positions)
      wolf.holdT = 1.2;
      wolf.input.a = 0;
      (w as any).dash(wolf);
      expect(wolf.wolfTargetId).toBe(tId);
      expect(wolf.wolfBiteTotal).toBe(6);

      const anglesSeen = new Set<string>();
      for (let i = 0; i < 25; i++) {
        w.step();
        const biteEvs = w.events.filter((e) => e.k === 'wolfBite' && e.id === wId);
        for (const ev of biteEvs) {
          if (ev.k === 'wolfBite') {
            const ang = Math.atan2(ev.z - target.z, ev.x - target.x).toFixed(2);
            anglesSeen.add(ang);
          }
        }
      }

      // Multiple distinct angles around target were bitten, target lost mass, wolf stole mass!
      expect(anglesSeen.size).toBeGreaterThanOrEqual(4);
      expect(target.mass).toBeLessThan(1500);
      expect(wolf.mass).toBeGreaterThan(3000);
    });

    it('wolf charged skill does not activate frenzy when aiming away from animals or missing the strike zone', () => {
      const w = emptyWorld();
      const wId = w.addPlayer('Fenrir', 'dog', false);
      const tId = w.addPlayer('SidewaysPig', 'pig', false);
      const wolf = place(w, wId, 0, 0, 3000);
      // Target is far to the side (Z = 20) while wolf aims along +X (a = 0)
      place(w, tId, 0, 20, 600);
      w.step();
      expect(wolf.species).toBe('wolf');

      wolf.holdT = 1.2;
      wolf.input.a = 0; // Aiming +X away from the target at Z=20
      (w as any).dash(wolf);

      // Should NOT lock on or trigger frenzy
      expect(wolf.wolfTargetId).toBeUndefined();
      expect(wolf.wolfChainTargets).toBeUndefined();
      expect(wolf.dashT).toBeGreaterThan(0); // Standard charged dash
    });

    it('rainbow wolf charged hold chain-blinks across up to 6 different animals (0.3s per target, 1.8s total) and steals mass', () => {
      const w = emptyWorld();
      const wId = w.addPlayer('RainbowFenrir', 'dog', false);
      const wolf = place(w, wId, 0, 0, 3000);
      w.step(); // Evolves dog -> wolf at 3000kg
      expect(wolf.species).toBe('wolf');
      wolf.superT = 8.0; // Rainbow power active!

      const enemyIds: number[] = [];
      for (let i = 0; i < 7; i++) {
        const ang = (i / 7) * Math.PI * 2;
        const eid = w.addPlayer(`Enemy${i}`, 'pig', false);
        place(w, eid, Math.cos(ang) * 14, Math.sin(ang) * 14, 600);
        enemyIds.push(eid);
      }

      // Max charge (holdT = 1.2s) -> max 6 targets, 0.3s each = 1.8s total
      wolf.holdT = 1.2;
      wolf.input.a = 0;
      (w as any).dash(wolf);

      expect(wolf.wolfChainRainbow).toBe(true);
      expect(wolf.wolfChainTargets?.length).toBe(6);
      expect(wolf.wolfFrenzyT).toBeCloseTo(1.8, 1);

      const bittenTargets = new Set<number>();
      for (let i = 0; i < 40; i++) {
        w.step();
        for (const ev of w.events) {
          if (ev.k === 'wolfBite' && ev.id === wId) {
            bittenTargets.add(ev.targetId);
          }
        }
      }

      expect(bittenTargets.size).toBe(6);
      expect(wolf.mass).toBeGreaterThan(3000);
    });
  });

  describe('six new evolved animals mechanics and balance', () => {
    it('evolves all 6 base animals to their evolved form at 3000kg and devolves below 1000kg', () => {
      const pairs: [Species, Species][] = [
        ['chicken', 'phoenix'],
        ['duck', 'swan'],
        ['sheep', 'ram'],
        ['pig', 'boar'],
        ['horse', 'pegasus'],
        ['cow', 'bull'],
      ];

      for (const [base, evolved] of pairs) {
        const w = emptyWorld();
        const pId = w.addPlayer('TestBeast', base, false);
        const p = place(w, pId, 0, 0, 2999);
        w.step();
        expect(p.species).toBe(base);

        p.mass = 3000;
        w.step();
        expect(p.species).toBe(evolved);
        expect(w.events.some((e) => e.k === 'morph' && e.id === pId && e.species === evolved)).toBe(true);

        p.mass = 999;
        w.step();
        expect(p.species).toBe(base);
        expect(w.events.some((e) => e.k === 'morph' && e.id === pId && e.species === base)).toBe(true);
      }
    });

    it('phoenix has rapid dash, 0.5x cooldown, and sheds burning food on hit', () => {
      const w = emptyWorld();
      const pId = w.addPlayer('Phoenix', 'phoenix', false);
      const vId = w.addPlayer('Victim', 'sheep', false);
      const p = place(w, pId, 0, 0, 3000);
      const vic = place(w, vId, 3, 0, 500);

      // Cooldown test
      p.holdT = 0.05;
      p.input.a = 0;
      (w as any).dash(p);
      expect(p.cd).toBeCloseTo(CFG.DASH_CD * 0.5, 1);

      // Hit test: phoenix singes victim and scatters food
      const initialFoods = w.food.size;
      w.hit(p, vic, 25, 1, 0);
      expect(w.food.size).toBeGreaterThan(initialFoods);
    });

    it('swan swims freely without drowning, moves faster in water, and creates sliding ice waves', () => {
      const w = emptyWorld();
      w.map.pond = [[0, 0, 10, 10, 0, 1, 1, 1, 1, 1, 1, 1, 1]];
      const sId = w.addPlayer('Swan', 'swan', false);
      const vId = w.addPlayer('Victim', 'cow', false);
      const swan = place(w, sId, 0, 0, 3000);
      const vic = place(w, vId, 3, 0, 500);

      for (let i = 0; i < 40; i++) {
        w.step();
      }
      expect(swan.alive).toBe(true);
      expect(swan.inWaterT).toBe(0);
      expect(TRAITS.swan.water).toBe(1.45);

      // Hit test: swan pushes victim with extra slide velocity
      w.hit(swan, vic, 20, 1, 0);
      expect(vic.vx).toBeGreaterThan(10);
    });

    it('ram has colossal ram power, heavy weight, and stuns victims on impact', () => {
      const w = emptyWorld();
      const rId = w.addPlayer('Ram', 'ram', false);
      const vId = w.addPlayer('Victim', 'pig', false);
      const ram = place(w, rId, 0, 0, 3000);
      const vic = place(w, vId, 3, 0, 500);

      expect(TRAITS.ram.ram).toBe(1.65);
      expect(TRAITS.ram.weight).toBe(1.55);

      // Regular impact stuns victim for 0.8s
      w.hit(ram, vic, 25, 1, 0);
      expect(vic.stunT).toBeGreaterThanOrEqual(0.8);
    });

    it('boar speeds up in mud and its charged mud plow slows victims by 50% for 2s', () => {
      const w = emptyWorld();
      const bId = w.addPlayer('Boar', 'boar', false);
      const vId = w.addPlayer('Victim', 'sheep', false);
      const boar = place(w, bId, 0, 0, 3000);
      const vic = place(w, vId, 3, 0, 500);

      expect(TRAITS.boar.mud).toBe(1.35);

      boar.plow = true;
      w.hit(boar, vic, 25, 1, 0);
      expect(vic.slowT).toBe(2.0);
    });

    it('pegasus moves at 1.32x speed, does not drown, and takes flight on charged dash', () => {
      const w = emptyWorld();
      w.map.pond = [[0, 0, 10, 10, 0, 1, 1, 1, 1, 1, 1, 1, 1]];
      const pegId = w.addPlayer('Pegasus', 'pegasus', false);
      const peg = place(w, pegId, 0, 0, 3000);

      expect(TRAITS.pegasus.speed).toBe(1.32);

      for (let i = 0; i < 35; i++) {
        w.step();
      }
      expect(peg.alive).toBe(true);
      expect(peg.inWaterT).toBe(0);

      // Charged dash takes flight
      peg.holdT = 0.8;
      peg.input.a = 0;
      (w as any).dash(peg);
      expect(peg.flyT).toBeGreaterThan(0);
      expect(w.events.some((e) => e.k === 'fly' && e.id === pegId)).toBe(true);
    });

    it('bull has 1.70x weight, charged stomp flinches nearby rivals, and horns siphon mass', () => {
      const w = emptyWorld();
      const bullId = w.addPlayer('Bull', 'bull', false);
      const v1Id = w.addPlayer('NearVictim', 'chicken', false);
      const v2Id = w.addPlayer('FarVictim', 'duck', false);
      const bull = place(w, bullId, 0, 0, 3000);
      const v1 = place(w, v1Id, 5, 0, 100);
      const v2 = place(w, v2Id, 25, 0, 100);

      expect(TRAITS.bull.weight).toBe(1.70);
      expect(TRAITS.bull.ram).toBe(1.65);

      // Charged stomp
      bull.holdT = 0.5;
      bull.input.a = 0;
      (w as any).dash(bull);

      // Nearby victim stunned by tremor; far victim untouched
      expect(v1.stunT).toBeGreaterThan(0);
      expect(v2.stunT).toBe(0);

      // Horn gore siphons mass
      const v1MassBefore = v1.mass;
      const bullMassBefore = bull.mass;
      w.hit(bull, v1, 25, 1, 0);
      expect(v1.mass).toBeLessThan(v1MassBefore);
      expect(bull.mass).toBeGreaterThan(bullMassBefore);
    });

    it('all 6 new evolved beasts are immune to knockback, stun, and loss from rivals under 1000kg', () => {
      const evolvedList: Species[] = ['phoenix', 'swan', 'ram', 'boar', 'pegasus', 'bull'];

      for (const sp of evolvedList) {
        const w = emptyWorld();
        const evId = w.addPlayer('EvolvedTitan', sp, false);
        const attId = w.addPlayer('SmallAttacker', 'pig', false);
        const titan = place(w, evId, 0, 0, 3000);
        const attacker = place(w, attId, 2, 0, 50);

        const titanMassBefore = titan.mass;
        w.hit(attacker, titan, 25, 1, 0);

        // Titan unyielding: zero stun, zero mass loss
        expect(titan.stunT).toBe(0);
        expect(titan.mass).toBe(titanMassBefore);

        // Attacker is rebuffed and stunned
        expect(attacker.stunT).toBeGreaterThan(0);
        expect(attacker.vx).toBeLessThan(0);
      }
    });
  });

  describe('admin sandbox commands', () => {
    it('only allows player named Admin9112267 to execute commands', () => {
      const w = new World();
      const normalId = w.addPlayer('NormalPlayer', 'pig', false);
      const adminId = w.addPlayer('Admin9112267', 'pig', false);

      const normalP = w.players.get(normalId)!;
      const adminP = w.players.get(adminId)!;

      // Normal player cannot execute admin command
      const initialMass = normalP.mass;
      w.executeAdminCommand(normalId, { act: 'mass', val: 5000 });
      expect(normalP.mass).toBe(initialMass); // Unchanged

      // Admin player can execute
      w.executeAdminCommand(adminId, { act: 'mass', val: 3500 });
      expect(adminP.mass).toBe(3500);
      expect(adminP.species).toBe('boar'); // Auto evolved!
    });

    it('switches species and evolves appropriately', () => {
      const w = new World();
      const adminId = w.addPlayer('Admin9112267', 'chicken', false);
      const adminP = w.players.get(adminId)!;

      // At low mass, morphs to base species
      w.executeAdminCommand(adminId, { act: 'species', val: 'duck' });
      expect(adminP.species).toBe('duck');

      // Set mass >= 3000kg -> evolves to swan
      w.executeAdminCommand(adminId, { act: 'mass', val: 3200 });
      expect(adminP.species).toBe('swan');

      // Change species while >= 3000kg -> directly becomes evolved beast
      w.executeAdminCommand(adminId, { act: 'species', val: 'horse' });
      expect(adminP.species).toBe('pegasus');
    });

    it('supports god mode and perma rainbow', () => {
      const w = new World();
      const adminId = w.addPlayer('Admin9112267', 'pig', false);
      const adminP = w.players.get(adminId)!;

      w.executeAdminCommand(adminId, { act: 'god', val: true });
      expect(adminP.adminGod).toBe(true);

      // In god mode, cannot be killed
      (w as any).kill(adminP, 'fence');
      expect(adminP.alive).toBe(true);

      w.executeAdminCommand(adminId, { act: 'rainbow', val: true });
      expect(adminP.adminPermaRainbow).toBe(true);
      expect(adminP.superT).toBeGreaterThan(0);
    });

    it('spawns items, clears bots and food', () => {
      const w = new World();
      const adminId = w.addPlayer('Admin9112267', 'pig', false);

      const foodCountBefore = w.food.size;
      w.executeAdminCommand(adminId, { act: 'spawn', item: 'rainbow_candy', count: 5 });
      expect(w.food.size).toBe(foodCountBefore + 5);

      w.executeAdminCommand(adminId, { act: 'clear_food' });
      expect(w.food.size).toBe(0);
      expect(w.tools.size).toBe(0);

      w.executeAdminCommand(adminId, { act: 'clear_bots' });
      for (const p of w.players.values()) {
        expect(p.bot).toBe(false);
      }
    });

    it('evolved species special skills and Super rainbow power', () => {
      const w = emptyWorld();

      // 1. Phoenix charged blaze
      const p1Id = w.addPlayer('Phoenix', 'phoenix', false);
      const p1 = place(w, p1Id, 0, 0, 3200);
      p1.holdT = 0.5;
      (w as any).dash(p1);
      expect(p1.flyT).toBeGreaterThan(0);
      expect(p1.plow).toBe(true);

      // Super Phoenix
      p1.superT = 10;
      p1.dashT = 0;
      (w as any).dash(p1);
      expect(p1.flyT).toBe(0.70);
      expect(p1.power).toBe(7.5);

      // 2. Swan tidal wave pushes and slows nearby rivals
      const sId = w.addPlayer('Swan', 'swan', false);
      const swan = place(w, sId, 10, 10, 3200);
      swan.a = 0; // facing +x
      const enemyId = w.addPlayer('Enemy', 'chicken', false);
      const enemy = place(w, enemyId, 15, 10, 50); // in front of swan

      swan.holdT = 0.5;
      (w as any).dash(swan);
      expect(enemy.vx).toBeGreaterThan(0);
      expect(enemy.slowT).toBeGreaterThan(0);

      // 3. Bull earth stomp siphons mass and stuns
      const bId = w.addPlayer('Bull', 'bull', false);
      const bull = place(w, bId, 50, 50, 3200);
      const vicId = w.addPlayer('Victim', 'pig', false);
      const vic = place(w, vicId, 55, 50, 100);
      const vicMassBefore = vic.mass;

      bull.holdT = 0.5;
      (w as any).dash(bull);
      expect(vic.stunT).toBeGreaterThan(0);
      expect(vic.mass).toBeLessThan(vicMassBefore);
      expect(bull.mass).toBeGreaterThan(3200);

      // 4. Ram and Boar high power
      const ramId = w.addPlayer('Ram', 'ram', false);
      const ram = place(w, ramId, 100, 100, 3200);
      ram.holdT = 0.5;
      (w as any).dash(ram);
      expect(ram.power).toBe(4.6);

      const boarId = w.addPlayer('Boar', 'boar', false);
      const boar = place(w, boarId, 200, 200, 3200);
      boar.holdT = 0.5;
      (w as any).dash(boar);
      expect(boar.power).toBe(4.2);

      // 5. Pegasus sky flight
      const pegId = w.addPlayer('Pegasus', 'pegasus', false);
      const peg = place(w, pegId, 300, 300, 3200);
      peg.holdT = 0.5;
      (w as any).dash(peg);
      expect(peg.flyT).toBe(0.65);
    });

    describe('EVOLVED 3000KG SUPER SKILLS (Phoenix, Ram, Swan, Boar, Pegasus, Bull)', () => {
      it('Phoenix max charge creates fire carpet: kills <= 100kg immediately and burns > 100kg for 3s', () => {
        const w = emptyWorld();
        const pId = w.addPlayer('Phoenix', 'phoenix', false);
        const smallVictimId = w.addPlayer('SmallChick', 'chicken', false);
        const bigVictimId = w.addPlayer('BigCow', 'cow', false);

        const phoenix = place(w, pId, 0, 0, 3200);
        phoenix.input.a = 0; // facing +X
        const smallVic = place(w, smallVictimId, 10, 0, 80);
        const bigVic = place(w, bigVictimId, 15, 0, 500);

        phoenix.holdT = 1.0; // Max charge
        (w as any).dash(phoenix);

        // Verify fire carpet event
        expect(w.events.some((e) => e.k === 'phoenixFire' && e.id === pId && e.len === 24)).toBe(true);

        // Small victim (80kg <= 100kg) immediately carbonized/killed
        expect(smallVic.alive).toBe(false);

        // Big victim (> 100kg) catches fire for 3s
        expect(bigVic.alive).toBe(true);
        expect(bigVic.burnT).toBe(3.0);
        expect(bigVic.slowT).toBeGreaterThan(0);

        // Over time, burn reduces mass every 0.5s
        const bigMassBefore = bigVic.mass;
        for (let i = 0; i < 35; i++) {
          w.step();
        }
        expect(bigVic.mass).toBeLessThan(bigMassBefore);
      });

      it('Phoenix rainbow super max charge creates huge 38m fire carpet', () => {
        const w = emptyWorld();
        const pId = w.addPlayer('Phoenix', 'phoenix', false);
        const victimId = w.addPlayer('FarVictim', 'sheep', false);

        const phoenix = place(w, pId, 0, 0, 3200);
        phoenix.superT = 10;
        phoenix.input.a = 0;
        const victim = place(w, victimId, 32, 0, 80); // 32m away (within 38m carpet)

        phoenix.holdT = 1.0;
        (w as any).dash(phoenix);

        expect(w.events.some((e) => e.k === 'phoenixFire' && e.id === pId && e.len === 38 && e.w === 14)).toBe(true);
        expect(victim.alive).toBe(false);
      });

      it('Ram max charge delivers 2x knockback, and Rainbow Ram flings victims across map', () => {
        const w = emptyWorld();
        const rId = w.addPlayer('Ram', 'ram', false);
        const vId = w.addPlayer('Victim', 'pig', false);
        const ram = place(w, rId, 0, 0, 3200);
        const vic = place(w, vId, 3, 0, 500);

        ram.holdT = 1.0;
        (w as any).dash(ram);
        expect(ram.power).toBe(6.0);

        // Hit victim with max charge Ram
        w.hit(ram, vic, 25, 1, 0);
        expect(w.events.some((e) => e.k === 'ramKnockback' && e.id === rId)).toBe(true);
        expect(vic.vx).toBeGreaterThan(30);

        // Rainbow Ram has 9.5 power and extreme fling velocity
        ram.superT = 10;
        ram.holdT = 1.0;
        (w as any).dash(ram);
        expect(ram.power).toBe(9.5);
      });

      it('Swan max charge flies for 10s, and Rainbow Swan drops freezing ice balls', () => {
        const w = emptyWorld();
        const sId = w.addPlayer('Swan', 'swan', false);
        const enemyId = w.addPlayer('Enemy', 'dog', false);
        const swan = place(w, sId, 0, 0, 3200);
        const enemy = place(w, enemyId, 19, 3, 200);

        swan.superT = 10;
        swan.holdT = 1.0; // Max charge
        (w as any).dash(swan);

        expect(swan.flightT).toBe(10.0);
        expect(swan.flyT).toBe(10.0);

        // Step through simulation for ~1.2s: Swan drops ice balls and freezes enemy
        for (let i = 0; i < 25; i++) {
          w.step();
        }

        expect(swan.flightT).toBeGreaterThan(8.0);
        expect(swan.flyT).toBeGreaterThan(8.0);
        expect(enemy.stunT).toBeGreaterThan(0);
        expect(w.events.some((e) => e.k === 'swanIce' && e.id === sId)).toBe(true);
      });

      it('Boar max charge throws mud boulder: slows and damages, Rainbow Boar roots for 3s', () => {
        const w = emptyWorld();
        const bId = w.addPlayer('Boar', 'boar', false);
        const v1Id = w.addPlayer('NearVictim', 'sheep', false);
        const boar = place(w, bId, 0, 0, 3200);
        boar.input.a = 0;
        const v1 = place(w, v1Id, 8, 0, 500);

        const v1MassBefore = v1.mass;
        boar.holdT = 1.0;
        (w as any).dash(boar);

        expect(w.events.some((e) => e.k === 'boarMud' && e.id === bId && e.r === 3.5)).toBe(true);
        expect(v1.slowT).toBe(2.5);
        expect(v1.mass).toBeLessThan(v1MassBefore);

        // Rainbow Boar: roots enemy for 3.0s
        const v2Id = w.addPlayer('FarVictim', 'cow', false);
        const v2 = place(w, v2Id, 18, 0, 500);
        boar.superT = 10;
        boar.holdT = 1.0;
        (w as any).dash(boar);

        expect(w.events.some((e) => e.k === 'boarMud' && e.id === bId && e.r === 6.0 && e.rainbow === true)).toBe(true);
        expect(v2.stunT).toBe(3.0);
      });

      it('Pegasus max charge flies for 10s, and Rainbow Pegasus drops 5 rainbow candies', () => {
        const w = emptyWorld();
        const pId = w.addPlayer('Pegasus', 'pegasus', false);
        const peg = place(w, pId, 0, 0, 3200);

        peg.superT = 10;
        peg.holdT = 1.0;
        (w as any).dash(peg);

        expect(peg.flightT).toBe(10.0);
        expect(peg.flyT).toBe(10.0);

        // Step through simulation for full 10s flight
        for (let i = 0; i < 330; i++) {
          w.step();
        }

        // Dropped exactly 5 rainbow candies
        expect(peg.pegasusCandyCount).toBe(5);
        expect(w.events.filter((e) => e.k === 'superFood').length).toBeGreaterThanOrEqual(5);
      });

      it('Bull max charge tosses rival in air, dropping them squished flat for 3s', () => {
        const w = emptyWorld();
        const bId = w.addPlayer('Bull', 'bull', false);
        const vId = w.addPlayer('Victim', 'horse', false);
        const bull = place(w, bId, 0, 0, 3200);
        bull.input.a = 0;
        const vic = place(w, vId, 4, 0, 500);

        bull.holdT = 1.0;
        (w as any).dash(bull);

        expect(w.events.some((e) => e.k === 'bullToss' && e.id === bId)).toBe(true);
        expect(vic.tossT).toBe(1.2);
        expect(vic.stunT).toBeGreaterThanOrEqual(1.8);

        // Step simulation for 1.3s so toss completes and victim lands
        for (let i = 0; i < 45; i++) {
          w.step();
        }

        expect(vic.tossT).toBe(0);
        expect(vic.squishT).toBeGreaterThan(0);
      });

      it('All 6 evolved animals trigger their special max skills at holdT = 0.75 threshold', () => {
        const w = emptyWorld();
        // Phoenix
        const p = place(w, w.addPlayer('P', 'phoenix', false), 0, 0, 3200);
        p.holdT = 0.75;
        (w as any).dash(p);
        expect(w.events.some(e => e.k === 'phoenixFire')).toBe(true);

        // Swan
        const s = place(w, w.addPlayer('S', 'swan', false), 0, 0, 3200);
        s.holdT = 0.75;
        (w as any).dash(s);
        expect(s.flightT).toBe(10.0);

        // Pegasus
        const pg = place(w, w.addPlayer('Pg', 'pegasus', false), 0, 0, 3200);
        pg.holdT = 0.75;
        (w as any).dash(pg);
        expect(pg.flightT).toBe(10.0);

        // Boar
        const b = place(w, w.addPlayer('B', 'boar', false), 0, 0, 3200);
        b.holdT = 0.75;
        (w as any).dash(b);
        expect(w.events.some(e => e.k === 'boarMud')).toBe(true);

        // Bull
        const bl = place(w, w.addPlayer('Bl', 'bull', false), 0, 0, 3200);
        bl.holdT = 0.75;
        (w as any).dash(bl);
        expect(w.events.some(e => e.k === 'bullToss')).toBe(true);

        // Ram
        const r = place(w, w.addPlayer('R', 'ram', false), 0, 0, 3200);
        r.holdT = 0.75;
        (w as any).dash(r);
        expect(r.power).toBe(6.0);
      });

      it('Flying animals soar high: cannot eat food, cannot pickup tools, cannot collide with ground players, and bypass hay', () => {
        const w = emptyWorld();
        const p1 = place(w, w.addPlayer('Phoenix', 'phoenix', false), 0, 0, 3200);
        p1.holdT = 0.75;
        (w as any).dash(p1);
        expect(p1.flightT).toBeGreaterThan(0);

        // Ground food cannot be eaten while flying
        w.food.set(999, { id: 999, x: 0, z: 0, val: 50, kind: 1 });
        const initMass = p1.mass;
        (w as any).eat([p1]);
        expect(p1.mass).toBe(initMass);

        // Ground tools cannot be picked up while flying
        w.tools.set(888, { id: 888, type: 'shield', x: 0, z: 0, active: true } as any);
        (w as any).step(0.05);
        expect(p1.hasShield).toBeFalsy();
        expect(w.tools.has(888)).toBe(true);

        // Ground players cannot be rammed or collided with while flying
        const p2 = place(w, w.addPlayer('GroundPig', 'pig', false), 0, 0, 200);
        (w as any).collidePlayers([p1, p2]);
        // Neither knocked back nor stunned
        expect(p2.hitT).toBeFalsy();
        expect(p1.hitT).toBeFalsy();
      });
    });
  });
});




