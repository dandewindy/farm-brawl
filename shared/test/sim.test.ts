import { describe, expect, it } from 'vitest';
import { CFG, DT, radiusOf } from '../src/constants';
import { generateMap } from '../src/map';
import { blobOutline, insideBlob, type Blob } from '../src/math';
import { dashParams, outsideFence, stepMove } from '../src/physics';
import { World, type Player } from '../src/sim/world';

/** a world with no bots and no food, so tests control everything */
function emptyWorld(): World {
  const w = new World(1234, { bots: false });
  w.food.clear();
  // keep hazards out of the way of the test arena
  w.map.hay.length = 0;
  w.map.pond.length = 0;
  w.map.mud.length = 0;
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
    for (let s = 0; s < 20; s++) {
      const m = generateMap(s);
      for (const [x, z, r] of [...m.pond, ...m.mud]) expect(Math.hypot(x, z) + r * 1.3).toBeLessThan(CFG.R);
      for (const [x, z, r] of m.hay) expect(Math.hypot(x, z) + r).toBeLessThan(CFG.R);
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
    for (let i = 0; i < 10 && !hit; i++) {
      w.step();
      const snap = w.snapshotFor(a);
      hit = snap.ev.some((e) => e.k === 'hit' && e.a === a && e.v === b);
      w.flush();
    }
    expect(hit).toBe(true);
    const vic = w.players.get(b)!;
    expect(vic.vx).toBeGreaterThan(10);
    expect(vic.stunT).toBeGreaterThan(0);
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

  it('pitchfork hits harder and strips extra weight off Napoleon', () => {
    const w = emptyWorld();
    const attacker = w.addPlayer('Attacker', 'pig');
    const king = w.addPlayer('King', 'pig');
    place(w, attacker, 0, 0, 40);
    place(w, king, 2, 0, 40);
    w.napoleonId = king;

    const pAtt = w.players.get(attacker)!;
    pAtt.pitchforkT = 10;
    pAtt.input = { a: 0, mv: true, btn: true };
    pAtt.dashT = 0.3;
    pAtt.power = 1.0;
    pAtt.vx = 20;

    const massBefore = w.players.get(king)!.mass;
    w.step();
    const massAfter = w.players.get(king)!.mass;
    expect(massBefore - massAfter).toBeGreaterThan(1.0);
  });

  it('dynamite explodes on hit and knocks back bystanders', () => {
    const w = emptyWorld();
    const attId = w.addPlayer('Bomber', 'pig');
    const vicId = w.addPlayer('Victim', 'pig');
    const byId = w.addPlayer('Bystander', 'pig');
    place(w, attId, 0, 0, 30);
    place(w, vicId, 2, 0, 30);
    place(w, byId, 1, 3, 30);

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
});
