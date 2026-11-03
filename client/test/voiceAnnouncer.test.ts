import { describe, it, expect, vi, beforeEach } from 'vitest';
import { voiceAnnouncer, ENABLE_VOICE_ANNOUNCER } from '../src/audio/voiceAnnouncer';

describe('VoiceAnnouncer (Decoupled Module)', () => {
  beforeEach(() => {
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

  it('triggers only on high-impact events and ignores minor combat noise', () => {
    const playSpy = vi.spyOn(voiceAnnouncer, 'play').mockImplementation(() => {});

    // 1. Minor events (hit, join, leave, normal bot death) -> MUST BE IGNORED
    voiceAnnouncer.handleEvent({ k: 'hit', a: 1, v: 2, x: 0, z: 0, s: 20 }, { myId: 1, napoleonId: 3 });
    voiceAnnouncer.handleEvent({ k: 'join', id: 5, name: 'Bot', species: 'pig', skin: 0, bot: true }, { myId: 1, napoleonId: 3 });
    voiceAnnouncer.handleEvent({ k: 'leave', id: 5 }, { myId: 1, napoleonId: 3 });
    voiceAnnouncer.handleEvent(
      { k: 'die', id: 4, by: 2, cause: 'fence', x: 0, z: 0, mass: 30, best: 30, kills: 0, alive: 5, spoils: 10, streak: 1 },
      { myId: 1, napoleonId: 3 }
    );
    expect(playSpy).not.toHaveBeenCalled();

    // 2. Player becomes King -> Priority 1 'king_you'
    voiceAnnouncer.handleEvent({ k: 'napoleon', id: 1 }, { myId: 1, napoleonId: 1 });
    expect(playSpy).toHaveBeenCalledWith('king_you', 1);

    // 3. New Commandment Rule -> Priority 1 'rule_titan'
    voiceAnnouncer.handleEvent({ k: 'rule', id: 'titan' }, { myId: 1, napoleonId: 1 });
    expect(playSpy).toHaveBeenCalledWith('rule_titan', 1);

    // 4. Self Gorilla evolution -> Priority 1 'self_gorilla'
    voiceAnnouncer.handleEvent({ k: 'morph', id: 1, species: 'gorilla', dur: 0 }, { myId: 1, napoleonId: 2 });
    expect(playSpy).toHaveBeenCalledWith('self_gorilla', 1);

    // 5. Other player morph -> Ignored
    playSpy.mockClear();
    voiceAnnouncer.handleEvent({ k: 'morph', id: 2, species: 'gorilla', dur: 0 }, { myId: 1, napoleonId: 2 });
    expect(playSpy).not.toHaveBeenCalled();

    playSpy.mockRestore();
  });
});
