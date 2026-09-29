// Pedestrian crowd: instanced low-poly people that plan A* routes across the campus,
// enter and leave buildings, chat in groups, sit on benches or the lawn and speak now and then.

import * as THREE from 'three';
import { rng, clamp, angleDiff, pointInRing, TAU } from './util.js';
import { HumanCrowd } from './humanrender.js';
import { ACC } from './humanoid.js';

const MAX_NPC = 300;
export const OUTDOOR_MAX = 200; // slots 200..299 are reserved for people inside buildings

const SKIN = ['#f1cba8', '#e6b48c', '#d49b72', '#b97d57', '#8d5c40', '#6f4630'];
const HAIR = ['#1b1917', '#2a201a', '#3d2b20', '#5a3d2b', '#7a3b25', '#a98657', '#8a8a86', '#c9b26e'];
const SHIRT = ['#1f3a5f', '#f2f2ee', '#202226', '#7c828a', '#b23a34', '#2d8a8a', '#d8a531', '#6c7d3f', '#e3a3b5', '#4f79ad', '#2f6b4f', '#7a2a3a', '#e07b39', '#8a6fb0'];
const PANTS = ['#3b5478', '#23252b', '#a89573', '#5b5f66', '#1c2438', '#d8d0bc', '#4d3f34'];
const BAG = ['#1f1f24', '#2c4a7a', '#7a2a2a', '#3c6b52', '#8a6f2a'];
const SCARF = ['#6b4e8c', '#2f5d62', '#8c3b4a', '#d8d0bc', '#1f1f24', '#b9855a', '#4f79ad', '#7a8c5a'];

// Clips during which the head stays down (no glancing at the player).
const HEAD_DOWN = new Set(['phone', 'walkPhone', 'sitPhone', 'sitWrite', 'sitType', 'sitRead', 'work']);
const PHONE_CLIPS = new Set(['phone', 'walkPhone', 'sitPhone']);
const BOOK_CLIPS = new Set(['carry', 'sitRead']);
const pick = (r, list) => list[Math.floor(r() * list.length)];

export const PHRASES = [
  'Merhaba!', 'Kahve içelim mi?', 'Kütüphaneye gidiyorum.', 'Derse geç kaldım!', 'Vize haftası geliyor...',
  'Teleferiğe çıkalım mı?', 'Proje teslimi yarın.', 'Amfide etkinlik varmış.', 'Yurtta buluşalım.',
  'Bugün hava harika.', 'Kütüphanenin alt katı 7/24 açık.', "Starbucks'a mı gidiyoruz?", 'Hangi blokta dersimiz var?',
  'Bir sonraki ders kaçta?', 'Ödevi bitirdin mi?', 'Öğle yemeği?',
];

// What people say depends on the moment: the life director sets crowd.phraseCtx.
const PHRASES_CTX = {
  rush: ['Derse geç kaldım!', 'Hangi blokta dersimiz var?', 'Bir sonraki ders kaçta?', 'Sınıf E blokta mıydı?', 'Yetişemeyeceğiz!'],
  lunch: ['Öğle yemeği?', "Starbucks'a mı gidiyoruz?", 'Kantinde yer var mı?', 'Acıktım...', 'Bugün ne var yemekte?'],
  exam: ['Vize haftası, uyku yok.', 'Kütüphane dolu mu?', 'Notlarını paylaşır mısın?', 'Bu konu çıkar mı?', 'Bir kahve daha...'],
  morning: ['Günaydın!', 'İlk ders 08:30, kim kalkabiliyor ki?', 'Kahve alalım mı?', 'Servise yetiştim!'],
  evening: ['Yurtta buluşalım.', 'Yarın erken kalkmam lazım.', 'Kütüphaneye gidiyorum.', 'Bugün yeter.'],
  holiday: ['Bugün kampüs ne sessiz.', 'Tatilde burada ne işim var?', 'Bayram günü kim gelir ki...'],
  weekend: ['Hafta sonu kampüs başka güzel.', 'Kütüphaneye kaçtım.', 'Pazartesi ödevi unuttum...'],
};

const colorOf = (hex) => new THREE.Color(hex);

export class Crowd {
  constructor({ data, hf, scene, campusRing, doors, buildings, benches = [], navgrid, seed = 12345 }) {
    this.data = data;
    this.hf = hf;
    this.scene = scene;
    this.r = rng(seed);
    this.doors = doors;
    this.buildings = buildings;
    this.benches = benches;
    this.campusRing = campusRing;
    this.nav = navgrid;
    this._seatsTaken = new Set();
    this.active = OUTDOOR_MAX; // slots scanned each frame; who is alive is tracked per NPC
    this.gates = [];
    this.auto = false; // the life director sets the target while true
    this.targetAlive = 0;
    this.balanceT = 0;
    this.bias = { door: 0.26, spot: 0.29 }; // goal mix of walkers (doors, hotspots, wander)
    this.mix = { walker: 0.68, stander: 0.18 }; // plan of newly appearing people (rest sit)
    this.director = null; // optional: { insideSeconds(r) }
    this.phraseCtx = null;
    this.npcs = [];
    this.time = 0;
    this.interiorHook = null; // set by the interior system: (npc, door) when an NPC walks into a building
    this._hotspots();
    this._buildMeshes();
    this._buildBubbles();
    this._tmp = {
      root: new THREE.Matrix4(),
      local: new THREE.Matrix4(),
      out: new THREE.Matrix4(),
      pos: new THREE.Vector3(),
      quat: new THREE.Quaternion(),
      scale: new THREE.Vector3(),
      euler: new THREE.Euler(),
      q2: new THREE.Quaternion(),
    };
    for (let i = 0; i < MAX_NPC; i++) this.npcs.push(this._makeNpc(i));
    for (let i = OUTDOOR_MAX; i < MAX_NPC; i++) this.npcs[i].visible = false;
    this.setCount(90);
  }

  setGates(gates) {
    this.gates = gates.map((g) => ({ x: g.x, z: g.z }));
  }

  aliveCount() {
    let c = 0;
    for (let i = 0; i < OUTDOOR_MAX; i++) if (this.npcs[i].alive) c++;
    return c;
  }

  // ---------------------------------------------------------------- places
  _hotspots() {
    const byName = (name) => this.data.pois.find((p) => p.name === name);
    const spots = [];
    const add = (poi, weight, radius = 3.2) => {
      if (!poi) return;
      const node = this.nav.nearest(poi.x, poi.z);
      if (node < 0) return;
      const [x, z] = this.nav.pos(node);
      spots.push({ x, z, poiX: poi.x, poiZ: poi.z, weight, radius, name: poi.name });
    };
    add(byName('Starbucks'), 3);
    add(byName('Subway'), 2);
    add(byName('library'), 3);
    add(byName('Amfiteatr'), 2);
    this.spots = spots;
    // Doors as goals: a walkable point in front of each door.
    this.doorGoals = this.doors.map((d) => ({ door: d, x: d.x + d.nx * 1.4, z: d.z + d.nz * 1.4 }));
  }

  // ---------------------------------------------------------------- meshes
  _buildMeshes() {
    this.humans = new HumanCrowd(MAX_NPC);
    this.humans.mesh.receiveShadow = true;
    this.humans.setCount(MAX_NPC);
    this.group = new THREE.Group();
    this.group.name = 'crowd';
    this.group.add(this.humans.mesh);
    this.scene.add(this.group);
  }

  _buildBubbles() {
    this.bubbleCache = new Map();
    this.bubbles = [];
    for (let i = 0; i < 6; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false, opacity: 0 }));
      s.visible = false;
      s.renderOrder = 20;
      this.scene.add(s);
      this.bubbles.push({ sprite: s, npc: null, life: 0, total: 1 });
    }
    this.bubbleCooldown = 0;
  }

  _bubbleTexture(text) {
    let t = this.bubbleCache.get(text);
    if (t) return t;
    const font = '600 34px "Barlow", "Segoe UI", sans-serif';
    const probe = document.createElement('canvas').getContext('2d');
    probe.font = font;
    const w = Math.ceil(probe.measureText(text).width) + 40;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = 76;
    const g = c.getContext('2d');
    g.font = font;
    g.fillStyle = 'rgba(243,245,242,0.96)';
    const rr = 14;
    g.beginPath();
    g.moveTo(rr, 0);
    g.lineTo(w - rr, 0);
    g.quadraticCurveTo(w, 0, w, rr);
    g.lineTo(w, 58 - rr);
    g.quadraticCurveTo(w, 58, w - rr, 58);
    g.lineTo(w / 2 + 10, 58);
    g.lineTo(w / 2, 74);
    g.lineTo(w / 2 - 10, 58);
    g.lineTo(rr, 58);
    g.quadraticCurveTo(0, 58, 0, 58 - rr);
    g.lineTo(0, rr);
    g.quadraticCurveTo(0, 0, rr, 0);
    g.fill();
    g.fillStyle = '#14243b';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, w / 2, 30);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    t = { tex, aspect: w / 76 };
    this.bubbleCache.set(text, t);
    return t;
  }

  // ------------------------------------------------------------------ NPCs
  _makeNpc(i) {
    const r = this.r;
    const female = r() < 0.48;
    const veil = female && r() < 0.16;
    const hood = !veil && r() < 0.07;
    const skirt = female && !veil && r() < 0.2;
    const shirt = colorOf(pick(r, SHIRT));
    const bagColor = colorOf(pick(r, BAG));
    const hasBag = r() < 0.5;
    const sideBag = !hasBag && female && r() < 0.22;
    const glasses = r() < 0.13;
    const cup = r() < 0.09;
    const look = {
      shirt,
      sleeve: r() < 0.5 ? 0.36 : 1,
      pants: colorOf(pick(r, PANTS)),
      pantsLen: !female && r() < 0.09 ? 0.55 : 1,
      skin: colorOf(pick(r, SKIN)),
      hairStyle: veil ? 4 : female ? (r() < 0.55 ? 1 : r() < 0.5 ? 2 : 0) : r() < 0.8 ? 0 : 3,
      hair: colorOf(pick(r, HAIR)),
      shoe: colorOf(r() < 0.6 ? '#f0f0ec' : '#202226'),
      accent: veil ? colorOf(pick(r, SCARF)) : hood ? shirt.clone().multiplyScalar(0.85) : bagColor,
      gender: female ? 1 : 0,
      extra: (skirt ? 1 : 0) | (hood ? 2 : 0) | (veil ? 4 : 0),
      flags: (hasBag ? 1 << ACC.BACKPACK : 0) | (sideBag ? 1 << ACC.SHOULDERBAG : 0) | (glasses ? 1 << ACC.GLASSES : 0) | (cup ? 1 << ACC.CUP : 0),
    };
    this.humans.setLook(i, look);
    return {
      id: i,
      x: 0, z: 0, y: 0, yaw: 0, speed: 0, targetSpeed: 1.3,
      state: 'walk', timer: 0, phase: r() * TAU,
      female,
      scale: (female ? 0.94 : 1.03) * (0.95 + r() * 0.1),
      width: female ? 0.93 : 1.04,
      look,
      path: null, pi: 0, goalKind: 'wander', doorIdx: -1, doorTarget: null,
      leader: null, offset: [0, 0],
      phone: r() < 0.14, jog: r() < 0.03, book: r() < 0.12, cup,
      seat: null, faceYaw: 0, talker: false, talkTimer: 0, spot: null, sip: false,
      sitAct: 'sit', act: null, wave: 0, pause: 0, greetYaw: 0,
      lookYaw: 0, blink: r() * 4,
      anim: { clip: null, time: 0, prev: null, prevTime: 0, blend: 0 },
      visible: true, insideTimer: 0, insideBuilding: null,
      alive: false, leaving: false, seatKey: null,
    };
  }

  _plan(n, gx, gz) {
    const p = this.nav.findPath(n.x, n.z, gx, gz);
    if (!p || p.length < 2) {
      n.path = null;
      return false;
    }
    n.path = p;
    n.pi = 1;
    return true;
  }

  _pickGoal(n) {
    const r = this.r;
    const roll = r();
    n.doorIdx = -1;
    n.goalKind = 'wander';
    let gx;
    let gz;
    if (roll < this.bias.door && this.doorGoals.length) {
      const i = Math.floor(r() * this.doorGoals.length);
      n.doorIdx = i;
      n.goalKind = 'door';
      gx = this.doorGoals[i].x;
      gz = this.doorGoals[i].z;
    } else if (roll < this.bias.door + this.bias.spot && this.spots.length) {
      let total = 0;
      for (const s of this.spots) total += s.weight;
      let k = r() * total;
      let pick = this.spots[0];
      for (const s of this.spots) {
        k -= s.weight;
        if (k <= 0) {
          pick = s;
          break;
        }
      }
      const a = r() * TAU;
      gx = pick.x + Math.cos(a) * (1 + r() * 2.5);
      gz = pick.z + Math.sin(a) * (1 + r() * 2.5);
      n.goalKind = 'spot';
      n.spot = pick;
    } else {
      const node = this.nav.randomNode(r);
      [gx, gz] = this.nav.pos(node);
    }
    if (!this._plan(n, gx, gz)) {
      const node = this.nav.randomNode(r);
      const [rx, rz] = this.nav.pos(node);
      this._plan(n, rx, rz);
      n.goalKind = 'wander';
      n.doorIdx = -1;
    }
  }

  _arrive(n) {
    const r = this.r;
    if (n.goalKind === 'leave') {
      this._kill(n);
      return;
    }
    if (n.goalKind === 'door' && n.doorIdx >= 0) {
      const d = this.doorGoals[n.doorIdx].door;
      n.state = 'toDoor';
      n.doorTarget = { x: d.x + d.nx * 0.35, z: d.z + d.nz * 0.35, door: d };
      return;
    }
    if (n.goalKind === 'spot' && n.spot && r() < 0.85) {
      n.state = 'idle';
      n.timer = 6 + r() * 20;
      const s = n.spot;
      n.faceYaw = Math.atan2(-(s.poiX - n.x), -(s.poiZ - n.z)) + (r() - 0.5) * 1.3;
      n.talker = r() < 0.5;
      return;
    }
    this._pickGoal(n);
  }

  respawn(n, kind) {
    const r = this.r;
    n.leader = null;
    n.visible = true;
    n.speed = 0;
    n.seat = null;
    n.state = 'walk';
    n.path = null;
    n.insideBuilding = null;
    n.wave = 0;
    n.pause = 0;
    n.act = null;
    n.anim.clip = null;
    n.anim.prev = null;
    if (kind === 'walker') {
      const node = this.nav.randomNode(r);
      [n.x, n.z] = this.nav.pos(node);
      n.yaw = r() * TAU;
      this._pickGoal(n);
      n.targetSpeed = n.jog ? 2.7 : 1.1 + r() * 0.5;
    } else if (kind === 'stander') {
      const s = this.spots[Math.floor(r() * this.spots.length)];
      n.x = s.x;
      n.z = s.z;
      for (let tries = 0; tries < 12; tries++) {
        const a = r() * TAU;
        const rad = s.radius * 0.5 + r() * 2.6;
        const x = s.x + Math.cos(a) * rad;
        const z = s.z + Math.sin(a) * rad;
        if (this.nav.los(s.x, s.z, x, z, 0.4)) {
          n.x = x;
          n.z = z;
          break;
        }
      }
      n.state = 'idle';
      n.faceYaw = Math.atan2(-(s.poiX - n.x), -(s.poiZ - n.z)) + (r() - 0.5) * 0.9;
      n.yaw = n.faceYaw;
      n.talker = r() < 0.5;
      n.timer = 1e9;
    } else if (kind === 'sitter') {
      const seat = this._seat();
      n.state = 'sit';
      n.seat = seat;
      n.seatKey = seat.key;
      n.x = seat.x;
      n.z = seat.z;
      n.yaw = seat.yaw;
      n.sitAct = seat.bench ? pick(r, ['sit', 'sit', 'sit', 'sitPhone', 'sitPhone', 'sitTalk', 'sitRead']) : 'sitGround';
    }
    n.y = this.hf.h(n.x, n.z);
  }

  // A free seat: benches first, otherwise a spot on one of the lawns. Never hands out a seat twice.
  _seat() {
    for (let tries = 0; tries < 8; tries++) {
      const seat = this._seatCandidate();
      const key = `${Math.round(seat.x * 4)},${Math.round(seat.z * 4)}`;
      if (!this._seatsTaken.has(key)) {
        this._seatsTaken.add(key);
        return { ...seat, key };
      }
    }
    return { ...this._seatCandidate(), key: null };
  }

  _seatCandidate() {
    const r = this.r;
    if (this.benches.length && r() < 0.55) {
      const cand = this.benches.filter((b) => pointInRing(b.x, b.z, this.campusRing));
      if (cand.length) {
        const b = cand[Math.floor(r() * cand.length)];
        const side = r() < 0.5 ? -0.45 : 0.45;
        return { x: b.x + Math.cos(b.yaw) * side, z: b.z - Math.sin(b.yaw) * side, yaw: b.yaw + Math.PI, bench: true };
      }
    }
    const lawns = this.data.areas.filter((a) => ['IEU Kedili Park', 'IEU Çiçeklik', 'IEU Çiçeklik 4'].includes(a.name));
    for (let tries = 0; tries < 60; tries++) {
      const a = lawns[Math.floor(r() * lawns.length)];
      if (!a) break;
      let minX = Infinity;
      let maxX = -Infinity;
      let minZ = Infinity;
      let maxZ = -Infinity;
      for (let i = 0; i < a.r.length; i += 2) {
        minX = Math.min(minX, a.r[i]);
        maxX = Math.max(maxX, a.r[i]);
        minZ = Math.min(minZ, a.r[i + 1]);
        maxZ = Math.max(maxZ, a.r[i + 1]);
      }
      const x = minX + r() * (maxX - minX);
      const z = minZ + r() * (maxZ - minZ);
      if (pointInRing(x, z, a.r) && pointInRing(x, z, this.campusRing) && !this.nav.collision.resolve(x, z, 0.8).hit) {
        return { x, z, yaw: r() * TAU, bench: false };
      }
    }
    const node = this.nav.randomNode(r);
    const [x, z] = this.nav.pos(node);
    return { x, z, yaw: r() * TAU, bench: false };
  }

  // Instant population of n people scattered over the campus (start-up and the manual slider).
  setCount(n) {
    n = clamp(Math.round(n), 0, OUTDOOR_MAX);
    this.targetAlive = n;
    for (let i = 0; i < OUTDOOR_MAX; i++) {
      this.npcs[i].alive = false;
      this.npcs[i].visible = false;
    }
    const r = rng(777);
    const plan = [];
    for (let i = 0; i < n; i++) {
      const k = r();
      plan.push(k < 0.68 ? 'walker' : k < 0.86 ? 'stander' : 'sitter');
    }
    this.plan = plan;
    this._seatsTaken = new Set();
    for (let i = 0; i < n; i++) {
      this.respawn(this.npcs[i], plan[i]);
      this.npcs[i].alive = true;
      this.npcs[i].leaving = false;
    }
    // Pair up some walkers (followers copy the leader's position).
    let i = 0;
    while (i < n - 2) {
      const a = this.npcs[i];
      const b = this.npcs[i + 1];
      if (plan[i] === 'walker' && plan[i + 1] === 'walker' && r() < 0.4) {
        b.leader = a;
        b.offset = [(r() < 0.5 ? -1 : 1) * (0.75 + r() * 0.25), 0.15 + r() * 0.3];
        b.state = 'follow';
        b.x = a.x + b.offset[0];
        b.z = a.z;
        a.jog = false;
        b.jog = false;
        i += 2;
      } else i += 1;
    }
  }

  // ---------------------------------------------------------------- flow
  // Removes a person from the world (they left through a gate or a building).
  _kill(n) {
    n.alive = false;
    n.visible = false;
    n.leaving = false;
    n.leader = null;
    if (n.seatKey) this._seatsTaken.delete(n.seatKey);
    n.seatKey = null;
    n.seat = null;
  }

  // Somebody appears: most walk in through a gate, some are already sitting or standing about
  // (only when far from the player, so nobody pops up in view).
  _spawnEntrant(n, px, pz) {
    const r = this.r;
    const roll = r();
    let kind = roll < this.mix.walker ? 'walker' : roll < this.mix.walker + this.mix.stander ? 'stander' : 'sitter';
    this.respawn(n, kind);
    if (kind !== 'walker' && Math.hypot(n.x - px, n.z - pz) < 25) {
      kind = 'walker';
      this.respawn(n, 'walker');
    }
    if (kind === 'walker') {
      if (this.gates.length) {
        const g = this.gates[Math.floor(r() * this.gates.length)];
        const node = this.nav.nearest(g.x, g.z);
        if (node >= 0) [n.x, n.z] = this.nav.pos(node);
      }
      if (Math.hypot(n.x - px, n.z - pz) < 12) {
        // Too close to the player: come out of a random door instead of popping up in front of them.
        const d = this.doorGoals[Math.floor(r() * this.doorGoals.length)];
        if (d && Math.hypot(d.x - px, d.z - pz) > 12) [n.x, n.z] = [d.x, d.z];
      }
      this._pickGoal(n);
    }
    n.y = this.hf.h(n.x, n.z);
    n.alive = true;
    n.leaving = false;
    n.visible = true;
  }

  // Somebody heads for the nearest gate and disappears there.
  _sendAway(n, px, pz) {
    if (n.state === 'inside') {
      this._kill(n);
      return;
    }
    if (this.gates.length) {
      let best = this.gates[0];
      for (const g of this.gates) if (Math.hypot(g.x - n.x, g.z - n.z) < Math.hypot(best.x - n.x, best.z - n.z)) best = g;
      n.leader = null;
      n.seat = null;
      if (n.seatKey) this._seatsTaken.delete(n.seatKey);
      n.seatKey = null;
      n.state = 'walk';
      n.goalKind = 'leave';
      n.doorIdx = -1;
      n.leaving = true;
      n.act = null;
      if (this._plan(n, best.x, best.z)) return;
    }
    if (Math.hypot(n.x - px, n.z - pz) > 25) this._kill(n);
  }

  _balance(px, pz) {
    // People already walking out do not count: they are gone as far as the target goes.
    let alive = 0;
    for (let i = 0; i < OUTDOOR_MAX; i++) if (this.npcs[i].alive && !this.npcs[i].leaving) alive++;
    const target = this.targetAlive;
    if (alive < target) {
      for (let added = 0, i = 0; i < OUTDOOR_MAX && added < Math.min(4, target - alive); i++) {
        if (!this.npcs[i].alive) {
          this._spawnEntrant(this.npcs[i], px, pz);
          added++;
        }
      }
    } else if (alive > target) {
      // Invisible people inside buildings go first, then walkers, then whoever is far away.
      const pool = [];
      for (let i = 0; i < OUTDOOR_MAX; i++) {
        const q = this.npcs[i];
        if (!q.alive || q.leaving) continue;
        const far = Math.hypot(q.x - px, q.z - pz) > 18;
        if (q.state === 'inside') pool.unshift(q);
        else if (far || q.state === 'walk') pool.push(q);
      }
      for (let k = 0; k < Math.min(5, alive - target, pool.length); k++) this._sendAway(pool[k], px, pz);
    }
  }

  // ---------------------------------------------------------------- update
  update(dt, player, camera) {
    this.time += dt;
    const r = this.r;
    const px = player.pos.x;
    const pz = player.pos.z;
    if (this.auto) {
      this.balanceT -= dt;
      if (this.balanceT <= 0) {
        this.balanceT = 0.7;
        this._balance(px, pz);
      }
    }
    for (let i = 0; i < MAX_NPC; i++) {
      const n = this.npcs[i];
      if (i < OUTDOOR_MAX && !n.alive) {
        // Dead outdoor slots stay hidden.
        if (n._hiddenWritten) continue;
        n._hiddenWritten = true;
        this._writeHidden(i);
        continue;
      }
      if (i < OUTDOOR_MAX) n._hiddenWritten = false;
      if (i >= OUTDOOR_MAX && !n.visible) {
        if (n._hiddenWritten) continue;
        n._hiddenWritten = true;
        this._writeHidden(i);
        continue;
      }
      n._hiddenWritten = false;
      this._step(n, dt, px, pz, r);
      n.y = n.fixedY !== null && n.fixedY !== undefined ? n.fixedY : this.hf.h(n.x, n.z);
      this._write(i, n, dt, px, pz);
    }
    this.humans.commit(this.time);
    this._bubblesUpdate(dt, player, camera);
  }

  _step(n, dt, px, pz, r) {
    n.phase += dt * Math.max(0.6, n.speed) * 4.2;
    if (n.wave > 0) n.wave -= dt;
    if (n.pause > 0) {
      // Stopped by a greeting: face the player and stand still.
      n.pause -= dt;
      n.speed += (0 - n.speed) * Math.min(1, dt * 6);
      if (n.state !== 'sit') n.yaw += angleDiff(n.yaw, n.greetYaw) * Math.min(1, dt * 4);
      return;
    }
    switch (n.state) {
      case 'walk': {
        if (!n.path) {
          this._pickGoal(n);
          if (!n.path) break;
        }
        const wp = n.path[n.pi];
        const dx = wp[0] - n.x;
        const dz = wp[1] - n.z;
        const dist = Math.hypot(dx, dz);
        const dpx = px - n.x;
        const dpz = pz - n.z;
        const dP = Math.hypot(dpx, dpz);
        let sp = n.targetSpeed;
        if (dP < 2.2) {
          const fx = -Math.sin(n.yaw);
          const fz = -Math.cos(n.yaw);
          if ((dpx * fx + dpz * fz) / (dP || 1) > 0.5) sp = 0;
        }
        n.speed += (sp - n.speed) * Math.min(1, dt * 4);
        if (dist < 0.45) {
          n.pi++;
          if (n.pi >= n.path.length) {
            n.path = null;
            this._arrive(n);
          }
          break;
        }
        const step = Math.min(dist, n.speed * dt);
        n.x += (dx / dist) * step;
        n.z += (dz / dist) * step;
        n.yaw += angleDiff(n.yaw, Math.atan2(-dx, -dz)) * Math.min(1, dt * 7);
        break;
      }
      case 'follow': {
        const L = n.leader;
        if (!L || !L.visible) {
          n.state = 'walk';
          break;
        }
        const fx = -Math.sin(L.yaw);
        const fz = -Math.cos(L.yaw);
        const rx = Math.cos(L.yaw);
        const rz = -Math.sin(L.yaw);
        const tx = L.x + rx * n.offset[0] - fx * n.offset[1];
        const tz = L.z + rz * n.offset[0] - fz * n.offset[1];
        const d = Math.hypot(tx - n.x, tz - n.z);
        n.speed += (Math.min(2.4, d * 3 + L.speed * 0.9) - n.speed) * Math.min(1, dt * 5);
        if (d > 0.02) {
          const s = Math.min(d, n.speed * dt + d * dt * 2);
          n.x += ((tx - n.x) / d) * s;
          n.z += ((tz - n.z) / d) * s;
        }
        n.yaw += angleDiff(n.yaw, L.yaw) * Math.min(1, dt * 5);
        break;
      }
      case 'idle': {
        n.speed += (0 - n.speed) * Math.min(1, dt * 6);
        n.yaw += angleDiff(n.yaw, n.faceYaw) * Math.min(1, dt * 3);
        n.timer -= dt;
        n.talkTimer -= dt;
        if (n.talkTimer <= 0) {
          n.talker = r() < 0.5;
          n.sip = n.cup && r() < 0.4;
          n.talkTimer = 2 + r() * 4;
        }
        if (n.timer <= 0) {
          n.state = 'walk';
          n.path = null;
        }
        break;
      }
      case 'toDoor': {
        const t = n.doorTarget;
        const dx = t.x - n.x;
        const dz = t.z - n.z;
        const dist = Math.hypot(dx, dz);
        n.speed += (1.3 - n.speed) * Math.min(1, dt * 4);
        if (dist < 0.3) {
          n.state = 'inside';
          n.insideTimer = this.director ? this.director.insideSeconds(r) : 8 + r() * 30;
          n.visible = false;
          n.insideBuilding = t.door.b;
          if (this.interiorHook) this.interiorHook(n, t.door);
          break;
        }
        const s = Math.min(dist, n.speed * dt);
        n.x += (dx / dist) * s;
        n.z += (dz / dist) * s;
        n.yaw += angleDiff(n.yaw, Math.atan2(-dx, -dz)) * Math.min(1, dt * 8);
        break;
      }
      case 'inside': {
        n.insideTimer -= dt;
        if (n.insideTimer <= 0) {
          const g = this.doorGoals[Math.floor(r() * this.doorGoals.length)];
          n.visible = true;
          n.x = g.door.x + g.door.nx * 0.5;
          n.z = g.door.z + g.door.nz * 0.5;
          n.yaw = Math.atan2(-g.door.nx, -g.door.nz);
          n.state = 'walk';
          n.path = null;
          n.insideBuilding = null;
        }
        break;
      }
      case 'sit':
        n.speed = 0;
        break;
      case 'iwalk': {
        // Interior walker: follow waypoints; ask the owner for a new route at the end.
        if (!n.path || n.pi >= n.path.length) {
          if (n.onArrive) n.onArrive(n);
          if (!n.path) break;
        }
        const wp = n.path[n.pi];
        const dx = wp[0] - n.x;
        const dz = wp[1] - n.z;
        const dist = Math.hypot(dx, dz);
        const dpx = px - n.x;
        const dpz = pz - n.z;
        const dP = Math.hypot(dpx, dpz);
        let sp = n.targetSpeed;
        if (dP < 1.6) {
          const fx = -Math.sin(n.yaw);
          const fz = -Math.cos(n.yaw);
          if ((dpx * fx + dpz * fz) / (dP || 1) > 0.4) sp = 0;
        }
        n.speed += (sp - n.speed) * Math.min(1, dt * 4);
        if (dist < 0.4) {
          n.pi++;
          break;
        }
        const step = Math.min(dist, n.speed * dt);
        n.x += (dx / dist) * step;
        n.z += (dz / dist) * step;
        n.yaw += angleDiff(n.yaw, Math.atan2(-dx, -dz)) * Math.min(1, dt * 7);
        break;
      }
      default:
        break;
    }
  }

  // ---- people inside buildings (reserved slots) ----
  clearInterior() {
    for (let i = OUTDOOR_MAX; i < MAX_NPC; i++) {
      const n = this.npcs[i];
      n.visible = false;
      n.onArrive = null;
      n.fixedY = null;
    }
    this._interiorUsed = 0;
  }

  // spec: { kind: 'sit' | 'stand' | 'walk', x, z, y, yaw, bench, path, onArrive }
  addInterior(spec) {
    const idx = OUTDOOR_MAX + (this._interiorUsed || 0);
    if (idx >= MAX_NPC) return null;
    this._interiorUsed = (this._interiorUsed || 0) + 1;
    const n = this.npcs[idx];
    const r = this.r;
    n.visible = true;
    n.fixedY = spec.y;
    n.x = spec.x;
    n.z = spec.z;
    n.yaw = spec.yaw || 0;
    n.speed = 0;
    n.leader = null;
    n.path = null;
    n.onArrive = null;
    n.phone = r() < 0.25;
    n.wave = 0;
    n.pause = 0;
    n.act = spec.activity || null;
    n.anim.clip = null;
    n.anim.prev = null;
    if (spec.kind === 'sit') {
      n.state = 'sit';
      n.seat = { bench: true };
      n.sitAct = spec.activity || pick(r, ['sit', 'sitWrite', 'sitWrite', 'sitPhone', 'sitTalk', 'sitType']);
    } else if (spec.kind === 'stand') {
      n.state = 'idle';
      n.faceYaw = spec.yaw;
      n.talker = r() < 0.5;
      n.timer = 1e9;
    } else if (spec.kind === 'walk') {
      n.state = 'iwalk';
      n.path = spec.path;
      n.pi = 1;
      n.onArrive = spec.onArrive;
      n.targetSpeed = 1.15 + r() * 0.4;
    }
    return n;
  }

  _writeHidden(i) {
    this.humans.hide(i);
  }

  // Which baked clip fits what this person is doing right now.
  _pickClip(n) {
    if (n.wave > 0) return 'wave';
    switch (n.state) {
      case 'sit':
        return n.sitAct;
      case 'idle':
        return n.act || (n.phone ? 'phone' : n.sip ? 'drink' : n.talker ? 'talk' : 'idle');
      default:
        if (n.speed > 0.3) {
          if (n.speed > 2.2) return 'run';
          return n.phone ? 'walkPhone' : n.book ? 'carry' : 'walk';
        }
        return n.phone ? 'phone' : 'idle';
    }
  }

  _clipRate(clip, speed) {
    return clip.nominal > 0 ? clamp(speed / clip.nominal, 0.4, 1.8) : 1;
  }

  _write(i, n, dt, px, pz) {
    const H = this.humans;
    if (!n.visible) {
      H.hide(i);
      return;
    }
    const clips = H.clips;
    const A = n.anim;
    const want = this._pickClip(n);
    if (A.clip !== want) {
      if (A.clip) {
        A.prev = A.clip;
        A.prevTime = A.time;
        A.blend = 1;
      }
      A.clip = want;
      // Stagger loops so a crowd does not move in lock step.
      A.time = A.prev ? 0 : (n.phase % TAU) / TAU * clips[want].duration;
    }
    const c = clips[A.clip];
    A.time += dt * this._clipRate(c, n.speed);
    if (A.prev) {
      A.prevTime += dt * this._clipRate(clips[A.prev], n.speed);
      A.blend -= dt / 0.25;
      if (A.blend <= 0) {
        A.blend = 0;
        A.prev = null;
      }
    }
    // Head glance towards the player when close and roughly in front.
    let target = 0;
    const dx = px - n.x;
    const dz = pz - n.z;
    const d = Math.hypot(dx, dz);
    if (d > 0.6 && d < 7 && !HEAD_DOWN.has(A.clip)) {
      const rel = angleDiff(0, Math.atan2(dx, dz) - (n.yaw + Math.PI));
      if (Math.abs(rel) < 2.2) target = clamp(rel, -0.9, 0.9);
    }
    n.lookYaw += (target - n.lookYaw) * Math.min(1, dt * 4);
    const s = n.scale;
    const sxz = s * n.width;
    H.setPose(i, {
      x: n.x, y: n.y, z: n.z, yaw: n.yaw + Math.PI, sx: sxz, sy: s, sz: sxz,
      clip: A.clip, frame: A.time * c.fps,
      prev: A.prev, prevFrame: A.prev ? A.prevTime * clips[A.prev].fps : 0, blend: A.blend,
      lookYaw: n.lookYaw, lookPitch: 0, blink: n.blink,
      acc: (PHONE_CLIPS.has(A.clip) ? 1 << ACC.PHONE : 0) | (BOOK_CLIPS.has(A.clip) ? 1 << ACC.BOOK : 0),
    });
  }

  // The player greets somebody: they stop, turn, wave and answer.
  greet(npc, player, text) {
    npc.pause = 3.2;
    npc.wave = 2.4;
    npc.greetYaw = Math.atan2(-(player.pos.x - npc.x), -(player.pos.z - npc.z));
    this.say(npc, text || this.randomPhrase());
  }

  // --------------------------------------------------------------- bubbles
  _bubblesUpdate(dt, player, camera) {
    this.bubbleCooldown -= dt;
    for (const b of this.bubbles) {
      if (!b.npc) continue;
      b.life -= dt;
      const n = b.npc;
      const a = clamp(Math.min(b.life * 2, (b.total - b.life) * 3), 0, 1);
      b.sprite.material.opacity = a;
      b.sprite.position.set(n.x, n.y + n.scale * 1.95 + 0.3, n.z);
      if (b.life <= 0 || !n.visible) {
        b.npc = null;
        b.sprite.visible = false;
      }
    }
    if (this.bubbleCooldown > 0) return;
    this.bubbleCooldown = 1.2 + this.r() * 2.2;
    const free = this.bubbles.find((b) => !b.npc);
    if (!free) return;
    const fwd = new THREE.Vector3();
    camera.getWorldDirection(fwd);
    let best = null;
    let bd = 1e9;
    for (let i = 0; i < MAX_NPC; i++) {
      const n = this.npcs[i];
      if (i < OUTDOOR_MAX && !n.alive) continue;
      if (!n.visible || this.bubbles.some((b) => b.npc === n)) continue;
      const dx = n.x - player.pos.x;
      const dz = n.z - player.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < 3 || d > 11) continue;
      if ((dx * fwd.x + dz * fwd.z) / d < 0.35) continue;
      if (d < bd && this.r() < 0.5) {
        bd = d;
        best = n;
      }
    }
    if (!best) return;
    this.say(best, this.randomPhrase(), free);
  }

  say(npc, text, bubble) {
    const free = bubble || this.bubbles.find((b) => !b.npc) || this.bubbles[0];
    const t = this._bubbleTexture(text);
    free.sprite.material.map = t.tex;
    free.sprite.material.needsUpdate = true;
    free.sprite.scale.set(0.3 * t.aspect, 0.3, 1);
    free.sprite.visible = true;
    free.npc = npc;
    free.total = free.life = 3.6;
  }

  // Closest visible NPC to the player (for interaction prompts).
  nearest(player, maxDist = 3) {
    let best = null;
    let bd = maxDist;
    for (let i = 0; i < MAX_NPC; i++) {
      const n = this.npcs[i];
      if (i < OUTDOOR_MAX && !n.alive) continue;
      if (!n.visible) continue;
      const d = Math.hypot(n.x - player.pos.x, n.z - player.pos.z);
      if (d < bd) {
        bd = d;
        best = n;
      }
    }
    return best;
  }

  randomPhrase() {
    const ctx = PHRASES_CTX[this.phraseCtx];
    if (ctx && this.r() < 0.7) return ctx[Math.floor(this.r() * ctx.length)];
    return PHRASES[Math.floor(this.r() * PHRASES.length)];
  }
}
