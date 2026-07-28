// Jello physics.
//
// A poke is a disturbance radiating from the point you touched. How it behaves
// depends on how set the jelly is, and the two ends are genuinely different
// physics, not the same wobble at different speeds:
//
//   SLIME   — overdamped. A deep local dent that oozes back slowly. No bounce.
//   JELLY   — underdamped. A shallow wobble that rings across the whole body
//             and settles quickly.
//
//     d(p,t) = A · e^(−λ·r) · e^(−decay·τ) · [ (1−osc) + osc·cos(ω·τ − k·r) ] · p̂
//
// p̂ is the PUSH DIRECTION — the way your finger went in. Displacing along the
// radial r̂ instead makes the body swell and shrink, which is inflation, not a
// jiggle. Jelly shears: the mass sways along the axis it was pushed.
//
// THE IMPORTANT BIT: the body is one 75,490-vertex mesh, so it is displaced on
// the GPU — but the embedded eyes, bubbles and drips are separate rigid
// objects. The same function is therefore written twice, once in GLSL and once
// in JS, and they must agree exactly. Keep them in sync when editing.
import * as THREE from 'three';

export const MAX_POKES = 4;

// ── one slider, two regimes ─────────────────────────────────────────────────
export function material(stiff) {
  const s = THREE.MathUtils.clamp(stiff, 0, 1);
  const sm = THREE.MathUtils.smoothstep(s, 0.12, 0.62);   // when bounce appears
  return {
    // slime lingers for seconds; set jelly settles in under one
    decay: THREE.MathUtils.lerp(0.42, 1.45, s),
    omega: THREE.MathUtils.lerp(2.0, 26.0, s),   // ring frequency once it bounces
    osc: sm,                                     // 0 = pure ooze, 1 = pure ring
    lambda: THREE.MathUtils.lerp(9.5, 1.8, s),   // local dent → whole-body sway
    k: THREE.MathUtils.lerp(11.0, 3.0, s),
    amp: THREE.MathUtils.lerp(0.062, 0.020, s),  // jelly only needs a small sway
    // at the bottom of the scale it stops holding its shape at all and spreads
    // out like a puddle; at the top it stands up on its own
    spread: Math.pow(1 - s, 1.35),
    liquid: THREE.MathUtils.smoothstep(1 - s, 0.45, 1.0),
    // surface ripples exist at every stiffness; they just get tighter,
    // faster and shallower as the jelly sets
    ripple: THREE.MathUtils.lerp(0.045, 0.013, s),
    ripK: THREE.MathUtils.lerp(28.0, 48.0, s),
    ripW: THREE.MathUtils.lerp(7.0, 17.0, s),
    ripDecay: THREE.MathUtils.lerp(1.05, 2.3, s),
  };
}

export class Jiggle {
  constructor(root, {bodyName = 'Jelly_Body'} = {}) {
    this.root = root;
    this.body = root.getObjectByName(bodyName);
    this.t = 0;
    this.pokes = [];
    this.stiff = 0.55;

    this.uni = {
      uTime:  {value: 0},
      uPoke:  {value: Array.from({length: MAX_POKES}, () => new THREE.Vector4(0, 0, 0, -999))},
      uAmp:   {value: new Float32Array(MAX_POKES)},
      uDir:   {value: Array.from({length: MAX_POKES}, () => new THREE.Vector3(0, -1, 0))},
      uDecay: {value: 1}, uOmega: {value: 12}, uOsc: {value: 0.5},
      uLambda:{value: 4}, uK: {value: 6},
      uSpread:{value: 0}, uBaseY: {value: 0}, uLiquid: {value: 0},
      uRipple:{value: 0.02}, uRipK: {value: 34}, uRipW: {value: 10}, uRipDecay: {value: 1.5},
    };

    // Riders = things EMBEDDED in the jelly. The loose eyes on the floor are
    // not part of it and must not be dragged around by it.
    this.riders = [];
    root.traverse(o => {
      if (o === this.body) return;
      if (/^Eye_Loose_\d+$/.test(o.name)) return;
      if (/^(Eye_\d+|Eye_Rim_\d+|Bubble_\d+|Drip_\d+)$/.test(o.name)) {
        this.riders.push({obj: o, rest: o.position.clone()});
      }
    });

    // the floor of the body, so the puddle spreads from the bottom up
    if (this.body) {
      this.body.geometry.computeBoundingBox();
      this.uni.uBaseY.value = this.body.geometry.boundingBox.min.y;
      this.#patch(this.body);
    }
  }

  #patch(mesh) {
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      m.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, this.uni);
        shader.vertexShader = `
          uniform float uTime, uDecay, uOmega, uOsc, uLambda, uK, uSpread, uBaseY, uLiquid;
          uniform float uRipple, uRipK, uRipW, uRipDecay;
          uniform vec4 uPoke[${MAX_POKES}];
          uniform vec3 uDir[${MAX_POKES}];
          uniform float uAmp[${MAX_POKES}];

          vec3 jelloOffset(vec3 p) {
            vec3 d = vec3(0.0);
            for (int i = 0; i < ${MAX_POKES}; i++) {
              float tau = uTime - uPoke[i].w;
              if (tau <= 0.0 || tau > 14.0) continue;
              float r = length(p - uPoke[i].xyz) + 1e-4;
              float env = exp(-uLambda * r) * exp(-uDecay * tau);
              float shape = (1.0 - uOsc) + uOsc * cos(uOmega * tau - uK * r);
              d += uDir[i] * uAmp[i] * env * shape;      // sway, not swell
            }
            // At the liquid end it stops being a solid: it collapses to a
            // shallow puddle and carries travelling surface ripples instead of
            // a whole-body wobble.
            float h = max(p.y - uBaseY, 0.0);
            d += vec3(p.x * uSpread * 0.62, -h * uSpread * 0.86, p.z * uSpread * 0.62);
            // travelling surface ripples, at every stiffness
            float w = 0.0;
            for (int i = 0; i < ${MAX_POKES}; i++) {
              float tau = uTime - uPoke[i].w;
              if (tau <= 0.0 || tau > 14.0) continue;
              float rr = length(p.xz - uPoke[i].xz) + 1e-4;
              w += exp(-uRipDecay * tau) * exp(-2.0 * rr) * sin(uRipK * rr - uRipW * tau);
            }
            d.y += w * uRipple;
            return d;
          }
        ` + shader.vertexShader;
        shader.vertexShader = shader.vertexShader.replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
           transformed += jelloOffset(position);`
        );
      };
      m.needsUpdate = true;
    }
  }

  /** The JS twin of jelloOffset() — must match the GLSL above. */
  offset(p, out = new THREE.Vector3()) {
    out.set(0, 0, 0);
    const u = this.uni;
    for (const pk of this.pokes) {
      const tau = this.t - pk.t0;
      if (tau <= 0 || tau > 14) continue;
      const r = Math.hypot(p.x - pk.p.x, p.y - pk.p.y, p.z - pk.p.z) + 1e-4;
      const env = Math.exp(-u.uLambda.value * r) * Math.exp(-u.uDecay.value * tau);
      const shape = (1 - u.uOsc.value) + u.uOsc.value * Math.cos(u.uOmega.value * tau - u.uK.value * r);
      const a = pk.amp * env * shape;
      out.x += pk.dir.x * a; out.y += pk.dir.y * a; out.z += pk.dir.z * a;
    }
    const h = Math.max(p.y - u.uBaseY.value, 0);
    out.x += p.x * u.uSpread.value * 0.62;
    out.y += -h * u.uSpread.value * 0.86;
    out.z += p.z * u.uSpread.value * 0.62;
    let w = 0;
    for (const pk of this.pokes) {
      const tau = this.t - pk.t0;
      if (tau <= 0 || tau > 14) continue;
      const rr = Math.hypot(p.x - pk.p.x, p.z - pk.p.z) + 1e-4;
      w += Math.exp(-u.uRipDecay.value * tau) * Math.exp(-2.0 * rr) *
           Math.sin(u.uRipK.value * rr - u.uRipW.value * tau);
    }
    out.y += w * u.uRipple.value;
    return out;
  }

  /** @param worldDir which way the finger pushed (world space) */
  poke(worldPoint, strength = 1, worldDir = null) {
    const local = this.root.worldToLocal(worldPoint.clone());
    const inv = new THREE.Matrix4().copy(this.root.matrixWorld).invert();
    const dir = (worldDir ? worldDir.clone() : new THREE.Vector3(0, -1, 0))
      .transformDirection(inv).normalize();
    this.pokes.push({p: local, dir, t0: this.t, amp: material(this.stiff).amp * strength});
    if (this.pokes.length > MAX_POKES) this.pokes.shift();
    return local;
  }

  /** Displacement still in the system — drives the plot. */
  signal() {
    const u = this.uni;
    let v = 0;
    for (const pk of this.pokes) {
      const tau = this.t - pk.t0;
      if (tau <= 0 || tau > 14) continue;
      v += Math.exp(-u.uDecay.value * tau) *
           ((1 - u.uOsc.value) + u.uOsc.value * Math.cos(u.uOmega.value * tau));
    }
    return THREE.MathUtils.clamp(v, -1.4, 1.4);
  }

  update(dt) {
    this.t += dt;
    const m = material(this.stiff), u = this.uni;
    u.uTime.value = this.t;
    u.uDecay.value = m.decay; u.uOmega.value = m.omega; u.uOsc.value = m.osc;
    u.uLambda.value = m.lambda; u.uK.value = m.k;
    u.uSpread.value = m.spread; u.uLiquid.value = m.liquid;
    u.uRipple.value = m.ripple; u.uRipK.value = m.ripK;
    u.uRipW.value = m.ripW; u.uRipDecay.value = m.ripDecay;

    for (let i = 0; i < MAX_POKES; i++) {
      const pk = this.pokes[i];
      if (pk) {
        u.uPoke.value[i].set(pk.p.x, pk.p.y, pk.p.z, pk.t0);
        u.uDir.value[i].copy(pk.dir);
        u.uAmp.value[i] = pk.amp;
      } else { u.uPoke.value[i].w = -999; u.uAmp.value[i] = 0; }
    }

    const d = new THREE.Vector3();
    for (const r of this.riders) {
      this.offset(r.rest, d);
      r.obj.position.copy(r.rest).add(d);
    }
  }
}

/**
 * Every eyeball tracks the cursor — all of them, all the time, no swivel limit.
 *
 * The forward axis is measured, not assumed: it is the direction from the
 * sclera's centre to the pupil's centre, which is by definition where the eye
 * is looking.
 */
export class Eyes {
  constructor(root) {
    this.eyes = [];
    root.updateWorldMatrix(true, true);
    root.traverse(o => {
      if (!/^(Eye_\d+|Eye_Rim_\d+|Eye_Loose_\d+)$/.test(o.name)) return;
      const sclera = o.children.find(c => /Sclera/.test(c.name));
      const pupil = o.children.find(c => /Pupil/.test(c.name));
      if (!sclera || !pupil) return;
      const cS = new THREE.Box3().setFromObject(sclera).getCenter(new THREE.Vector3());
      const cP = new THREE.Box3().setFromObject(pupil).getCenter(new THREE.Vector3());
      const fwd = cP.clone().sub(cS).normalize();
      if (!isFinite(fwd.x) || fwd.lengthSq() < 0.5) return;
      this.eyes.push({
        obj: o,
        fwd,                                                     // world-space at rest
        restWorldQ: o.getWorldQuaternion(new THREE.Quaternion()),
        restLocalQ: o.quaternion.clone(),
      });
    });
    this._q = new THREE.Quaternion();
    this._pq = new THREE.Quaternion();
    this._v = new THREE.Vector3();
  }

  /** @param target world point every eye should look at; null = back to rest */
  update(target, snap = 0.35) {
    for (const e of this.eyes) {
      if (!target) { e.obj.quaternion.slerp(e.restLocalQ, 0.12); continue; }
      e.obj.getWorldPosition(this._v);
      const dir = target.clone().sub(this._v);
      if (dir.lengthSq() < 1e-8) continue;
      dir.normalize();
      // world delta that swings the measured forward axis onto the target,
      // then take it back into the parent's space. No clamp: a floating
      // eyeball is allowed to turn all the way round.
      this._q.setFromUnitVectors(e.fwd, dir).multiply(e.restWorldQ);
      e.obj.parent.getWorldQuaternion(this._pq).invert();
      e.obj.quaternion.slerp(this._pq.multiply(this._q), snap);
    }
  }
}
