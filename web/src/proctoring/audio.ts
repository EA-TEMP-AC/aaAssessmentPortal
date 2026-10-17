import { PROCTOR_THRESHOLDS, type ProctorThresholds } from "./config";

/**
 * X-14. Measures how loud the room is, so the rules can tell that someone is talking. Only a
 * loudness number is kept: the sound is never recorded, stored or sent, and no words are
 * recognised. It cannot tell whose voice it is or what was said.
 */

export type VoiceMeter = {
  /** Loudness 0 to 1 with the room's quiet level taken out: 0 when the room is just quiet or steady noise. */
  read: () => number;
  release: () => void;
};

/** How slowly the quiet level follows the room. A few seconds of talking barely moves it. */
const FLOOR_RATE = 0.01;

/** Root mean square of a block of samples (-1 to 1). */
export function rms(samples: ArrayLike<number>): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) sum += samples[i] * samples[i];
  return Math.sqrt(sum / samples.length);
}

export function nextFloor(floor: number | null, level: number): number {
  return floor === null ? level : floor + (level - floor) * FLOOR_RATE;
}

/** The loudness to hand to the rules: the level itself when well above the quiet level, else 0. */
export function voiceSignal(level: number, floor: number, thresholds: ProctorThresholds = PROCTOR_THRESHOLDS): number {
  return level >= floor * thresholds.voiceFloorFactor ? level : 0;
}

type AudioContextLike = {
  createMediaStreamSource: (stream: MediaStream) => { connect: (node: unknown) => void; disconnect: () => void };
  createAnalyser: () => { fftSize: number; getFloatTimeDomainData: (array: Float32Array) => void };
  close: () => Promise<void>;
};

/** A meter on the stream's audio, or null when the stream has no live audio or the browser has no Web Audio. */
export function createVoiceMeter(
  stream: MediaStream,
  thresholds: ProctorThresholds = PROCTOR_THRESHOLDS,
  makeContext: () => AudioContextLike | null = () => {
    const Ctor =
      globalThis.AudioContext ??
      (globalThis as unknown as { webkitAudioContext?: new () => AudioContext }).webkitAudioContext;
    return Ctor ? (new Ctor() as unknown as AudioContextLike) : null;
  },
): VoiceMeter | null {
  if (!stream.getAudioTracks().some((t) => t.readyState === "live")) return null;
  let context: AudioContextLike | null = null;
  try {
    context = makeContext();
    if (!context) return null;
    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    // Not connected to the speakers: nothing is played back.
    source.connect(analyser);
    const buffer = new Float32Array(analyser.fftSize);
    let floor: number | null = null;
    return {
      read() {
        analyser.getFloatTimeDomainData(buffer);
        const level = rms(buffer);
        const signal = floor === null ? 0 : voiceSignal(level, floor, thresholds);
        floor = nextFloor(floor, level);
        return signal;
      },
      release() {
        try {
          source.disconnect();
        } catch {
          // Already disconnected.
        }
        void context?.close().catch(() => {});
      },
    };
  } catch {
    void context?.close().catch(() => {});
    return null;
  }
}
