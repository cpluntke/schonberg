// Init script: a fake microphone made of (a) an oscillator we control (window.__voice(midi|null))
// and (b) an echo of everything the app plays, delayed by window.__echo(sec). No app code changed.
(() => {
  const Orig = window.AudioContext;
  let rig = null;
  function build(ctx) {
    if (rig && rig.ctx === ctx) return rig;
    const dest = ctx.createMediaStreamDestination();
    const echoIn = ctx.createGain(); echoIn.gain.value = 1.2;
    const delay = ctx.createDelay(6); delay.delayTime.value = 2.8;
    const osc = ctx.createOscillator(); osc.type = 'sawtooth';
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1200;
    const og = ctx.createGain(); og.gain.value = 0;
    const vib = ctx.createOscillator(); vib.frequency.value = 5; const vg = ctx.createGain(); vg.gain.value = 0;
    vib.connect(vg); vg.connect(osc.frequency);
    osc.connect(lp); lp.connect(og); og.connect(dest);
    echoIn._fake = delay._fake = og._fake = lp._fake = 1;
    origConnect.call(echoIn, delay); origConnect.call(delay, dest);
    osc.start(); vib.start();
    rig = { ctx, dest, echoIn, delay, osc, og, vg };
    return rig;
  }
  const origConnect = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function (target, ...rest) {
    const r = origConnect.call(this, target, ...rest);
    try {
      if (target instanceof AudioDestinationNode && !this._fake && !(this instanceof GainNode && this.gain.value === 0)) {
        const g = build(this.context);
        origConnect.call(this, g.echoIn);
      }
    } catch (e) { console.warn('fakemic', e); }
    return r;
  };
  window.AudioContext = class extends Orig {
    constructor(...a) { super(...a); window.__ctx = this; build(this); }
  };
  window.webkitAudioContext = window.AudioContext;
  const md = navigator.mediaDevices;
  md.getUserMedia = async () => { const c = window.__ctx || new window.AudioContext(); return build(c).dest.stream; };
  window.__voice = (midi, vibrato = 0) => {
    const c = window.__ctx || new window.AudioContext(); const g = build(c);
    if (midi == null) { g.og.gain.setTargetAtTime(0, c.currentTime, 0.02); return; }
    g.osc.frequency.setValueAtTime(440 * Math.pow(2, (midi - 69) / 12), c.currentTime);
    g.vg.gain.value = vibrato; g.og.gain.setTargetAtTime(0.5, c.currentTime, 0.02);
  };
  window.__echo = (sec) => { const c = window.__ctx || new window.AudioContext(); build(c).delay.delayTime.value = sec; };
  window.__echoGain = (v) => { const c = window.__ctx || new window.AudioContext(); build(c).echoIn.gain.value = v; };
})();
