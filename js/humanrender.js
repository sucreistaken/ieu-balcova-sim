// Instanced human renderer: plays baked vertex-animation textures on the GPU and applies
// per-instance clothing, skin, hair and accessory variants in the vertex shader.

import * as THREE from 'three';
import { buildHuman, ZONE } from './humanoid.js';

const DECL = /* glsl */ `
  attribute vec4 aInfo;
  attribute vec4 iPack0;
  attribute vec4 iPack1;
  attribute vec4 iAnim0;
  attribute vec4 iAnim1;
  attribute vec4 iLook;
  uniform sampler2D uVatPos;
  uniform sampler2D uVatNrm;
  uniform float uTexW;
  uniform float uRowsPerFrame;
  uniform float uTime;
  uniform vec2 uNeckV;
  varying vec3 vTint;
  varying vec3 vTintHi;
  varying float vSel;

  ivec2 vatCoord(float frame, float start, float vid) {
    float rowInFrame = floor(vid / uTexW);
    float x = mod(vid, uTexW);
    float y = (start + frame) * uRowsPerFrame + rowInFrame;
    return ivec2(int(x), int(y));
  }
  vec3 vatSample(sampler2D tex, vec4 anim, float vid) {
    float frames = max(anim.y, 1.0);
    float fr = mod(anim.z, frames);
    float f0 = floor(fr);
    float f1 = mod(f0 + 1.0, frames);
    float t = fract(fr);
    vec3 a = texelFetch(tex, vatCoord(f0, anim.x, vid), 0).xyz;
    vec3 b = texelFetch(tex, vatCoord(f1, anim.x, vid), 0).xyz;
    return mix(a, b, t);
  }
  bool flagBit(float v, float bit) {
    return mod(floor(v / exp2(bit) + 0.001), 2.0) > 0.5;
  }
  mat2 rot2(float a) { float c = cos(a); float s = sin(a); return mat2(c, -s, s, c); }
  // Colours travel as packed sRGB bytes (0xRRGGBB in a float) and are linearised here.
  vec3 unpackRGB(float v) {
    int i = int(v + 0.5);
    vec3 c = vec3(float((i >> 16) & 255), float((i >> 8) & 255), float(i & 255)) / 255.0;
    return pow(c, vec3(2.2));
  }
`;

// Computes the animated position/normal, the tint and the visibility of one vertex.
const CORE = /* glsl */ `
  vec3 bindPos = position;
  float zone = aInfo.x;
  float param = aInfo.y;
  float variant = aInfo.z;
  float vid = aInfo.w;
  vec3 vP = vatSample(uVatPos, iAnim0, vid);
  vec3 vN = vatSample(uVatNrm, iAnim0, vid);
  if (iAnim0.w > 0.001) {
    vP = mix(vP, vatSample(uVatPos, iAnim1, vid), iAnim0.w);
    vN = mix(vN, vatSample(uVatNrm, iAnim1, vid), iAnim0.w);
  }
  bool hideV = false;
  vec3 cShirt = unpackRGB(iPack0.x);
  vec3 cPants = unpackRGB(iPack0.y);
  vec3 cSkin = unpackRGB(iPack0.z);
  vec3 cHair = unpackRGB(iPack0.w);
  vec3 cShoe = unpackRGB(iPack1.x);
  vec3 cAccent = unpackRGB(iPack1.y);
  int m1 = int(iPack1.z + 0.5);
  int m2 = int(iPack1.w + 0.5);
  float sleeve = float(m1 & 255) / 255.0;
  float pantsLen = float((m1 >> 8) & 255) / 255.0;
  float hairStyle = float((m1 >> 16) & 15);
  float acc = float(m2 & 255);
  float extra = float((m2 >> 8) & 255);
  float gender = float((m2 >> 16) & 255) / 255.0;
  // Two-colour zones split at a threshold in the fragment stage (vSel > 0 picks the second colour)
  // so hems and cuffs stay crisp instead of blending across a ring.
  vec3 col = cSkin;
  vec3 col2 = cSkin;
  float sel = -1.0;
  if (zone < 0.5) {
    col = cSkin;
  } else if (zone < 1.5) {
    col = cPants;
    col2 = cShirt;
    sel = param - 0.985;
  } else if (zone < 2.5) {
    col = cShirt;
    col2 = cSkin;
    sel = param - min(sleeve, 0.985);
  } else if (zone < 3.5) {
    col = cPants;
    col2 = cSkin;
    sel = param - pantsLen;
  } else if (zone < 4.5) {
    col = cShoe;
  } else if (zone < 5.5) {
    col = cSkin;
  } else if (zone < 6.5) {
    hideV = abs(variant - hairStyle) > 0.5;
    col = cHair;
  } else if (zone < 7.5) {
    hideV = !(flagBit(acc, variant) || flagBit(iLook.z, variant));
    col = variant < 0.5 ? cAccent : (variant < 1.5 ? vec3(0.03) : (variant < 2.5 ? vec3(0.92, 0.9, 0.84) : (variant < 3.5 ? cAccent * 0.8 + 0.1 : (variant < 4.5 ? vec3(0.03) : cAccent))));
  } else if (zone < 8.5) {
    col = vec3(0.025, 0.02, 0.02);
  } else if (zone < 9.5) {
    col = cHair * 0.7;
  } else if (zone < 10.5) {
    col = cSkin * vec3(0.85, 0.6, 0.62);
  } else if (zone < 11.5) {
    hideV = !flagBit(extra, 0.0);
    col = cPants;
  } else {
    hideV = variant < 0.5 ? !flagBit(extra, 1.0) : !flagBit(extra, 2.0);
    col = cAccent;
  }
  // Eyes close briefly.
  if (zone > 7.5 && zone < 8.5) {
    float b = mod(uTime + iAnim1.w * 10.0, 4.0);
    float closed = 1.0 - smoothstep(0.0, 0.07, abs(b - 0.1));
    vP.y -= closed * 0.9 * (bindPos.y - 1.647);
  }
  // Gender shaping: wider hips, narrower shoulders.
  {
    float g = gender;
    float hipW = smoothstep(1.02, 0.86, bindPos.y);
    float shW = smoothstep(1.28, 1.40, bindPos.y) * (1.0 - smoothstep(1.43, 1.5, bindPos.y));
    vP.x *= 1.0 + g * (0.08 * hipW - 0.07 * shW);
  }
  // Head turns towards the look target (yaw, pitch) around the animated neck.
  bool isHead = (zone < 0.5 && bindPos.y > 1.525) || (zone > 5.5 && zone < 6.5) || (zone > 7.5 && zone < 10.5) || (zone > 11.5) || (zone > 6.5 && zone < 7.5 && variant > 0.5 && variant < 1.5);
  if (isHead) {
    vec3 pivot = 0.5 * (vatSample(uVatPos, iAnim0, uNeckV.x) + vatSample(uVatPos, iAnim0, uNeckV.y));
    vec3 d = vP - pivot;
    d.xz = rot2(iLook.x) * d.xz;
    d.yz = rot2(-iLook.y) * d.yz;
    vP = pivot + d;
    vec3 nn = vN;
    nn.xz = rot2(iLook.x) * nn.xz;
    vN = nn;
  }
`;

function patch(shader, { withNormal }) {
  shader.uniforms.uVatPos = this.uniforms.uVatPos;
  shader.uniforms.uVatNrm = this.uniforms.uVatNrm;
  shader.uniforms.uTexW = this.uniforms.uTexW;
  shader.uniforms.uRowsPerFrame = this.uniforms.uRowsPerFrame;
  shader.uniforms.uTime = this.uniforms.uTime;
  shader.uniforms.uNeckV = this.uniforms.uNeckV;
  let vs = shader.vertexShader.replace('#include <common>', `#include <common>\n${DECL}`);
  if (withNormal) {
    vs = vs
      .replace('#include <beginnormal_vertex>', `${CORE}\n vec3 objectNormal = normalize(vN);\n#ifdef USE_TANGENT\n vec3 objectTangent = vec3( tangent.xyz );\n#endif`)
      .replace('#include <begin_vertex>', 'vec3 transformed = vP;\n vTint = col; vTintHi = col2; vSel = sel;');
  } else {
    vs = vs.replace('#include <begin_vertex>', `${CORE}\n vec3 transformed = vP;`);
  }
  vs = vs.replace('#include <project_vertex>', '#include <project_vertex>\n if (hideV) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);');
  shader.vertexShader = vs;
  if (withNormal) {
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vTint;\nvarying vec3 vTintHi;\nvarying float vSel;')
      .replace('#include <map_fragment>', '#include <map_fragment>\n diffuseColor.rgb = vSel > 0.0 ? vTintHi : vTint;');
  }
}

export class HumanCrowd {
  constructor(max) {
    this.max = max;
    const human = buildHuman();
    this.human = human;
    this.clips = human.clips;
    const geo = human.geometry;
    geo.deleteAttribute('normal');
    // Two neck vertices (opposite sides) locate the animated neck for head turns.
    const info = geo.getAttribute('aInfo');
    let neckA = -1;
    let neckB = -1;
    const pos = geo.getAttribute('position');
    for (let i = 0; i < info.count; i++) {
      if (info.getX(i) === ZONE.NECK && Math.abs(pos.getY(i) - 1.48) < 0.005) {
        if (pos.getX(i) > 0.04 && neckA < 0) neckA = i;
        if (pos.getX(i) < -0.04 && neckB < 0) neckB = i;
      }
    }
    this.uniforms = {
      uVatPos: { value: human.posTex },
      uVatNrm: { value: human.nrmTex },
      uTexW: { value: human.texWidth },
      uRowsPerFrame: { value: human.rowsPerFrame },
      uTime: { value: 0 },
      uNeckV: { value: new THREE.Vector2(neckA, neckB) },
    };
    const mk = () => {
      const a = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4);
      a.setUsage(THREE.DynamicDrawUsage);
      return a;
    };
    this.attr = {};
    for (const name of ['iPack0', 'iPack1', 'iAnim0', 'iAnim1', 'iLook']) {
      this.attr[name] = mk();
      geo.setAttribute(name, this.attr[name]);
    }
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.82, metalness: 0 });
    mat.onBeforeCompile = (shader) => patch.call(this, shader, { withNormal: true });
    mat.customProgramCacheKey = () => 'human-vat';
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
    depth.onBeforeCompile = (shader) => patch.call(this, shader, { withNormal: false });
    depth.customProgramCacheKey = () => 'human-vat-depth';
    this.mesh.customDepthMaterial = depth;
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3();
    // Start with every instance hidden.
    for (let i = 0; i < max; i++) this.hide(i);
  }

  setCount(n) {
    this.mesh.count = n;
  }

  // Static look of one person. Colours are THREE.Color; everything is packed into two vec4s
  // (bytes inside float32 stay exact below 2^24) to stay under the vertex attribute limit.
  setLook(i, l) {
    const A = this.attr;
    const q8 = (v) => Math.max(0, Math.min(255, Math.round(v * 255)));
    const m1 = q8(l.sleeve) | (q8(l.pantsLen) << 8) | ((l.hairStyle & 15) << 16);
    const m2 = (l.flags & 255) | ((l.extra & 255) << 8) | (q8(l.gender) << 16);
    A.iPack0.setXYZW(i, l.shirt.getHex(), l.pants.getHex(), l.skin.getHex(), l.hair.getHex());
    A.iPack1.setXYZW(i, l.shoe.getHex(), l.accent.getHex(), m1, m2);
    A.iPack0.needsUpdate = true;
    A.iPack1.needsUpdate = true;
  }

  // Per-frame data: transform and animation state.
  // acc: accessory bits shown only while this pose is active (a phone while texting, a book while reading).
  setPose(i, { x, y, z, yaw, sx, sy, sz, clip, frame, prev, prevFrame, blend, lookYaw = 0, lookPitch = 0, blink = 0, acc = 0 }) {
    this._e.set(0, yaw, 0);
    this._q.setFromEuler(this._e);
    this._p.set(x, y, z);
    this._s.set(sx, sy, sz);
    this._m.compose(this._p, this._q, this._s);
    this.mesh.setMatrixAt(i, this._m);
    const A = this.attr;
    const c = this.clips[clip];
    A.iAnim0.setXYZW(i, c.start, c.frames, frame, prev ? blend : 0);
    const pc = prev ? this.clips[prev] : c;
    A.iAnim1.setXYZW(i, pc.start, pc.frames, prev ? prevFrame : 0, blink);
    A.iLook.setX(i, lookYaw);
    A.iLook.setY(i, lookPitch);
    A.iLook.setZ(i, acc);
  }

  hide(i) {
    this._m.makeScale(0, 0, 0);
    this.mesh.setMatrixAt(i, this._m);
  }

  commit(time) {
    this.uniforms.uTime.value = time;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.attr.iAnim0.needsUpdate = true;
    this.attr.iAnim1.needsUpdate = true;
    this.attr.iLook.needsUpdate = true;
  }
}
