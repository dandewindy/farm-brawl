import { describe, it, expect } from 'vitest';
import { ClientPredictor } from '../src/game/pred';

describe('ClientPredictor flight mechanics', () => {
  it('decrements flightT and flyT simultaneously so flyT reaches 0 upon landing', () => {
    const pred = new ClientPredictor();
    pred.reset(0, 0);
    pred.on = true;
    pred.flightT = 10.0;
    pred.flyT = 10.0;

    const dummyMap: any = {
      w: 200,
      h: 200,
      pond: [],
      mud: [],
      mudGiant: [],
      rocks: [],
      bushes: [],
      ice: [],
      fire: [],
      electricFence: [],
      hay: [],
      podium: [0, 0],
    };

    // Simulate 10 seconds of movement steps
    const dt = 1 / 30;
    const ticks = Math.ceil(10.0 / dt) + 2;
    for (let i = 0; i < ticks; i++) {
      pred.step(
        dt,
        i * dt,
        'swan',
        0,
        100,
        false,
        0,
        false,
        dummyMap,
        new Map(),
        1,
        0,
        50
      );
    }

    expect(pred.flightT).toBe(0);
    expect(pred.flyT).toBe(0);
    expect(pred.flightCd).toBeGreaterThan(0);
  });
});
