import gsap from "gsap";
import { Scene } from "./scene";
import { World } from "./world";

// Moves through the scenes. One GSAP timeline per scene = the transition into it.
//  - next:  play the next scene's timeline (finishing the current one first)
//  - back:  reverse the timeline that brought us here, even mid-transition
//  - skip:  jump the running transition to its end state
//  - jump:  rewind everything to the start, then fast-forward to scene k
// index = the scene we are in or heading to. -1 = the dark pre-roll before scene 1.

// Global playback speed for every transition. 1 = as authored, higher = faster.
// Phone clips still play in real time; scenes that sync to a clip use clipTime().
export const SPEED = 1.35;
export const clipTime = (seconds: number) => seconds * SPEED;

export type DeckState = { index: number; count: number; playing: boolean };

export class Director {
  index = -1;
  private tls: (gsap.core.Timeline | undefined)[] = [];
  private active: gsap.core.Timeline | null = null;
  private listeners: ((s: DeckState) => void)[] = [];

  constructor(private w: World, readonly scenes: Scene[]) {
    for (const s of scenes) s.init(w);
  }

  onChange(fn: (s: DeckState) => void) {
    this.listeners.push(fn);
    fn(this.state());
  }

  state(): DeckState {
    return { index: this.index, count: this.scenes.length, playing: !!this.active?.isActive() };
  }

  next() {
    const a = this.active;
    if (a && a.reversed() && a.progress() > 0) {
      // We were going back; turn around and finish the scene we just left.
      this.index++;
      a.timeScale(SPEED).play();
      return this.emit();
    }
    if (a && !a.reversed() && a.progress() < 1) a.progress(1);
    if (this.index >= this.scenes.length - 1) return this.emit();
    this.index++;
    const tl = this.build(this.index);
    this.active = tl;
    tl.play(0);
    this.emit();
  }

  back() {
    const a = this.active;
    if (a && a.reversed()) a.progress(0); // already going back: land there instantly, then keep going
    if (this.index < 0) return this.emit();
    const tl = this.tls[this.index];
    this.index--;
    if (!tl) return this.emit();
    this.active = tl;
    tl.timeScale(SPEED * 1.6).reverse(); // backing up is faster than going forward
    this.emit();
  }

  skip() {
    const a = this.active;
    if (!a) return;
    a.progress(a.reversed() ? 0 : 1);
    if (!a.reversed() && this.index >= 0) this.scenes[this.index].settle?.(this.w);
    this.emit();
  }

  jump(k: number) {
    k = Math.max(-1, Math.min(k, this.scenes.length - 1));
    // Rewind every built timeline (newest first) so the world is back at the pre-roll.
    for (let i = this.tls.length - 1; i >= 0; i--) {
      this.tls[i]?.progress(0).kill();
    }
    this.tls = [];
    // Fast-forward scene by scene so each timeline records the right starting values.
    for (let i = 0; i <= k; i++) this.build(i).progress(1);
    for (let i = 0; i <= k; i++) this.scenes[i].settle?.(this.w);
    this.index = k;
    this.active = null;
    this.emit();
  }

  private build(i: number) {
    this.tls[i]?.kill();
    const tl = gsap.timeline({ paused: true, defaults: { ease: "power3.inOut", duration: 1.2 }, onComplete: () => this.emit(), onReverseComplete: () => this.emit() });
    const prev = this.scenes[i - 1];
    if (prev && prev.texts.length) tl.to(prev.texts, { autoAlpha: 0, y: -16, duration: 0.45, ease: "power2.in", stagger: 0.04 }, 0);
    this.scenes[i].build(this.w, tl);
    tl.timeScale(SPEED);
    this.tls[i] = tl;
    return tl;
  }

  private emit() {
    const s = this.state();
    for (const fn of this.listeners) fn(s);
  }
}
