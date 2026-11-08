export class SuitAudio {
  constructor() {
    this.enabled = true;
    this.context = null;
  }
  start() {
    if (!this.enabled) return;
    try {
      if (!this.context) {
        const Context = window.AudioContext || window.webkitAudioContext;
        if (!Context) return;
        this.context = new Context();
        const ctx = this.context;
        this.master = ctx.createGain();
        this.master.gain.value = 0.4;
        this.master.connect(ctx.destination);
        const data = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
        const channel = data.getChannelData(0);
        for (let i = 0; i < channel.length; i++)
          channel[i] = Math.random() * 2 - 1;
        const noise = ctx.createBufferSource();
        noise.buffer = data;
        noise.loop = true;
        const filter = ctx.createBiquadFilter();
        filter.type = "bandpass";
        filter.frequency.value = 1400;
        this.hiss = ctx.createGain();
        this.hiss.gain.value = 0;
        noise.connect(filter).connect(this.hiss).connect(this.master);
        noise.start();
        const motor = ctx.createOscillator();
        motor.type = "triangle";
        motor.frequency.value = 75;
        this.thrust = ctx.createGain();
        this.thrust.gain.value = 0;
        motor.connect(this.thrust).connect(this.master);
        motor.start();
      }
      this.context.resume()?.catch(() => {});
    } catch {
      this.enabled = false;
    }
  }
  update(s, active) {
    if (!this.context) return;
    const now = this.context.currentTime;
    this.master.gain.setTargetAtTime(this.enabled ? 0.4 : 0, now, 0.1);
    this.hiss.gain.setTargetAtTime(
      active ? s.leak * 0.08 + 0.012 * (1 + Math.sin(s.time * 1.3)) : 0,
      now,
      0.15,
    );
    this.thrust.gain.setTargetAtTime(
      active && (s.boosting || s.braking) ? 0.06 : 0,
      now,
      0.1,
    );
  }
  tone(kind = "good") {
    if (!this.context || !this.enabled) return;
    const ctx = this.context,
      o = ctx.createOscillator(),
      g = ctx.createGain();
    o.type = kind === "hit" ? "triangle" : "sine";
    o.frequency.setValueAtTime(
      kind === "hit" ? 120 : kind === "warn" ? 330 : 700,
      ctx.currentTime,
    );
    o.frequency.exponentialRampToValueAtTime(
      kind === "hit" ? 55 : kind === "warn" ? 240 : 950,
      ctx.currentTime + 0.15,
    );
    g.gain.setValueAtTime(0.1, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
    o.connect(g).connect(this.master);
    o.start();
    o.stop(ctx.currentTime + 0.3);
  }
}
