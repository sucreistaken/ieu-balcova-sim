// Post-processing chain: MSAA scene target, ground-truth ambient occlusion, bloom, film-like
// output. Quality tiers can be switched at runtime and adapt to the measured frame rate.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

// Subtle vignette and warm/cool split toning applied after tone mapping.
const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uVignette: { value: 0.28 }, uNight: { value: 0 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uVignette; uniform float uNight; varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec2 d = vUv - 0.5;
      float v = 1.0 - uVignette * smoothstep(0.35, 0.85, length(d) * 1.25);
      float l = dot(c.rgb, vec3(0.299, 0.587, 0.114));
      vec3 shadowTint = mix(vec3(0.97, 0.99, 1.03), vec3(0.94, 0.98, 1.08), uNight);
      vec3 highTint = vec3(1.03, 1.0, 0.96);
      c.rgb *= mix(shadowTint, highTint, smoothstep(0.15, 0.85, l));
      c.rgb = mix(vec3(l), c.rgb, 1.06);
      gl_FragColor = vec4(c.rgb * v, c.a);
    }`,
};

export const QUALITY_LABEL = ['Düşük', 'Orta', 'Yüksek', 'Ultra'];

export class PostFX {
  constructor(renderer, scene, camera, sky) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.sky = sky;
    this.tier = 2;
    this.maxTier = 3;
    this.auto = true;
    this.fpsAcc = 0;
    this.fpsFrames = 0;
    this.lowTime = 0;
    this.highTime = 0;
    this.pixelRatioBase = renderer.getPixelRatio();
    this._build();
    this.setTier(this.tier);
  }

  _build() {
    const { renderer, scene, camera } = this;
    const size = renderer.getSize(new THREE.Vector2());
    this.composer = new EffectComposer(renderer);
    this.composer.renderTarget1.samples = 4;
    this.composer.renderTarget2.samples = 4;
    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);

    this.gtao = new GTAOPass(scene, camera, size.x, size.y);
    this.gtao.updateGtaoMaterial({ radius: 0.9, distanceExponent: 1.2, thickness: 1.2, scale: 1.0, samples: 12, distanceFallOff: 1.0 });
    this.gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, radiusExponent: 1, rings: 2, samples: 12 });
    this.gtao.blendIntensity = 0.85;
    // Keep the sky dome out of the geometry buffers.
    const sky = this.sky;
    const over = this.gtao.overrideVisibility.bind(this.gtao);
    this.aoExclude = [];
    this.gtao.overrideVisibility = () => {
      over();
      sky.dome.visible = false;
      // Vertex-animated meshes would appear in their bind pose in the geometry buffers.
      for (const o of this.aoExclude) o.visible = false;
    };
    this.composer.addPass(this.gtao);

    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.22, 0.55, 1.0);
    this.composer.addPass(this.bloom);

    this.composer.addPass(new OutputPass());
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
  }

  // 0 direct render, 1 MSAA + bloom, 2 + ambient occlusion, 3 + full resolution AO
  setTier(t) {
    this.tier = Math.max(0, Math.min(this.maxTier, t));
    this.gtao.enabled = this.tier >= 2;
    this.bloom.enabled = this.tier >= 1;
    this.grade.enabled = this.tier >= 1;
    this.gtao.updateGtaoMaterial({ samples: this.tier >= 3 ? 16 : 10 });
    const pr = this.tier === 0 ? Math.min(this.pixelRatioBase, 1) : this.pixelRatioBase;
    this.renderer.setPixelRatio(pr);
    this.setSize(window.innerWidth, window.innerHeight);
    this.tierChanged && this.tierChanged(this.tier);
  }

  setSize(w, h) {
    this.renderer.setSize(w, h);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(w, h);
    this.gtao.setSize(w * this.renderer.getPixelRatio() * 0.75, h * this.renderer.getPixelRatio() * 0.75);
  }

  update(dt) {
    // Night: stronger bloom for lamps and windows, softer vignette in the dark.
    const n = this.sky.night;
    this.bloom.strength = 0.16 + n * 0.5;
    this.bloom.threshold = 1.0 - n * 0.25;
    this.grade.uniforms.uNight.value = n;
    this.grade.uniforms.uVignette.value = 0.24 + n * 0.1;
    // Adaptive quality: drop a tier when the frame rate stays low, raise it when there is headroom.
    if (!this.auto || dt <= 0 || dt > 0.5) return;
    this.fpsAcc += dt;
    this.fpsFrames++;
    if (this.fpsAcc < 1) return;
    const fps = this.fpsFrames / this.fpsAcc;
    this.fpsAcc = 0;
    this.fpsFrames = 0;
    if (fps < 38) {
      this.lowTime++;
      this.highTime = 0;
      if (this.lowTime >= 3 && this.tier > 0) {
        this.lowTime = 0;
        this.setTier(this.tier - 1);
      }
    } else if (fps > 58) {
      this.highTime++;
      this.lowTime = 0;
      if (this.highTime >= 12 && this.tier < this.userTier) {
        this.highTime = 0;
        this.setTier(this.tier + 1);
      }
    } else {
      this.lowTime = 0;
      this.highTime = 0;
    }
  }

  get userTier() {
    return this._userTier ?? this.maxTier;
  }

  set userTier(v) {
    this._userTier = v;
  }

  render(dt) {
    this.update(dt);
    if (this.tier === 0) {
      this.renderer.render(this.scene, this.camera);
      return;
    }
    this.composer.render(dt);
  }
}
