// Terrain meshes: fine core around the campus, coarser regional ring, distant horizon
// ring and the sea plane.

import * as THREE from 'three';
import { CORE_HALF, CORE_CELL } from './heightfield.js';

const OUTER_CELL = 16;
const HORIZON_CELL = 128;
const HORIZON_HALF = 9000;

function gridMesh({ x0, z0, nx, nz, cell, height, skip, uvFn }) {
  const count = nx * nz;
  const pos = new Float32Array(count * 3);
  const nor = new Float32Array(count * 3);
  const uv = new Float32Array(count * 2);
  const hs = new Float32Array(count);
  for (let iz = 0; iz < nz; iz++) {
    for (let ix = 0; ix < nx; ix++) {
      const x = x0 + ix * cell;
      const z = z0 + iz * cell;
      hs[iz * nx + ix] = height(x, z, ix, iz);
    }
  }
  for (let iz = 0; iz < nz; iz++) {
    for (let ix = 0; ix < nx; ix++) {
      const i = iz * nx + ix;
      const x = x0 + ix * cell;
      const z = z0 + iz * cell;
      pos[i * 3] = x;
      pos[i * 3 + 1] = hs[i];
      pos[i * 3 + 2] = z;
      const hl = hs[iz * nx + Math.max(0, ix - 1)];
      const hr = hs[iz * nx + Math.min(nx - 1, ix + 1)];
      const hu = hs[Math.max(0, iz - 1) * nx + ix];
      const hd = hs[Math.min(nz - 1, iz + 1) * nx + ix];
      let gx = (hl - hr) / (2 * cell);
      let gz = (hu - hd) / (2 * cell);
      const len = Math.hypot(gx, 1, gz);
      gx /= len;
      gz /= len;
      nor[i * 3] = gx;
      nor[i * 3 + 1] = 1 / len;
      nor[i * 3 + 2] = gz;
      if (uvFn) {
        const [u, v] = uvFn(x, z);
        uv[i * 2] = u;
        uv[i * 2 + 1] = v;
      }
    }
  }
  const idx = [];
  for (let iz = 0; iz < nz - 1; iz++) {
    for (let ix = 0; ix < nx - 1; ix++) {
      if (skip && skip(x0 + (ix + 0.5) * cell, z0 + (iz + 0.5) * cell)) continue;
      const a = iz * nx + ix;
      const b = a + 1;
      const c = a + nx;
      const d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

export function buildTerrain(hf, { coreTex, farTex, detailNormal, bounds, pavedMask, holeMask, holeRect, quality = 1 }) {
  const group = new THREE.Group();
  const span = 2 * CORE_HALF;

  const detailCore = detailNormal.clone();
  detailCore.repeat.set(span / 3.2, span / 3.2);
  detailCore.needsUpdate = true;
  const coreMat = new THREE.MeshStandardMaterial({
    map: coreTex,
    normalMap: detailCore,
    normalScale: new THREE.Vector2(0.22, 0.22),
    roughness: 0.96,
    metalness: 0,
  });
  // Paver pattern on plazas, sidewalks and footpaths (fades out with distance).
  coreMat.onBeforeCompile = (shader) => {
    shader.uniforms.uPaved = { value: pavedMask };
    shader.uniforms.uHole = { value: holeMask };
    shader.uniforms.uHoleRect = { value: new THREE.Vector4(holeRect.x, holeRect.z, holeRect.w, holeRect.h) };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vPavedUv;\nvarying vec2 vWorldXZ;\nvarying float vViewDist;')
      .replace('#include <project_vertex>', `#include <project_vertex>
        vWorldXZ = position.xz;
        vPavedUv = vec2((position.x + ${CORE_HALF.toFixed(1)}) / ${(2 * CORE_HALF).toFixed(1)}, 1.0 - (position.z + ${CORE_HALF.toFixed(1)}) / ${(2 * CORE_HALF).toFixed(1)});
        vViewDist = length(mvPosition.xyz);`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D uPaved;
        uniform sampler2D uHole;
        uniform vec4 uHoleRect;
        varying vec2 vPavedUv;
        varying vec2 vWorldXZ;
        varying float vViewDist;
        float ph(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        {
          vec2 huv = (vWorldXZ - uHoleRect.xy) / uHoleRect.zw;
          if (huv.x > 0.0 && huv.x < 1.0 && huv.y > 0.0 && huv.y < 1.0 && texture2D(uHole, vec2(huv.x, 1.0 - huv.y)).r > 0.5) discard;
          float paved = texture2D(uPaved, vPavedUv).r;
          vec2 p = vWorldXZ / 0.6;
          vec2 f = abs(fract(p) - 0.5) * 2.0;
          float joint = smoothstep(0.9, 0.985, max(f.x, f.y));
          float k = 1.0 - joint * 0.16 + (ph(floor(p)) - 0.5) * 0.07;
          float fadeD = 1.0 - smoothstep(12.0, 42.0, vViewDist);
          diffuseColor.rgb *= mix(1.0, k, paved * fadeD);
        }`);
  };
  const coreGeo = gridMesh({
    x0: -CORE_HALF,
    z0: -CORE_HALF,
    nx: hf.n,
    nz: hf.n,
    cell: CORE_CELL,
    height: (x, z, ix, iz) => hf.core[iz * hf.n + ix],
    uvFn: (x, z) => [(x + CORE_HALF) / span, 1 - (z + CORE_HALF) / span],
  });
  const core = new THREE.Mesh(coreGeo, coreMat);
  core.receiveShadow = true;
  core.name = 'terrain-core';
  group.add(core);

  // Regional ring (DEM extent), hole where the core sits.
  const X0 = Math.floor(bounds.xMin / OUTER_CELL) * OUTER_CELL;
  const X1 = Math.ceil(bounds.xMax / OUTER_CELL) * OUTER_CELL;
  const Z0 = Math.floor(bounds.zMin / OUTER_CELL) * OUTER_CELL;
  const Z1 = Math.ceil(bounds.zMax / OUTER_CELL) * OUTER_CELL;
  const detailFar = detailNormal.clone();
  detailFar.repeat.set((X1 - X0) / 14, (Z1 - Z0) / 14);
  detailFar.needsUpdate = true;
  const farMat = new THREE.MeshStandardMaterial({
    map: farTex,
    normalMap: detailFar,
    normalScale: new THREE.Vector2(0.4, 0.4),
    roughness: 1,
    metalness: 0,
  });
  const outerGeo = gridMesh({
    x0: X0,
    z0: Z0,
    nx: Math.round((X1 - X0) / OUTER_CELL) + 1,
    nz: Math.round((Z1 - Z0) / OUTER_CELL) + 1,
    cell: OUTER_CELL,
    height: (x, z) => hf.dem(x, z),
    skip: (cx, cz) => Math.abs(cx) < CORE_HALF && Math.abs(cz) < CORE_HALF,
    uvFn: (x, z) => [(x - bounds.xMin) / (bounds.xMax - bounds.xMin), 1 - (z - bounds.zMin) / (bounds.zMax - bounds.zMin)],
  });
  const outer = new THREE.Mesh(outerGeo, farMat);
  outer.receiveShadow = quality > 0;
  outer.name = 'terrain-outer';
  group.add(outer);

  // Horizon ring: flat extension of the DEM edge values out to the fog.
  const hn = Math.round((2 * HORIZON_HALF) / HORIZON_CELL) + 1;
  const horizonGeo = gridMesh({
    x0: -HORIZON_HALF,
    z0: -HORIZON_HALF,
    nx: hn,
    nz: hn,
    cell: HORIZON_CELL,
    height: (x, z) => hf.dem(x, z) - 1.5,
    skip: (cx, cz) => cx > X0 - HORIZON_CELL && cx < X1 + HORIZON_CELL && cz > Z0 - HORIZON_CELL && cz < Z1 + HORIZON_CELL,
  });
  const horizon = new THREE.Mesh(horizonGeo, new THREE.MeshStandardMaterial({ color: '#56643f', roughness: 1 }));
  horizon.name = 'terrain-horizon';
  group.add(horizon);

  // Sea (Izmir Bay), north of the campus.
  const seaNormal = detailNormal.clone();
  seaNormal.repeat.set(220, 220);
  seaNormal.needsUpdate = true;
  const seaMat = new THREE.MeshPhongMaterial({
    color: '#2b6f95',
    specular: '#9fb9cc',
    shininess: 70,
    normalMap: seaNormal,
    normalScale: new THREE.Vector2(0.35, 0.35),
  });
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(40000, 40000), seaMat);
  sea.rotation.x = -Math.PI / 2;
  sea.position.set(0, -hf.y0 + 0.35, -20000 + 200);
  sea.name = 'sea';
  group.add(sea);

  return { group, core, outer, sea, seaMat, seaNormal };
}
