// Web Audio API 기반 아케이드 효과음 및 모바일 햅틱 진동 컨트롤러.
// 외부 음원 파일 없이 오실레이터 신디사이저로 즉각적인 타격감을 생성한다.

const SOUND_MUTE_STORAGE_KEY = 'coffeebet_sound_muted';
const PIN_HIT_THROTTLE_MS = 45;
const BUMPER_HIT_THROTTLE_MS = 60;
const BOOST_THROTTLE_MS = 120;
const JUMP_THROTTLE_MS = 150;
const SLOWMO_THROTTLE_MS = 600;

export class SoundController {
  private ctx: AudioContext | null = null;
  private muted: boolean;
  private lastPinHitAt = 0;
  private lastBumperHitAt = 0;
  private lastBoostAt = 0;
  private lastJumpAt = 0;
  private lastSlowMoAt = 0;

  constructor() {
    let savedMuted = false;
    try {
      if (typeof localStorage !== 'undefined') {
        savedMuted = localStorage.getItem(SOUND_MUTE_STORAGE_KEY) === 'true';
      }
    } catch {
      savedMuted = false;
    }
    this.muted = savedMuted;
  }

  /** 음소거 여부를 반환한다. */
  isMuted(): boolean {
    return this.muted;
  }

  /** 음소거 상태를 변경하고 로컬 스토리지에 저장한다. */
  setMuted(muted: boolean): void {
    this.muted = muted;
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(SOUND_MUTE_STORAGE_KEY, muted ? 'true' : 'false');
      }
    } catch {
      /* 저장 불가 환경 무시 */
    }
    if (!muted) {
      this.unlock();
    }
  }

  /** 브라우저 오디오 컨텍스트 잠금을 해제한다. */
  unlock(): void {
    this.ensureContext();
  }

  /** AudioContext 인스턴스를 확보하고 일시중지 상태를 재개한다. */
  private ensureContext(): AudioContext | null {
    if (this.muted || typeof window === 'undefined') return null;
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return null;

    try {
      if (!this.ctx) {
        this.ctx = new AudioCtx();
      }
      if (this.ctx.state === 'suspended') {
        void this.ctx.resume();
      }
      return this.ctx;
    } catch {
      return null;
    }
  }

  /** 모바일 진동 피드백을 안전하게 실행한다. */
  private vibrate(pattern: number | number[]): void {
    if (this.muted) return;
    try {
      if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        navigator.vibrate(pattern);
      }
    } catch {
      /* 진동 미지원 환경 무시 */
    }
  }

  /** 핀 충돌음: 600~1100Hz 범위의 경쾌하고 짧은 핍 사운드 */
  playPinHit(): void {
    const nowMs = performance.now();
    if (nowMs - this.lastPinHitAt < PIN_HIT_THROTTLE_MS) return;
    const ctx = this.ensureContext();
    if (!ctx) return;
    this.lastPinHitAt = nowMs;

    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const freq = 600 + Math.random() * 500;

    osc.type = Math.random() > 0.5 ? 'sine' : 'triangle';
    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(300, freq * 0.72), t + 0.045);

    gain.gain.setValueAtTime(0.055, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.05);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.055);
  }

  /** 팝 범퍼 타격음: 180Hz -> 520Hz 피치 업 + 공명 킥 */
  playBumperHit(): void {
    const nowMs = performance.now();
    if (nowMs - this.lastBumperHitAt < BUMPER_HIT_THROTTLE_MS) return;
    this.lastBumperHitAt = nowMs;
    this.vibrate(20);

    const ctx = this.ensureContext();
    if (!ctx) return;

    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const harmonic = ctx.createOscillator();
    const gain = ctx.createGain();
    const harmonicGain = ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(180, t);
    osc.frequency.exponentialRampToValueAtTime(520, t + 0.11);

    harmonic.type = 'sine';
    harmonic.frequency.setValueAtTime(760, t);
    harmonic.frequency.exponentialRampToValueAtTime(380, t + 0.14);

    gain.gain.setValueAtTime(0.16, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.15);

    harmonicGain.gain.setValueAtTime(0.07, t);
    harmonicGain.gain.exponentialRampToValueAtTime(0.001, t + 0.14);

    osc.connect(gain);
    harmonic.connect(harmonicGain);
    gain.connect(ctx.destination);
    harmonicGain.connect(ctx.destination);

    osc.start(t);
    harmonic.start(t);
    osc.stop(t + 0.16);
    harmonic.stop(t + 0.15);
  }

  /** 부스터 존 통과음: 300Hz -> 1200Hz 고속 톱니파 스윕 */
  playBoost(): void {
    const nowMs = performance.now();
    if (nowMs - this.lastBoostAt < BOOST_THROTTLE_MS) return;
    this.lastBoostAt = nowMs;
    this.vibrate(15);

    const ctx = this.ensureContext();
    if (!ctx) return;

    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(300, t);
    osc.frequency.exponentialRampToValueAtTime(1200, t + 0.18);

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(900, t);
    filter.frequency.exponentialRampToValueAtTime(3200, t + 0.18);

    gain.gain.setValueAtTime(0.09, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.2);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);

    osc.start(t);
    osc.stop(t + 0.21);
  }

  /** 점프 패드 발동음: 220Hz -> 880Hz 탄력있는 스프링 바운스 */
  playJumpPad(): void {
    const nowMs = performance.now();
    if (nowMs - this.lastJumpAt < JUMP_THROTTLE_MS) return;
    this.lastJumpAt = nowMs;
    this.vibrate([25, 20, 35]);

    const ctx = this.ensureContext();
    if (!ctx) return;

    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(220, t);
    osc.frequency.exponentialRampToValueAtTime(880, t + 0.22);

    // 스프링 느낌의 빠른 떨림 변조
    lfo.type = 'sine';
    lfo.frequency.setValueAtTime(28, t);
    lfoGain.gain.setValueAtTime(45, t);
    lfo.connect(lfoGain);
    lfoGain.connect(osc.frequency);

    gain.gain.setValueAtTime(0.14, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.25);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(t);
    lfo.start(t);
    osc.stop(t + 0.26);
    lfo.stop(t + 0.26);
  }

  /** 역전 슬로우모션 돌입음: 240Hz -> 90Hz 서브베이스 드롭 */
  playSlowMo(): void {
    const nowMs = performance.now();
    if (nowMs - this.lastSlowMoAt < SLOWMO_THROTTLE_MS) return;
    this.lastSlowMoAt = nowMs;

    const ctx = this.ensureContext();
    if (!ctx) return;

    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(240, t);
    osc.frequency.exponentialRampToValueAtTime(90, t + 0.38);

    gain.gain.setValueAtTime(0.18, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.42);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(t);
    osc.stop(t + 0.43);
  }

  /** 단두대 매치 / 클라이맥스 돌입 알림 사이렌 (듀얼 톤 660Hz / 880Hz) */
  playClimaxAlert(): void {
    this.vibrate([30, 40, 30]);
    const ctx = this.ensureContext();
    if (!ctx) return;

    const t = ctx.currentTime;
    const notes = [660, 880, 660, 880];
    notes.forEach((freq, i) => {
      const start = t + i * 0.11;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, start);

      gain.gain.setValueAtTime(0.11, start);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.1);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.105);
    });
  }

  /** 결승 통과 또는 최종 당첨 확정 효과음 */
  playFinish(isFinal: boolean): void {
    if (isFinal) {
      this.vibrate([40, 30, 80]);
    } else {
      this.vibrate(25);
    }

    const ctx = this.ensureContext();
    if (!ctx) return;

    const t = ctx.currentTime;
    // 일반 통과: 밝은 C 메이저 아르페지오 / 최종 확정: 드라마틱한 결승 팡파르
    const freqs = isFinal ? [523.25, 659.25, 783.99, 1046.5] : [523.25, 659.25, 783.99];
    const step = isFinal ? 0.085 : 0.065;

    freqs.forEach((freq, i) => {
      const start = t + i * step;
      const duration = isFinal && i === freqs.length - 1 ? 0.45 : 0.18;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = isFinal ? 'triangle' : 'sine';
      osc.frequency.setValueAtTime(freq, start);

      gain.gain.setValueAtTime(isFinal ? 0.13 : 0.09, start);
      gain.gain.exponentialRampToValueAtTime(0.001, start + duration);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + duration + 0.02);
    });
  }

  /** 오디오 컨텍스트 리소스를 정리한다. */
  dispose(): void {
    if (this.ctx) {
      try {
        void this.ctx.close();
      } catch {
        /* 이미 닫힌 경우 무시 */
      }
      this.ctx = null;
    }
  }
}
