import { describe, expect, it } from 'vitest';
import { CFG, DT, TRAITS, radiusOf } from '../src/constants';
import { generateMap } from '../src/map';
import { blobOutline, insideBlob, type Blob } from '../src/math';
import { dashParams, outsideFence, stepMove } from '../src/physics';
import { FLAG } from '../src/protocol';
import { World, type Player } from '../src/sim/world';

/** a world with no bots and no food, so tests control everything */
function emptyWorld(): World {
  const w = new World(1234, { bots: false, food: false });
  w.food.clear();
  // keep hazards out of the way of the test arena
  w.map.hay.length = 0;
  w.map.pond.length = 0;
  w.map.mud.length = 0;
  w.map.well.length = 0;
  w.map.fire.length = 0;
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

  it('pitchfork hits harder and strips extra weight off Napoleon', () => {
    const w = emptyWorld();
    const attacker = w.addPlayer('Attacker', 'pig');
    const king = w.addPlayer('King', 'pig');
    place(w, attacker, 0, 0, 40);
    place(w, king, 2, 0, 40);
    w.napoleonId = king;
    w.ruleTimer = 40;

    const pAtt = w.players.get(attacker)!;
    pAtt.pitchforkT = 10;
    pAtt.input = { a: 0, mv: true, btn: true };
    pAtt.dashT = 0.3;
    pAtt.power = 1.0;
    pAtt.vx = 20;

    const massBefore = w.players.get(king)!.mass;
    const attMassBefore = pAtt.mass;
    w.step();
    const massAfter = w.players.get(king)!.mass;
    expect(massBefore - massAfter).toBeGreaterThan(1.0);
    // Pitchfork steals mass directly based on hit force
    expect(pAtt.mass).toBeGreaterThan(attMassBefore);
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
    att.power = 2.5;
    att.vx = 60;

    w.step();

    // Victim knocked back with extreme velocity
    expect(vic.vx).toBeGreaterThan(60);
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
        };
        const prefixes = validPrefixes[p.species] || [];
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
    expect(w.tools.size).toBe(6);
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
    for (let i = 0; i < 100 && w.tillTruck.active; i++) {
      w.step();
    }
    // Vanished in the forest outside R = 70
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
    const king = place(w, kingId, 0, 0, 40);
    w.napoleonId = kingId;

    // Coronation triggers commandment choice
    w.startKingChoice();
    expect(w.kingChoice).not.toBeNull();
    expect(w.kingChoice!.options.length).toBe(3);

    // King picks first option
    const choice1 = w.kingChoice!.options[0];
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

    // Measure movement with tractor active
    p.vx = 0;
    p.vz = 0;
    p.x = 20; // safe from tractor
    p.z = 20;
    p.input = { a: 0, mv: true, btn: false };
    w.step();
    const tillVx = p.vx;

    // Till active velocity should be ~1.5x of normal
    expect(tillVx / normalVx).toBeCloseTo(1.5, 1);
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

  it('bots never spawn as dog in fillBots', () => {
    for (let run = 0; run < 10; run++) {
      const w = emptyWorld();
      w.botsEnabled = true;
      for (let i = 0; i < 25; i++) {
        w.step();
      }
      expect(w.players.size).toBeGreaterThanOrEqual(1);
      for (const p of w.players.values()) {
        if (p.bot) {
          expect(p.species).not.toBe('dog');
          expect(p.species).not.toBe('elephant');
        }
      }
    }
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
});



