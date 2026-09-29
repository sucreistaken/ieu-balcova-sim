// Entry point: loads the dataset, builds the world and runs the frame loop.

import * as THREE from 'three';
import { HeightField, CORE_HALF } from './heightfield.js';
import { paintGround, paintPavedMask, paintHoleMask } from './ground.js';
import { makeDetailNormal } from './textures.js';
import { buildTerrain } from './terrain.js';
import { buildBuildings } from './buildings.js';
import { Sky } from './sky.js';
import { Collision } from './collision.js';
import { Player } from './player.js';
import { buildVegetation } from './vegetation.js';
import { buildProps } from './props.js';
import { Crowd } from './crowd.js';
import { buildBoundary } from './boundary.js';
import { NavGrid } from './navgrid.js';
import { initUI } from './ui.js';
import { Interiors } from './interior.js';
import { PostFX } from './post.js';
import { applyArch } from './campus_arch.js';
import { Schedule, parseDate } from './schedule.js';
import { SimClock } from './clock.js';
import { LifeDirector } from './campuslife.js';
import { Easter } from './easter.js';

const $ = (s) => document.querySelector(s);
const params = new URLSearchParams(location.search);
const QUALITY = { low: 0, mid: 1, high: 2 }[params.get('q') || 'mid'] ?? 1;

const loadFill = $('#load-fill');
const loadStep = $('#load-step');
// setTimeout (not rAF) so loading also progresses in background tabs.
const timings = [];
let lastStep = performance.now();
const step = async (pct, text) => {
  const now = performance.now();
  timings.push([text, Math.round(now - lastStep)]);
  lastStep = now;
  loadFill.style.width = `${pct}%`;
  loadStep.textContent = text;
  await new Promise((r) => setTimeout(r, 16));
};

const HOLE_RECT = { x: -112, z: -114, w: 236, h: 236 };
const sim = { params, QUALITY, timings, errors: [] };
window.sim = sim;
// Debug aid: collect console errors and uncaught exceptions (read via sim.errors).
window.addEventListener('error', (e) => sim.errors.push(`window: ${e.message}`));
const consoleError = console.error.bind(console);
console.error = (...a) => {
  sim.errors.push(a.map(String).join(' ').slice(0, 400));
  consoleError(...a);
};

async function boot() {
  await step(3, 'Veri seti okunuyor');
  const data = await fetch('data/campus.json').then((r) => r.json());
  applyArch(data);
  // Official room codes, periods, calendar and opening hours (tools/build_real.mjs); optional.
  data.real = await fetch('data/real.json').then((r) => (r.ok ? r.json() : null)).catch(() => null);
  // Sources and limits shown in the data panel for the phase-2 layers.
  data.meta.sources.push(
    { label: 'İEÜ resmî sayfaları: SFL sınıf listesi, akademik takvim, OBS ders kayıt ekranı, tim.ieu.edu.tr çalışma saatleri, laboratuvar ve birim sayfaları', retrieved: (data.real && data.real.generated) || '2026-09-30' },
    { label: 'Wikimedia Commons kampüs fotoğrafları (CC BY-SA) ve uydu görüntüsü: yalnız bina yükseklik ve cephe kıyası için incelendi', retrieved: '2026-09-30' },
  );
  data.meta.notes.push(
    'Bina yükseklikleri ve cepheleri fotoğraflardan tahmin edildi (±1 kat); OSM\'de ana bina 6, yurt 5 kat görünüyor, fotoğraflarda 7-8 ve ~11.',
    ...((data.real && data.real.assumptions) || []),
  );
  sim.data = data;

  await step(10, 'Renderer hazırlanıyor');
  const canvas = $('#view');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: QUALITY > 0, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, QUALITY > 1 ? 2 : 1.5));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;
  renderer.shadowMap.enabled = QUALITY > 0;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.15, 7000);
  scene.add(camera);
  Object.assign(sim, { THREE, renderer, scene, camera });

  await step(18, 'Arazi yükseklikleri işleniyor');
  const hf = new HeightField(data.terrain);
  sim.hf = hf;

  await step(28, 'Binalar üretiliyor');
  const buildings = buildBuildings(data, hf, scene);
  sim.buildings = buildings;

  await step(50, 'Zemin dokusu çiziliyor');
  const maxTex = renderer.capabilities.maxTextureSize;
  const coreSize = Math.min(maxTex, QUALITY === 0 ? 2048 : 4096);
  const coreBounds = { xMin: -CORE_HALF, xMax: CORE_HALF, zMin: -CORE_HALF, zMax: CORE_HALF };
  const core = paintGround(data, coreBounds, coreSize, 'core');
  const t = data.terrain;
  const farBounds = { xMin: t.xMin, xMax: t.xMax, zMin: t.zMin, zMax: t.zMax };
  const far = paintGround(data, farBounds, 2048, 'far', (x, z) => hf.slope(x, z));
  sim.groundCanvas = core.canvas;

  await step(64, 'Arazi ağı kuruluyor');
  const terrain = buildTerrain(hf, {
    coreTex: core.texture,
    farTex: far.texture,
    detailNormal: makeDetailNormal(256, 2.2),
    pavedMask: paintPavedMask(data, CORE_HALF, 1024),
    holeMask: paintHoleMask(data, HOLE_RECT, 2048),
    holeRect: HOLE_RECT,
    bounds: farBounds,
    quality: QUALITY,
  });
  scene.add(terrain.group);
  sim.terrain = terrain;

  await step(74, 'Gökyüzü ve ışık');
  const sky = new Sky(scene, QUALITY);
  sim.sky = sky;
  sky.initEnv(renderer);
  sky.hooks.push((s) => {
    buildings.setNight(s.night);
    terrain.seaMat.color.set('#2b6f95').lerp(new THREE.Color('#0a1830'), s.night * 0.85);
  });

  await step(82, 'Çarpışmalar');
  const collision = new Collision();
  for (const w of buildings.walls) collision.addSegment(w);
  sim.collision = collision;

  await step(86, 'Ağaçlar dikiliyor');
  const veg = buildVegetation(data, hf, collision, QUALITY);
  scene.add(veg.group);
  sim.veg = veg;

  await step(89, 'Sokak mobilyası, teleferik ve trafik');
  const props = buildProps({ data, hf, buildings, collision, quality: QUALITY });
  scene.add(props.group);
  sim.props = props;
  sky.hooks.push((s) => props.setNight(s.night));
  props.setNight(sky.night);

  await step(92, 'İnsanlar yerleşiyor');
  const pathLines = data.roads.filter((r) => ['footway', 'path', 'pedestrian', 'steps', 'service'].includes(r.t)).map((r) => r.p);
  const navgrid = new NavGrid({ ring: data.campusRing, buildings: buildings.all, collision, hf, pathLines });
  sim.navgrid = navgrid;
  const crowd = new Crowd({ data, hf, scene, campusRing: data.campusRing, doors: data.doors, buildings, benches: props.benches, navgrid });
  sim.crowd = crowd;

  const boundary = buildBoundary({ data, hf, buildings, scene });
  sim.boundary = boundary;
  const eggs = new Easter({ data, hf, scene, collision, buildings, props, navgrid, boundary, sim });
  sim.eggs = eggs;

  const player = new Player(camera, canvas, hf, collision, { bound: 420 });
  player.boundary = boundary;
  sim.player = player;
  await step(94, 'İç mekânlar');
  const interior = new Interiors({ scene, data, hf, buildings, crowd, sim });
  sim.interior = interior;
  sim.player = player;
  // Spawn on the main plaza south of the entrance, looking north at the main building (the classic
  // view of the campus photographs).
  let sx = 16;
  let sz = 94;
  const nodeAt = navgrid.nearest(sx, sz);
  if (nodeAt >= 0) {
    const [nx, nz] = navgrid.pos(nodeAt);
    if (Math.hypot(nx - sx, nz - sz) < 8) {
      sx = nx;
      sz = nz;
    }
  }
  const spawnYaw = Math.atan2(-(17.6 - sx), -(58 - sz));
  player.teleport(sx, sz, spawnYaw);
  sim.spawn = { x: sx, z: sz, yaw: spawnYaw };
  // Calendar, clock and the life director. The date is today's real date unless ?date=YYYY-MM-DD.
  const schedule = new Schedule(data.real);
  const now = new Date();
  const startDate = params.get('date') ? parseDate(params.get('date')) : { y: now.getFullYear(), m: now.getMonth() + 1, d: now.getDate() };
  const simClock = new SimClock({ sky, schedule, date: startDate });
  const kind = simClock.info.type;
  simClock.setHours(parseFloat(params.get('t') || (kind === 'term' || kind === 'makeup' ? '9.3' : '12')));
  sim.schedule = schedule;
  sim.clock = simClock;
  crowd.setGates(boundary.gates);
  const life = new LifeDirector({ crowd, clock: simClock, schedule });
  sim.life = life;
  crowd.setCount(Math.round(schedule.crowdLevel(simClock.info, simClock.hours) * life.maxCrowd));
  crowd.auto = true;

  await step(96, 'Son hazırlıklar');

  sky.tuneEnv(scene, 0.75);
  const post = new PostFX(renderer, scene, camera, sky);
  post.userTier = QUALITY === 0 ? 1 : QUALITY === 1 ? 2 : 3;
  post.setTier(QUALITY === 0 ? 1 : QUALITY === 1 ? 2 : 3);
  sim.post = post;
  post.aoExclude.push(crowd.humans.mesh);
  const clock = new THREE.Clock();
  let fpsAcc = 0;
  let fpsN = 0;
  // One simulation + render step. Exposed so tests can drive frames in a background tab.
  function tick(dt) {
    player.update(dt);
    interior.update(dt, player);
    sky.update(dt);
    veg.update(dt);
    life.update(dt);
    eggs.update(dt, player, sky);
    crowd.update(dt, player, camera);
    props.update(dt, player, sky);
    boundary.update(dt);
    if (sim.ui) sim.ui.update(dt);
    sky.follow(player.pos, camera);
    terrain.seaNormal.offset.x += dt * 0.004;
    terrain.seaNormal.offset.y += dt * 0.0025;
    post.render(dt);
    fpsAcc += dt;
    fpsN++;
    if (fpsAcc > 0.5) {
      sim.fps = Math.round(fpsN / fpsAcc);
      fpsAcc = 0;
      fpsN = 0;
    }
  }
  sim.tick = tick;
  function frame() {
    tick(clock.getDelta());
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  window.addEventListener('resize', () => {
    post.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  });

  await step(97, 'Arayüz');
  const ui = initUI(sim);
  await step(100, 'Hazır');
  $('#loading').classList.add('hidden');
  interior.warm();
  $('#btn-start').addEventListener('click', () => ui.start());
  if (params.get('autostart')) {
    ui.start();
  } else {
    $('#start').classList.remove('hidden');
    ui.paintStart();
  }

  sim.tp = (x, z, yawDeg = 0) => player.teleport(x, z, (yawDeg * Math.PI) / 180);
  sim.time = (h) => sky.setTime(h);
}

boot().catch((err) => {
  console.error('[sim] boot failed', err);
  loadStep.textContent = `Hata: ${err.message}`;
});
