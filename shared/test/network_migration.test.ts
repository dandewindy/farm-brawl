import { describe, expect, it } from 'vitest';
import {
  getColoTier,
  isFastColo,
  isOptimalSeaColo,
  computeRttStats,
  evaluateMigrationDecision,
  LOAD_HANDICAP_MS,
  HIGH_PING_THRESHOLD_MS,
} from '../../client/src/net/ws';

describe('Network Colo Tier Classification', () => {
  it('classifies SEA core colos as Tier 0', () => {
    expect(getColoTier('SIN')).toBe(0);
    expect(getColoTier('HKG')).toBe(0);
    expect(getColoTier('HAN')).toBe(0);
    expect(getColoTier('SGN')).toBe(0);
    expect(getColoTier('DAD')).toBe(0);
    expect(getColoTier('BKK')).toBe(0);
    expect(getColoTier('KUL')).toBe(0);
    expect(isOptimalSeaColo('SIN')).toBe(true);
    expect(isFastColo('SIN')).toBe(true);
  });

  it('classifies East Asia / APAC colos as Tier 1', () => {
    expect(getColoTier('NRT')).toBe(1);
    expect(getColoTier('HND')).toBe(1);
    expect(getColoTier('KIX')).toBe(1);
    expect(getColoTier('ICN')).toBe(1);
    expect(getColoTier('TPE')).toBe(1);
    expect(isOptimalSeaColo('NRT')).toBe(false);
    expect(isFastColo('NRT')).toBe(true);
  });

  it('classifies European and American colos as Tier 2', () => {
    expect(getColoTier('CDG')).toBe(2);
    expect(getColoTier('FRA')).toBe(2);
    expect(getColoTier('LHR')).toBe(2);
    expect(getColoTier('SJC')).toBe(2);
    expect(getColoTier('IAD')).toBe(2);
    expect(isFastColo('FRA')).toBe(false);
    expect(isOptimalSeaColo('FRA')).toBe(false);
  });
});

describe('computeRttStats', () => {
  it('calculates median, min, and IQR jitter correctly', () => {
    const window = [30, 32, 35, 40, 42, 45, 50, 60];
    const stats = computeRttStats(window);
    expect(stats.min).toBe(30);
    expect(stats.samples).toBe(8);
    // mid index 4 -> median of 40 and 42 is 41
    expect(stats.median).toBe(41);
    // q25 = sorted[2] = 35, q75 = sorted[6] = 50 -> jitter = 15
    expect(stats.jitter).toBe(15);
  });
});

describe('evaluateMigrationDecision (Anti-Migration Storm & Auto-switch > 90ms)', () => {
  it('rejects if insufficient probe samples (< 4)', () => {
    const activeWin = [105, 108, 110, 112, 115];
    const probeWin = [35, 36, 38];
    const decision = evaluateMigrationDecision(activeWin, 'SIN', probeWin, 'SIN');
    expect(decision.shouldSwitch).toBe(false);
    expect(decision.reason).toBe('insufficient_probe_samples');
  });

  it('rejects tier regression (Tier 0/1 to Tier 2)', () => {
    const activeWin = [95, 96, 98, 100, 102];
    const probeWin = [180, 185, 190, 195, 200, 205];
    const decision = evaluateMigrationDecision(activeWin, 'SIN', probeWin, 'FRA');
    expect(decision.shouldSwitch).toBe(false);
    expect(decision.reason).toContain('tier_regression');
  });

  it('upgrades Tier 2 (Europe) to Tier 0 (SIN) with net gain >= 10ms', () => {
    const activeWin = [240, 245, 250, 255, 260];
    const probeWin = [32, 34, 35, 36, 38, 40]; // raw median 35.5 -> eff median 36 + 12 = 48ms
    const decision = evaluateMigrationDecision(activeWin, 'FRA', probeWin, 'SIN');
    expect(decision.shouldSwitch).toBe(true);
    expect(decision.reason).toContain('tier_upgrade');
  });

  it('upgrades Tier 1 (Japan NRT) to Tier 0 (SIN) when gain >= 10ms', () => {
    const activeWin = [100, 102, 105, 108, 110]; // NRT ping ~106ms
    const probeWin = [30, 32, 33, 35, 36, 38]; // SIN ping ~34ms + 12ms = 46ms
    const decision = evaluateMigrationDecision(activeWin, 'NRT', probeWin, 'SIN');
    expect(decision.shouldSwitch).toBe(true);
    expect(decision.reason).toContain('tier_upgrade');
  });

  it('Same-Colo Guard: rejects minor noise (e.g. 10ms difference on SIN -> SIN due to idle socket)', () => {
    const activeWin = [92, 94, 96, 98, 100]; // active 96ms on SIN
    const probeWin = [78, 80, 82, 84, 85, 86]; // probe raw 83ms -> effective 83 + 12 = 95ms
    const decision = evaluateMigrationDecision(activeWin, 'SIN', probeWin, 'SIN');
    expect(decision.shouldSwitch).toBe(false);
    expect(decision.reason).toContain('same_colo_noise_filtered');
  });

  it('Same-Colo Guard: accepts real ECMP unjamming when gain >= 25ms and <= 78% RTT', () => {
    const activeWin = [130, 135, 140, 142, 145]; // active stuck in congested ECMP queue ~140ms
    const probeWin = [32, 34, 35, 36, 38, 40]; // new 5-tuple connects with raw ~36ms -> effective 48ms
    const decision = evaluateMigrationDecision(activeWin, 'SIN', probeWin, 'SIN');
    expect(decision.shouldSwitch).toBe(true);
    expect(decision.reason).toContain('same_colo_ecmp_recovery');
  });

  it('Cross-Colo in Tier 0: switches when ping > 90ms and candidate reaches <= 90ms with gain >= 15ms', () => {
    const activeWin = [98, 100, 102, 104, 106]; // active on HKG ~102ms
    const probeWin = [32, 33, 35, 36, 38, 40]; // candidate on SIN ~36ms (raw <= 90ms, eff 48ms, gain 54ms)
    const decision = evaluateMigrationDecision(activeWin, 'HKG', probeWin, 'SIN');
    expect(decision.shouldSwitch).toBe(true);
    expect(decision.reason).toContain('cross_colo_improvement');
  });
});
