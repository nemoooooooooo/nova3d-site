// The dragon's spine as a plotted function.
//
// Every Segment_## empty already sits at a known distance along a straight
// spine, so the whole creature is driven by one scalar field:
//
//     offset(s, t) = f(s, t, params)
//
// Swap f and the animal changes character. Nothing here is baked; the page
// evaluates these functions every frame and re-places 25 rigid pieces.
import * as THREE from 'three';

// ── the function library ────────────────────────────────────────────────────
// `fn` is the REAL code the page runs each frame — the UI prints fn.toString(),
// so what you read is what is executing.
export const WAVES = {
  sine: {
    label: 'sine',
    eq: 'y = A · sin(k·s + ω·t + φ)',
    blurb: 'one travelling wave running head to tail — which is what pushes the animal forward',
    params: [
      {k: 'A', label: 'amplitude', min: 0, max: 0.5, step: 0.005, val: 0.22, unit: 'm'},
      {k: 'k', label: 'wavenumber', min: 0.5, max: 14, step: 0.1, val: 5.2, unit: 'rad/m'},
      {k: 'w', label: 'speed ω', min: 0, max: 10, step: 0.05, val: 3.1, unit: 'rad/s'},
      {k: 'phi', label: 'phase φ', min: 0, max: 6.283, step: 0.01, val: 0, unit: 'rad'},
    ],
    fn: (s, t, p) => p.A * Math.sin(p.k * s + p.w * t + p.phi),
  },

  damped: {
    label: 'damped sine (whip)',
    eq: 'y = A · e^(−λ·s) · sin(k·s + ω·t + φ)',
    blurb: 'the envelope decays along the body: calm head, thrashing tail — or flip λ negative',
    params: [
      {k: 'A', label: 'amplitude', min: 0, max: 0.8, step: 0.005, val: 0.42, unit: 'm'},
      {k: 'lam', label: 'damping λ', min: -2.5, max: 2.5, step: 0.02, val: 1.35, unit: '1/m'},
      {k: 'k', label: 'wavenumber', min: 0.5, max: 14, step: 0.1, val: 6.4, unit: 'rad/m'},
      {k: 'w', label: 'speed ω', min: 0, max: 12, step: 0.05, val: 4.2, unit: 'rad/s'},
      {k: 'phi', label: 'phase φ', min: 0, max: 6.283, step: 0.01, val: 0, unit: 'rad'},
    ],
    fn: (s, t, p) => p.A * Math.exp(-p.lam * s) * Math.sin(p.k * s + p.w * t + p.phi),
  },

  pulse: {
    label: 'travelling pulse',
    eq: 'y = A · exp( −(s + v·t)² / 2σ² )',
    blurb: 'a single Gaussian bump running down the body — it looks like it swallowed something',
    params: [
      {k: 'A', label: 'amplitude', min: 0, max: 0.6, step: 0.005, val: 0.3, unit: 'm'},
      {k: 'sig', label: 'width σ', min: 0.03, max: 0.6, step: 0.005, val: 0.16, unit: 'm'},
      {k: 'v', label: 'speed v', min: -2.5, max: 2.5, step: 0.02, val: 0.9, unit: 'm/s'},
      {k: 'reps', label: 'repeat every', min: 0.6, max: 4, step: 0.05, val: 2.2, unit: 'm'},
    ],
    fn: (s, t, p) => {
      let d = (s + p.v * t) % p.reps;             // wrap so it keeps coming
      if (d < -p.reps / 2) d += p.reps;
      if (d > p.reps / 2) d -= p.reps;
      return p.A * Math.exp(-(d * d) / (2 * p.sig * p.sig));
    },
  },

  square: {
    label: 'square / unit pulse',
    eq: 'y = A · tanh( β · sin(k·s + ω·t + φ) )',
    blurb: 'β sharpens a sine into a unit square — the body snaps between two offsets instead of flowing',
    params: [
      {k: 'A', label: 'amplitude', min: 0, max: 0.45, step: 0.005, val: 0.18, unit: 'm'},
      {k: 'beta', label: 'sharpness β', min: 1, max: 40, step: 0.5, val: 14, unit: ''},
      {k: 'k', label: 'wavenumber', min: 0.5, max: 12, step: 0.1, val: 4.0, unit: 'rad/m'},
      {k: 'w', label: 'speed ω', min: 0, max: 10, step: 0.05, val: 2.6, unit: 'rad/s'},
      {k: 'phi', label: 'phase φ', min: 0, max: 6.283, step: 0.01, val: 0, unit: 'rad'},
    ],
    fn: (s, t, p) => p.A * Math.tanh(p.beta * Math.sin(p.k * s + p.w * t + p.phi)),
  },
};

/**
 * Drives the 25 rigid segments + the head along the curve.
 *
 * Two things make it read as a creature rather than sliding parts:
 *   - pieces are placed by ARC LENGTH, so the spacing they were built with
 *     survives any amplitude (a wavy curve is longer than the straight line);
 *   - each piece is rotated onto the curve's TANGENT, so it swims instead of
 *     shuffling sideways.
 */
export class Spine {
  constructor(root, {samples = 420} = {}) {
    this.root = root;
    this.samples = samples;
    this.nodes = [];

    root.updateWorldMatrix(true, true);
    const segs = [];
    root.traverse(o => { if (/^Segment_\d+$/.test(o.name)) segs.push(o); });
    segs.sort((a, b) => a.name.localeCompare(b.name));
    const head = root.getObjectByName('Head_Joint');

    // rest geometry: the spine is straight along +X
    const p0 = segs[0].getWorldPosition(new THREE.Vector3());
    this.origin = p0.clone();
    for (const o of segs) {
      const w = o.getWorldPosition(new THREE.Vector3());
      this.nodes.push({obj: o, s: w.x - p0.x, restWorld: w.clone(), isHead: false});
    }
    if (head) {
      const w = head.getWorldPosition(new THREE.Vector3());
      this.nodes.push({obj: head, s: w.x - p0.x, restWorld: w.clone(), isHead: true});
    }
    this.length = Math.max(...this.nodes.map(n => n.s));

    // parents are fixed, so cache the inverse once
    for (const n of this.nodes) {
      n.parentInv = new THREE.Matrix4().copy(n.obj.parent.matrixWorld).invert();
      n.restQuat = n.obj.quaternion.clone();
    }

    this._pts = new Array(samples);
    this._cum = new Float64Array(samples);
    for (let i = 0; i < samples; i++) this._pts[i] = new THREE.Vector3();
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._up = new THREE.Vector3(0, 1, 0);
  }

  /**
   * @param wave  entry from WAVES
   * @param p     live parameter values
   * @param t     seconds
   * @param opt   {lateral, vertical, helix, bank}
   */
  update(wave, p, t, opt = {}) {
    const lateral = opt.lateral ?? 1;
    const vertical = opt.vertical ?? 0;
    const helix = opt.helix ?? Math.PI / 2;
    const bank = opt.bank ?? 0.6;
    const N = this.samples, L = this.length;

    // 1. sample the displaced curve from the HEAD end backwards, so the head
    //    leads and the body trails behind it
    for (let i = 0; i < N; i++) {
      const s = L * (1 - i / (N - 1));               // L … 0
      const yz = wave.fn(s, t, p);
      const yv = vertical ? wave.fn(s, t, {...p, phi: (p.phi ?? 0) + helix}) : 0;
      this._pts[i].set(this.origin.x + s, this.origin.y + yv * vertical, this.origin.z + yz * lateral);
    }
    // 2. cumulative arc length from the head
    this._cum[0] = 0;
    for (let i = 1; i < N; i++) this._cum[i] = this._cum[i - 1] + this._pts[i].distanceTo(this._pts[i - 1]);

    // 3. place every piece at the arc length it was built at
    const total = this._cum[N - 1];
    for (const n of this.nodes) {
      const want = Math.min(L - n.s, total);          // distance back from the head
      let i = 1;
      while (i < N - 1 && this._cum[i] < want) i++;
      const seg = this._cum[i] - this._cum[i - 1] || 1e-9;
      const f = (want - this._cum[i - 1]) / seg;
      const a = this._pts[i - 1], b = this._pts[i];
      const pos = a.clone().lerp(b, f);

      // tangent points from tail toward head
      const tan = b.clone().sub(a).multiplyScalar(-1).normalize();
      this._q.setFromUnitVectors(new THREE.Vector3(1, 0, 0), tan);
      if (bank) {                                     // roll into the turn
        const curv = (i > 1 && i < N - 1)
          ? this._pts[i + 1].z - 2 * this._pts[i].z + this._pts[i - 1].z : 0;
        this._q.multiply(new THREE.Quaternion().setFromAxisAngle(
          new THREE.Vector3(1, 0, 0), THREE.MathUtils.clamp(curv * 900 * bank, -0.9, 0.9)));
      }

      this._m.compose(pos, this._q, new THREE.Vector3(1, 1, 1));
      this._m.premultiply(n.parentInv);
      this._m.decompose(n.obj.position, n.obj.quaternion, new THREE.Vector3());
    }
  }

  /** Sample the raw scalar field, for the graph. */
  static curve(wave, p, t, L, n = 160) {
    const out = [];
    for (let i = 0; i < n; i++) {
      const s = L * i / (n - 1);
      out.push([s, wave.fn(s, t, p)]);
    }
    return out;
  }
}


/**
 * Facial rig. Everything here already exists in the file — the jaw is its own
 * mesh on its own hinge, and the whiskers, horns and four ear fins each have a
 * pivot empty. We only drive them.
 */
export class Face {
  constructor(root) {
    const g = n => root.getObjectByName(n);
    this.jaw = g('Head_Jaw');
    this.lids = [g('Eye_Lid_L'), g('Eye_Lid_R')].filter(Boolean);
    this.eyes = ['Eye_Ball_L','Eye_Ball_R','Eye_Iris_L','Eye_Iris_R','Eye_Spark_L','Eye_Spark_R']
      .map(g).filter(Boolean);
    this.irises = ['Eye_Iris_L','Eye_Iris_R','Eye_Spark_L','Eye_Spark_R'].map(g).filter(Boolean);
    this.whiskers = ['Whisker_L_Pivot','Whisker_R_Pivot'].map(g).filter(Boolean);
    this.horns = ['Horn_L_Pivot','Horn_R_Pivot'].map(g).filter(Boolean);
    this.fins = ['Fin_L0_Pivot','Fin_L1_Pivot','Fin_R0_Pivot','Fin_R1_Pivot'].map(g).filter(Boolean);
    this.tongue = g('Tongue');

    const rest = o => ({obj: o, q: o.quaternion.clone(), p: o.position.clone(), s: o.scale.clone()});
    this.R = new Map();
    for (const o of [this.jaw, this.tongue, ...this.lids, ...this.eyes, ...this.irises,
                     ...this.whiskers, ...this.horns, ...this.fins]) {
      if (o && !this.R.has(o)) this.R.set(o, rest(o));
    }
    this.blinkT = -9; this.nextBlink = 2 + Math.random() * 3;
    this._q = new THREE.Quaternion();
    this._ax = {x: new THREE.Vector3(1,0,0), y: new THREE.Vector3(0,1,0), z: new THREE.Vector3(0,0,1)};
  }

  #rot(o, axis, rad) {
    const r = this.R.get(o); if (!r) return;
    o.quaternion.copy(r.q).multiply(this._q.setFromAxisAngle(this._ax[axis], rad));
  }

  /**
   * @param t    seconds
   * @param p    {jaw, blink, lookX, lookY, whisker, fin, horn, autoBlink}
   * @param lead the head's own turn rate, so whiskers can trail behind it
   */
  update(t, p, lead = 0) {
    // jaw: the head faces +X, so the hinge opens about Z
    if (this.jaw) this.#rot(this.jaw, 'z', -(p.jaw ?? 0) * 0.26);   // ~15 deg wide open; 0.55 dislocated it
    if (this.tongue) this.#rot(this.tongue, 'z', -(p.jaw ?? 0) * 0.11);

    // blink — squash the eyes vertically; the lids ride with them
    let blink = p.blink ?? 0;
    if (p.autoBlink) {
      if (t > this.nextBlink) { this.blinkT = t; this.nextBlink = t + 2.2 + Math.random() * 3.5; }
      const dt = t - this.blinkT;
      if (dt >= 0 && dt < 0.17) blink = Math.max(blink, Math.sin((dt / 0.17) * Math.PI));
    }
    for (const o of [...this.eyes, ...this.lids]) {
      const r = this.R.get(o); if (!r) continue;
      o.scale.set(r.s.x, r.s.y * (1 - 0.92 * blink), r.s.z);
    }

    // look: the head faces +X, so "sideways" is Z and "up" is Y. Nudging along
    // X (as this first did) just drives the iris into the skull.
    for (const o of this.irises) {
      const r = this.R.get(o); if (!r) continue;
      o.position.set(r.p.x, r.p.y + (p.lookY ?? 0) * 0.0035, r.p.z + (p.lookX ?? 0) * 0.005);
    }

    // whiskers trail the head, horns flick, ear fins fan — all with a phase
    // offset each so they never move as one block
    const wob = (i, f, a) => Math.sin(t * f + i * 1.7) * a;
    this.whiskers.forEach((o, i) => this.#rot(o, 'y',
      (p.whisker ?? 0) * (wob(i, 1.5, 0.075) + lead * 0.22) * (i ? -1 : 1)));
    this.horns.forEach((o, i) => this.#rot(o, 'z', (p.horn ?? 0) * wob(i, 1.0, 0.030)));
    this.fins.forEach((o, i) => this.#rot(o, 'x', (p.fin ?? 0) * wob(i, 2.1, 0.055) * (i < 2 ? 1 : -1)));
  }
}


/** A pastel axis triad + graph-paper floor, so the motion has a frame to read against. */
export function buildAxes(THREE_, L = 1.9) {
  const g = new THREE_.Group();
  const mk = (a, b, color, w = 2) => {
    const geo = new THREE_.BufferGeometry().setFromPoints([a, b]);
    return new THREE_.Line(geo, new THREE_.LineBasicMaterial({color, transparent: true, opacity: .85}));
  };
  const O = new THREE_.Vector3(-0.12, 0, 0);
  g.add(mk(O, new THREE_.Vector3(L, 0, 0), 0xc76a86));        // X — along the spine
  g.add(mk(O, new THREE_.Vector3(-0.12, 0.72, 0), 0x3f9a46));  // Y — up
  g.add(mk(O, new THREE_.Vector3(-0.12, 0, 0.72), 0x4a7fc1));  // Z — lateral

  // ticks every 0.25 m along the spine axis
  for (let x = 0; x <= L; x += 0.25) {
    g.add(mk(new THREE_.Vector3(x, -0.02, 0), new THREE_.Vector3(x, 0.02, 0), 0xc76a86, 1));
  }
  // graph-paper floor
  const grid = new THREE_.GridHelper(4.2, 21, 0xc9a6ea, 0xe8dfd2);
  grid.position.set(0.8, -0.55, 0);
  grid.material.transparent = true; grid.material.opacity = .5;
  g.add(grid);
  return g;
}
