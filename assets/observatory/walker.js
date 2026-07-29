// First-person walker for The Astronomer's Study.
//
// Collision is a capsule swept against ONE BVH built from the building's own
// meshes — no hand-authored collision proxy, no nav mesh, no invisible walls.
// The stair is climbable because a 0.30 m capsule rides a 19.7 cm rise on its
// own. Adapted from the Casa Cartagena walker; the differences are this
// asset's group and stair naming.
import * as THREE from 'three';
import {computeBoundsTree, disposeBoundsTree, acceleratedRaycast}
  from 'https://cdn.jsdelivr.net/npm/three-mesh-bvh@0.9.0/build/index.module.js';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

// Groups the player can stand on or bump into. Garden foliage is excluded:
// leaf cards in the BVH cost triangles and stop nothing you'd want stopped.
const SOLID_GROUPS = new Set([
  'Shell', 'Mezzanine', 'Stair', 'Site', 'Exterior_West', 'Exterior_Envelope',
  'Roof_Exterior', 'Entrance', 'Bookcase', 'Furniture', 'Longcase_Clock',
  'Globe_Floor', 'Telescope', 'Props_Ground', 'Props_Loft', 'Gallery_Wall',
  'Rose_Window',
]);

// Replaced by the smooth ramp below. If they stay in the BVH the capsule rides
// the tread tops (which sit above the ramp) and jams on the next riser.
const STAIR_RE = /^(Stair_Tread_|Stair_Riser_|Stair_Stringer|Stair_Spandrel)/;

export const PLAYER = {
  height: 1.66,      // eye height above the floor
  radius: 0.28,
  speed: 2.4,        // m/s walk — a room this size wants a slower pace
  run: 4.2,
  gravity: -18,
  jump: 4.6,
  step: 0.34,        // max riser we climb; this stair's is 0.197
};

export function buildCollider(root, {onProgress} = {}){
  const geoms = [];
  let skipped = 0;
  root.updateWorldMatrix(true, true);
  root.traverse(o => {
    if (!o.isMesh || !o.geometry) return;
    // Anything under a joint MOVES. This BVH is baked in world space at load,
    // so a door leaf welded into it would still block the doorway after the
    // door swung open. Moving parts are handled separately.
    for (let a = o; a; a = a.parent) {
      if (a.userData && a.userData.joint) { skipped++; return; }
    }
    if (STAIR_RE.test(o.name)) { skipped++; return; }
    let g = o, group = null;
    while (g) { if (SOLID_GROUPS.has(g.name)) { group = g.name; break; } g = g.parent; }
    if (!group) { skipped++; return; }
    const cloned = o.geometry.clone();
    cloned.applyMatrix4(o.matrixWorld);
    for (const k of Object.keys(cloned.attributes)) if (k !== 'position') cloned.deleteAttribute(k);
    if (!cloned.index) {
      const n = cloned.attributes.position.count;
      cloned.setIndex(Array.from({length: n}, (_, i) => i));
    }
    geoms.push(cloned);
  });

  const ramps = stairRamps(root);
  for (const r of ramps) geoms.push(r);
  onProgress?.(`merging ${geoms.length} meshes (${skipped} skipped, ${ramps.length} stair ramp)`);
  const merged = BufferGeometryUtils.mergeGeometries(geoms, false);
  merged.computeBoundsTree({maxLeafTris: 12});
  const collider = new THREE.Mesh(merged, new THREE.MeshBasicMaterial({
    wireframe: true, transparent: true, opacity: 0.14, color: 0xff9ec7}));
  collider.visible = false;
  collider.name = 'CollisionBVH';
  return {collider, tris: merged.index.count / 3, meshes: geoms.length};
}

/** One sloped slab per flight, derived from the treads' own bounding boxes. */
function stairRamps(root){
  const steps = [];
  root.updateWorldMatrix(true, true);
  root.traverse(o => {
    if (o.isMesh && /^Stair_Tread_\d+/.test(o.name))
      steps.push({box: new THREE.Box3().setFromObject(o)});
  });
  if (steps.length < 3) return [];

  // A flight is a set of treads sharing an X lane.
  const lanes = [];
  for (const s of steps) {
    const lane = lanes.find(l => Math.abs(l.x0 - s.box.min.x) < 0.3 && Math.abs(l.x1 - s.box.max.x) < 0.3);
    if (lane) lane.steps.push(s);
    else lanes.push({x0: s.box.min.x, x1: s.box.max.x, steps: [s]});
  }

  const out = [];
  for (const lane of lanes) {
    if (lane.steps.length < 3) continue;
    lane.steps.sort((a, b) => a.box.min.y - b.box.min.y);   // by height = up the flight
    const lo = lane.steps[0].box, hi = lane.steps[lane.steps.length - 1].box;
    const loZ = (lo.min.z + lo.max.z) / 2, hiZ = (hi.min.z + hi.max.z) / 2;
    const up = hiZ > loZ ? 1 : -1;                          // travel direction in Z
    const run = Math.abs(hiZ - loZ) / Math.max(1, lane.steps.length - 1);
    // Anchor on the NOSING line: the top-leading corners are colinear, so a
    // ramp through the first and last sits on every nosing and above every
    // tread. Anchoring at the first tread's base puts it half a step low and
    // the treads poke through.
    const zBot = (up > 0 ? lo.min.z : lo.max.z) - up * run;
    const zTop = up > 0 ? hi.max.z : hi.min.z;
    const yBot = lo.min.y, yTop = hi.max.y;

    const x0 = lane.x0, x1 = lane.x1, drop = 0.7;
    const v = [
      x0, yBot, zBot,  x1, yBot, zBot,  x1, yTop, zTop,  x0, yTop, zTop,
      x0, yBot - drop, zBot,  x1, yBot - drop, zBot,  x1, yTop - drop, zTop,  x0, yTop - drop, zTop,
    ];
    const idx = [0,1,2, 0,2,3,  4,6,5, 4,7,6,  0,4,5, 0,5,1,  3,2,6, 3,6,7,  0,3,7, 0,7,4,  1,5,6, 1,6,2];
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
    g.setIndex(idx);
    out.push(g);
  }
  return out;
}

export class Walker {
  constructor(camera, collider){
    this.camera = camera;
    this.collider = collider;
    this.velocity = new THREE.Vector3();
    this.onGround = false;
    this.position = new THREE.Vector3();
    this.spawn = new THREE.Vector3(-4.9, -0.60, 1.10);
    this._box = new THREE.Box3();
    this._mat = new THREE.Matrix4();
    this._seg = new THREE.Line3();
    this._v1 = new THREE.Vector3();
    this._v2 = new THREE.Vector3();
    this.extraColliders = [];        // e.g. the shut front door
  }

  teleport(x, y, z){
    this.position.set(x, y, z);
    this.velocity.set(0, 0, 0);
  }

  /** input: {f,b,l,r,run,jump} plus optional analog {ax,az} from a thumbstick. */
  update(dt, input){
    const p = PLAYER;
    dt = Math.min(dt, 0.05);                        // never tunnel on a stall

    const fwd = new THREE.Vector3();
    this.camera.getWorldDirection(fwd);
    fwd.y = 0; fwd.normalize();
    const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0,1,0)).normalize();
    const wish = new THREE.Vector3();
    if (input.f) wish.add(fwd);
    if (input.b) wish.sub(fwd);
    if (input.r) wish.add(right);
    if (input.l) wish.sub(right);
    if (input.ax || input.az){                       // analog stick
      wish.addScaledVector(right, input.ax || 0);
      wish.addScaledVector(fwd, -(input.az || 0));
    }
    const mag = Math.min(1, wish.length());
    const speed = (input.run ? p.run : p.speed) * (mag > 0 ? 1 : 0);
    if (wish.lengthSq() > 0) wish.normalize().multiplyScalar(speed * mag);

    this.velocity.x = wish.x;
    this.velocity.z = wish.z;
    this.velocity.y += p.gravity * dt;
    if (input.jump && this.onGround){ this.velocity.y = p.jump; this.onGround = false; }

    // LIFT - MOVE - SEAT: while grounded, lift by the step height so risers
    // shorter than that simply are not there during the horizontal move, then
    // settle back onto whatever is underneath.
    if (this.onGround) {
      this.position.y += p.step;
      this.position.x += this.velocity.x * dt;
      this.position.z += this.velocity.z * dt;
      this.#resolve(dt);
      const gx = this.position.x, gz = this.position.z;
      this.position.y -= p.step;
      this.#resolve(dt);
      // take only the VERTICAL result of the drop: on a steep ramp the push-out
      // is mostly backwards, and applying it horizontally cancels the step.
      this.position.x = gx; this.position.z = gz;
    } else {
      this.position.addScaledVector(this.velocity, dt);
      this.#resolve(dt);
    }
    this.camera.position.copy(this.position).add(new THREE.Vector3(0, p.height, 0));
  }

  #resolve(dt){
    const p = PLAYER;
    const capsuleTop = p.height - p.radius;
    this._seg.start.copy(this.position).setY(this.position.y + p.radius);
    this._seg.end.copy(this.position).setY(this.position.y + capsuleTop);

    const geom = this.collider.geometry;
    this._mat.copy(this.collider.matrixWorld).invert();
    this._box.makeEmpty();
    this._seg.start.applyMatrix4(this._mat);
    this._seg.end.applyMatrix4(this._mat);
    this._box.expandByPoint(this._seg.start);
    this._box.expandByPoint(this._seg.end);
    this._box.min.addScalar(-p.radius);
    this._box.max.addScalar(p.radius);

    geom.boundsTree.shapecast({
      intersectsBounds: box => box.intersectsBox(this._box),
      intersectsTriangle: tri => {
        const dist = tri.closestPointToSegment(this._seg, this._v1, this._v2);
        if (dist < p.radius){
          const depth = p.radius - dist;
          const dir = this._v2.clone().sub(this._v1).normalize();
          this._seg.start.addScaledVector(dir, depth);
          this._seg.end.addScaledVector(dir, depth);
        }
      }
    });

    const newStart = this._seg.start.clone().applyMatrix4(this.collider.matrixWorld);
    const delta = newStart.clone().sub(
      new THREE.Vector3(this.position.x, this.position.y + p.radius, this.position.z));

    this.onGround = delta.y > Math.abs(dt * this.velocity.y * 0.25);
    this.position.add(delta);
    for (const b of this.extraColliders) this.#pushOutOfBox(b);

    if (this.onGround) this.velocity.y = Math.max(0, this.velocity.y);
    else if (delta.y < -1e-4) this.velocity.y = Math.min(0, this.velocity.y);

    if (this.position.y < -6) this.teleport(this.spawn.x, this.spawn.y, this.spawn.z);
  }

  #pushOutOfBox(b){
    const p = PLAYER;
    const c = this.position.clone().setY(this.position.y + p.height * 0.5);
    if (c.x < b.min.x - p.radius || c.x > b.max.x + p.radius) return;
    if (c.z < b.min.z - p.radius || c.z > b.max.z + p.radius) return;
    if (c.y < b.min.y || c.y > b.max.y) return;
    const dxl = c.x - (b.min.x - p.radius), dxr = (b.max.x + p.radius) - c.x;
    const dzl = c.z - (b.min.z - p.radius), dzr = (b.max.z + p.radius) - c.z;
    const m = Math.min(dxl, dxr, dzl, dzr);
    if (m === dxl) this.position.x -= dxl;
    else if (m === dxr) this.position.x += dxr;
    else if (m === dzl) this.position.z -= dzl;
    else this.position.z += dzr;
  }
}
