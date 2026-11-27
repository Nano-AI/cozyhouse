import type { VoiceProfile, WeatherDef } from '../data/schemas';

/**
 * Module boundary for Web Audio sound effects, weather ambience, and invented-language gibberish voice.
 *
 * Phase 1 defines the interface and mute state.
 * Phase 2 synthesizes cozy foley, ambient weather loops, and mood-driven gibberish speech.
 */
export class AudioModule {
  private muted = false;

  isMuted(): boolean {
    return this.muted;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
  }

  playPlace(): void {
    // Implemented in Phase 2
  }

  playRemove(): void {
    // Implemented in Phase 2
  }

  playInteract(_itemId: string): void {
    // Implemented in Phase 2
  }

  playGibberishLine(
    _text: string,
    _voice: VoiceProfile,
    _pitchOffset = 1,
    _speedMultiplier = 1,
  ): void {
    // Implemented in Phase 2
  }

  setWeatherAmbience(_weather: WeatherDef): void {
    // Implemented in Phase 2
  }

  dispose(): void {
    // Cleanup AudioContext in Phase 2
  }
}
