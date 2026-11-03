import { describe, it, expect, vi, beforeEach } from 'vitest';
import { voiceAnnouncer, ENABLE_VOICE_ANNOUNCER } from '../src/audio/voiceAnnouncer';
import type { PlayerMeta } from '@shared/protocol';

describe('VoiceAnnouncer (Decoupled Preemptive Module)', () => {
  beforeEach(() => {
    voiceAnnouncer.stopCurrent();
    voiceAnnouncer.setEnabled(true);
  });

  it('has master kill-switch enabled by default and allows toggling state', () => {
    expect(ENABLE_VOICE_ANNOUNCER).toBe(true);
    expect(voiceAnnouncer.isEnabled()).toBe(true);

    voiceAnnouncer.setEnabled(false);
    expect(voiceAnnouncer.isEnabled()).toBe(false);

    voiceAnnouncer.setEnabled(true);
    expect(voiceAnnouncer.isEnabled()).toBe(true);
  });

  it('plays welcome, special items, death causes with killer species, and KOs', () => {
    const playSpy = vi.spyOn(voiceAnnouncer, 'play').mockImplementation(() => {});
    const metas = new Map<number, PlayerMeta>([
      [1, { id: 1, name: 'Player', species: 'dog', skin: 0, bot: false }],
      [2, { id: 2, name: 'BotHeo', species: 'pig', skin: 0, bot: true }],
      [3, { id: 3, name: 'BotGa', species: 'chicken', skin: 0, bot: true }],
    ]);

    // 1. Welcome
    voiceAnnouncer.onWelcome();
    expect(playSpy).toHaveBeenCalledWith('welcome', 3);

    // 2. Special items (2-3 words)
    voiceAnnouncer.handleEvent({ k: 'tool', id: 1, kind: 'speed', x: 0, z: 0 }, { myId: 1, napoleonId: 0, metas });
    expect(playSpy).toHaveBeenCalledWith('item_speed', 3);

    voiceAnnouncer.handleEvent({ k: 'tool', id: 1, kind: 'dynamite', x: 0, z: 0 }, { myId: 1, napoleonId: 0, metas });
    expect(playSpy).toHaveBeenCalledWith('item_dynamite', 3);

    voiceAnnouncer.handleEvent({ k: 'tool', id: 1, kind: 'shield', x: 0, z: 0 }, { myId: 1, napoleonId: 0, metas });
    expect(playSpy).toHaveBeenCalledWith('item_shield', 3);

    // 3. Killed by another animal (Pig + fence -> die_pig_fence)
    voiceAnnouncer.handleEvent(
      { k: 'die', id: 1, by: 2, cause: 'fence', x: 0, z: 0, mass: 50, best: 50, kills: 1, alive: 10, spoils: 20, streak: 0 },
      { myId: 1, napoleonId: 0, metas }
    );
    expect(playSpy).toHaveBeenCalledWith('die_pig_fence', 1);

    // 4. Self death by hazard (by = 0, drown -> die_self_drown)
    voiceAnnouncer.handleEvent(
      { k: 'die', id: 1, by: 0, cause: 'drown', x: 0, z: 0, mass: 50, best: 50, kills: 1, alive: 10, spoils: 0, streak: 0 },
      { myId: 1, napoleonId: 0, metas }
    );
    expect(playSpy).toHaveBeenCalledWith('die_self_drown', 1);

    // 5. Player eliminates enemy Chicken (streak = 1 -> ko_chicken)
    voiceAnnouncer.handleEvent(
      { k: 'die', id: 3, by: 1, cause: 'fence', x: 0, z: 0, mass: 30, best: 30, kills: 0, alive: 5, spoils: 15, streak: 1 },
      { myId: 1, napoleonId: 0, metas }
    );
    expect(playSpy).toHaveBeenCalledWith('ko_chicken', 3);

    playSpy.mockRestore();
  });

  it('preempts lower or equal priority announcements and protects higher priority ones', () => {
    const stopSpy = vi.spyOn(voiceAnnouncer, 'stopCurrent');

    // Start playing a Priority 3 item voice
    voiceAnnouncer.play('item_speed', 3);
    expect(stopSpy).toHaveBeenCalledTimes(1);

    // A lower priority event (Priority 4 map_warn) arrives while Priority 3 is active -> ignored!
    voiceAnnouncer.play('map_warn', 4);
    expect(stopSpy).toHaveBeenCalledTimes(1); // Did NOT stop current!

    // An equal priority event (Priority 3 item_shield) arrives -> preempts!
    voiceAnnouncer.play('item_shield', 3);
    expect(stopSpy).toHaveBeenCalledTimes(2);

    // A higher priority event (Priority 1 die_pig_fence) arrives -> preempts!
    voiceAnnouncer.play('die_pig_fence', 1);
    expect(stopSpy).toHaveBeenCalledTimes(3);

    // While Priority 1 is active, Priority 2 (rule_titan) cannot interrupt it!
    voiceAnnouncer.play('rule_titan', 2);
    expect(stopSpy).toHaveBeenCalledTimes(3);

    stopSpy.mockRestore();
  });
});
