// Sky dome, sun/moon, lighting and fog driven by a time of day (hours, local solar-ish time).
// Sun position uses real solar geometry for Balcova on 29 September (declination about -2.7 deg).

import * as THREE from 'three';
import { clamp, lerp, smoothstep } from './util.js';

const LAT = (38.3887 * Math.PI) / 180;
const DECL = (-2.7 * Math.PI) / 180;
const SOLAR_NOON = 13.05; // local clock hour (UTC+3) for lon 27.04E in late September

const skyVert = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    vec4 p = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * p;
    gl_Position.z = gl_Position.w; // always at the far plane
  }
`;

const skyFrag = /* glsl */ `
  #include <common>
  uniform vec3 uZenith;
  uniform vec3 uHorizon;
  uniform vec3 uGround;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform vec3 uMoonDir;
  uniform vec3 uCloud;
  uniform float uNight;
  uniform float uGlow;
  uniform float uTime;
  varying vec3 vDir;

  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash21(i), hash21(i + vec2(1, 0)), f.x), mix(hash21(i + vec2(0, 1)), hash21(i + vec2(1, 1)), f.x), f.y);
  }
  float fbm(vec2 p) {
    float a = 0.5;
    float s = 0.0;
    for (int i = 0; i < 5; i++) {
      s += a * noise(p);
      p = p * 2.03 + 17.1;
      a *= 0.5;
    }
    return s;
  }
  void main() {
    vec3 d = normalize(vDir);
    float h = d.y;
    vec3 col = mix(uHorizon, uZenith, pow(clamp(h, 0.0, 1.0), 0.42));
    col = mix(col, uGround, smoothstep(0.0, -0.18, h));

    float sd = max(dot(d, uSunDir), 0.0);
    col += uSunColor * (pow(sd, 1500.0) * 9.0 + pow(sd, 28.0) * 0.32 * uGlow + pow(sd, 5.0) * 0.14 * uGlow);

    // Moon
    float md = max(dot(d, uMoonDir), 0.0);
    col += vec3(0.75, 0.8, 0.95) * pow(md, 2500.0) * 3.0 * uNight;
    col += vec3(0.15, 0.2, 0.35) * pow(md, 40.0) * 0.5 * uNight;

    // Stars
    if (h > 0.0 && uNight > 0.02) {
      vec2 sp = d.xz / (d.y + 0.35) * 190.0;
      float s = hash21(floor(sp));
      float tw = 0.65 + 0.35 * sin(uTime * 2.0 + s * 60.0);
      col += vec3(1.0) * step(0.9965, s) * tw * uNight * smoothstep(0.02, 0.3, h);
    }

    // Clouds on a virtual plane
    if (h > 0.01) {
      vec2 cp = d.xz / (h + 0.22) * 1.35 + vec2(uTime * 0.006, uTime * 0.002);
      float c = fbm(cp);
      float cover = smoothstep(0.5, 0.8, c) * smoothstep(0.01, 0.22, h);
      float edge = smoothstep(0.5, 0.95, c);
      vec3 cc = mix(uCloud * 0.72, uCloud, edge);
      col = mix(col, cc, cover * 0.85);
    }
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const C = (h) => new THREE.Color(h);
const lerpColor = (out, a, b, t) => out.copy(a).lerp(b, clamp(t, 0, 1));

export class Sky {
  constructor(scene, quality = 1) {
    this.scene = scene;
    this.hours = 15.5;
    this.time = 0;
    this.sunDir = new THREE.Vector3(0, 1, 0);
    this.moonDir = new THREE.Vector3(0, -1, 0);
    this.night = 0;
    this.sunAlt = 1;
    this.sunScale = 1; // reduced while the player is inside a building
    this.sunBase = 0;
    this.moonBase = 0;

    this.uniforms = {
      uZenith: { value: C('#3d7fd0') },
      uHorizon: { value: C('#b9d4ee') },
      uGround: { value: C('#8fa1a8') },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunColor: { value: C('#fff2d6') },
      uMoonDir: { value: new THREE.Vector3(0, -1, 0) },
      uCloud: { value: C('#ffffff') },
      uNight: { value: 0 },
      uGlow: { value: 1 },
      uTime: { value: 0 },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: skyVert,
      fragmentShader: skyFrag,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false,
    });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), mat);
    this.dome.scale.setScalar(4000);
    this.dome.renderOrder = -10;
    this.dome.frustumCulled = false;
    scene.add(this.dome);

    this.sun = new THREE.DirectionalLight('#fff4de', 3);
    this.sun.castShadow = quality > 0;
    const size = quality > 1 ? 4096 : 2048;
    this.sun.shadow.mapSize.set(size, size);
    this.shadowHalf = 130;
    const sc = this.sun.shadow.camera;
    sc.left = -this.shadowHalf;
    sc.right = this.shadowHalf;
    sc.top = this.shadowHalf;
    sc.bottom = -this.shadowHalf;
    sc.near = 20;
    sc.far = 900;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.6;
    scene.add(this.sun);
    scene.add(this.sun.target);

    this.moon = new THREE.DirectionalLight('#8ea6ff', 0);
    scene.add(this.moon);

    this.hemi = new THREE.HemisphereLight('#bcd6f5', '#4b4a38', 0.6);
    scene.add(this.hemi);

    this.fog = new THREE.FogExp2('#b9d4ee', 0.00042);
    scene.fog = this.fog;

    this.pmrem = null;
    this.envRT = null;
    this.envDirty = true;
    this.envHours = -99;
    this._envTimer = 0;
    this._tmp = new THREE.Color();
    this._right = new THREE.Vector3();
    this._up = new THREE.Vector3();
    this.hooks = [];
    this.setTime(this.hours);
  }

  solar(hours) {
    const H = ((hours - SOLAR_NOON) * 15 * Math.PI) / 180;
    const east = -Math.cos(DECL) * Math.sin(H);
    const north = Math.sin(DECL) * Math.cos(LAT) - Math.cos(DECL) * Math.sin(LAT) * Math.cos(H);
    const up = Math.sin(DECL) * Math.sin(LAT) + Math.cos(DECL) * Math.cos(LAT) * Math.cos(H);
    return new THREE.Vector3(east, up, -north).normalize();
  }

  // Image based lighting from the live sky: ambient light and reflections follow the time of day.
  initEnv(renderer) {
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envScene = new THREE.Scene();
    const d = new THREE.Mesh(this.dome.geometry, this.dome.material);
    d.scale.setScalar(4000);
    d.frustumCulled = false;
    this.envScene.add(d);
    this.updateEnv();
  }

  // Outdoor materials take a bit less than full image based lighting; interiors set their own.
  tuneEnv(scene, k = 0.75) {
    const seen = new Set();
    scene.traverse((o) => {
      const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
      for (const m of mats) {
        if (seen.has(m) || !m.isMeshStandardMaterial) continue;
        seen.add(m);
        if (m.envMapIntensity === 1) m.envMapIntensity = k;
      }
    });
  }

  updateEnv() {
    if (!this.pmrem) return;
    const rt = this.pmrem.fromScene(this.envScene, 0, 1, 9000);
    if (this.envRT) this.envRT.dispose();
    this.envRT = rt;
    this.scene.environment = rt.texture;
    this.envHours = this.hours;
    this.envDirty = false;
  }

  setTime(hours) {
    this.hours = ((hours % 24) + 24) % 24;
    if (Math.abs(this.hours - this.envHours) > 0.1) this.envDirty = true;
    const dir = this.solar(this.hours);
    this.sunDir.copy(dir);
    this.moonDir.set(-dir.x, -dir.y, -dir.z);
    // Tilt the moon path a little so it is not an exact mirror of the sun.
    this.moonDir.x += 0.15;
    this.moonDir.normalize();
    const alt = dir.y; // sin(altitude)
    this.sunAlt = alt;

    const day = smoothstep(-0.06, 0.22, alt);
    const twilight = clamp(1 - Math.abs(alt) / 0.24, 0, 1) * (alt > -0.25 ? 1 : 0);
    const night = 1 - smoothstep(-0.2, 0.02, alt);
    this.night = night;

    const zenithDay = C('#3a78c8');
    const zenithNight = C('#050a1c');
    const horizonDay = C('#bcd5ee');
    const horizonNight = C('#0d1730');
    const dusk = C('#f39a5b');
    const zenith = new THREE.Color();
    const horizon = new THREE.Color();
    lerpColor(zenith, zenithNight, zenithDay, day);
    lerpColor(horizon, horizonNight, horizonDay, day);
    horizon.lerp(dusk, twilight * 0.65 * (1 - night * 0.3));
    zenith.lerp(C('#4c5c92'), twilight * 0.35);

    this.uniforms.uZenith.value.copy(zenith);
    this.uniforms.uHorizon.value.copy(horizon);
    this.uniforms.uGround.value.copy(horizon).multiplyScalar(0.85);
    this.uniforms.uSunDir.value.copy(dir);
    this.uniforms.uMoonDir.value.copy(this.moonDir);
    this.uniforms.uNight.value = night;
    const sunCol = new THREE.Color().copy(C('#ff9d58')).lerp(C('#fff4dc'), smoothstep(0.02, 0.5, alt));
    this.uniforms.uSunColor.value.copy(sunCol);
    this.uniforms.uGlow.value = 0.6 + twilight * 1.4;
    const cloud = new THREE.Color().copy(C('#2a3350')).lerp(C('#f6f7fa'), day).lerp(C('#ffc9a0'), twilight * 0.55);
    this.uniforms.uCloud.value.copy(cloud);

    this.sun.color.copy(sunCol);
    this.sunBase = 3.4 * smoothstep(-0.02, 0.28, alt);
    this.sun.intensity = this.sunBase * this.sunScale;
    this.sun.visible = alt > -0.04;
    this.moonBase = 0.95 * night * (this.moonDir.y > 0 ? 1 : 0.35);
    this.moon.intensity = this.moonBase * this.sunScale;
    const hemiDay = new THREE.Color().copy(zenith).lerp(C('#ffffff'), 0.6);
    this.hemi.color.copy(C('#5d70ac')).lerp(hemiDay, day);
    this.hemi.groundColor.copy(C('#7a745c')).lerp(C('#33405f'), night);
    this.hemi.intensity = lerp(0.85, 0.45, day) + twilight * 0.1;
    this.fog.color.copy(horizon);
    this.fog.density = lerp(0.00062, 0.00038, day);
    this.scene.background = null;
    for (const h of this.hooks) h(this);
  }

  setSunScale(k) {
    this.sunScale = k;
    this.sun.intensity = this.sunBase * k;
    this.moon.intensity = this.moonBase * k;
  }

  // Keep the shadow frustum centred on the player, snapped to shadow texels.
  follow(target, camera) {
    this.dome.position.copy(camera.position);
    const L = this.sunDir;
    const texel = (2 * this.shadowHalf) / this.sun.shadow.mapSize.x;
    this._right.set(-L.z, 0, L.x).normalize();
    this._up.crossVectors(L, this._right).normalize();
    const tx = Math.round(target.dot(this._right) / texel) * texel;
    const ty = Math.round(target.dot(this._up) / texel) * texel;
    const tl = target.dot(L);
    const snapped = new THREE.Vector3().addScaledVector(this._right, tx).addScaledVector(this._up, ty).addScaledVector(L, tl);
    this.sun.target.position.copy(snapped);
    this.sun.position.copy(snapped).addScaledVector(L, 420);
    this.sun.target.updateMatrixWorld();
    this.moon.position.copy(target).addScaledVector(this.moonDir, 300);
    this.moon.target.position.copy(target);
    this.moon.target.updateMatrixWorld();
  }

  update(dt) {
    this.time += dt;
    this.uniforms.uTime.value = this.time;
    this._envTimer += dt;
    if (this.envDirty && this.pmrem && this._envTimer > 0.6) {
      this._envTimer = 0;
      this.updateEnv();
    }
  }
}
