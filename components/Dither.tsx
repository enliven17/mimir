"use client";

// Dither — animated dithered wave field (react-bits look), implemented in raw
// three.js (no @react-three/fiber / postprocessing) to avoid React-internals
// incompatibilities under Next 16. Wave + Bayer dither + pixelation run in a
// single fullscreen fragment pass. Base navy → white wave so it blends with the
// blueprint page.
// ponytail: single-pass shader instead of an EffectComposer chain — re-add a
// post pipeline only if a second effect is ever needed.
import { useEffect, useRef } from "react";
import * as THREE from "three";
import "./Dither.css";

interface DitherProps {
  waveSpeed?: number;
  waveFrequency?: number;
  waveAmplitude?: number;
  waveColor?: [number, number, number];
  colorNum?: number;
  pixelSize?: number;
  disableAnimation?: boolean;
  enableMouseInteraction?: boolean;
  mouseRadius?: number;
}

const VERTEX_SRC = `
void main() {
  gl_Position = vec4(position, 1.0);
}
`;

const FRAGMENT_SRC = `
precision highp float;

uniform vec2  uResolution;
uniform float uTime;
uniform float uWaveSpeed;
uniform float uWaveFrequency;
uniform float uWaveAmplitude;
uniform vec3  uWaveColor;
uniform float uColorNum;
uniform float uPixelSize;
uniform vec2  uMousePos;
uniform int   uEnableMouse;
uniform float uMouseRadius;

out vec4 fragColor;

vec4 mod289(vec4 x){ return x - floor(x * (1.0/289.0)) * 289.0; }
vec4 permute(vec4 x){ return mod289(((x * 34.0) + 1.0) * x); }
vec4 taylorInvSqrt(vec4 r){ return 1.79284291400159 - 0.85373472095314 * r; }
vec2 fade(vec2 t){ return t*t*t*(t*(t*6.0-15.0)+10.0); }

float cnoise(vec2 P){
  vec4 Pi = floor(P.xyxy) + vec4(0.0,0.0,1.0,1.0);
  vec4 Pf = fract(P.xyxy) - vec4(0.0,0.0,1.0,1.0);
  Pi = mod289(Pi);
  vec4 ix = Pi.xzxz;
  vec4 iy = Pi.yyww;
  vec4 fx = Pf.xzxz;
  vec4 fy = Pf.yyww;
  vec4 i = permute(permute(ix) + iy);
  vec4 gx = fract(i * (1.0/41.0)) * 2.0 - 1.0;
  vec4 gy = abs(gx) - 0.5;
  vec4 tx = floor(gx + 0.5);
  gx = gx - tx;
  vec2 g00 = vec2(gx.x, gy.x);
  vec2 g10 = vec2(gx.y, gy.y);
  vec2 g01 = vec2(gx.z, gy.z);
  vec2 g11 = vec2(gx.w, gy.w);
  vec4 norm = taylorInvSqrt(vec4(dot(g00,g00), dot(g01,g01), dot(g10,g10), dot(g11,g11)));
  g00 *= norm.x; g01 *= norm.y; g10 *= norm.z; g11 *= norm.w;
  float n00 = dot(g00, vec2(fx.x, fy.x));
  float n10 = dot(g10, vec2(fx.y, fy.y));
  float n01 = dot(g01, vec2(fx.z, fy.z));
  float n11 = dot(g11, vec2(fx.w, fy.w));
  vec2 fade_xy = fade(Pf.xy);
  vec2 n_x = mix(vec2(n00, n01), vec2(n10, n11), fade_xy.x);
  return 2.3 * mix(n_x.x, n_x.y, fade_xy.y);
}

const int OCTAVES = 4;
float fbm(vec2 p){
  float value = 0.0;
  float amp = 1.0;
  float freq = uWaveFrequency;
  for (int i = 0; i < OCTAVES; i++){
    value += amp * abs(cnoise(p));
    p *= freq;
    amp *= uWaveAmplitude;
  }
  return value;
}

float pattern(vec2 p){
  vec2 p2 = p - uTime * uWaveSpeed;
  return fbm(p + fbm(p2));
}

float bayer8(vec2 c){
  int x = int(mod(c.x, 8.0));
  int y = int(mod(c.y, 8.0));
  int idx = y * 8 + x;
  // 8x8 Bayer matrix, normalised /64
  float m[64];
  m[0]=0.0; m[1]=48.0; m[2]=12.0; m[3]=60.0; m[4]=3.0; m[5]=51.0; m[6]=15.0; m[7]=63.0;
  m[8]=32.0; m[9]=16.0; m[10]=44.0; m[11]=28.0; m[12]=35.0; m[13]=19.0; m[14]=47.0; m[15]=31.0;
  m[16]=8.0; m[17]=56.0; m[18]=4.0; m[19]=52.0; m[20]=11.0; m[21]=59.0; m[22]=7.0; m[23]=55.0;
  m[24]=40.0; m[25]=24.0; m[26]=36.0; m[27]=20.0; m[28]=43.0; m[29]=27.0; m[30]=39.0; m[31]=23.0;
  m[32]=2.0; m[33]=50.0; m[34]=14.0; m[35]=62.0; m[36]=1.0; m[37]=49.0; m[38]=13.0; m[39]=61.0;
  m[40]=34.0; m[41]=18.0; m[42]=46.0; m[43]=30.0; m[44]=33.0; m[45]=17.0; m[46]=45.0; m[47]=29.0;
  m[48]=10.0; m[49]=58.0; m[50]=6.0; m[51]=54.0; m[52]=9.0; m[53]=57.0; m[54]=5.0; m[55]=53.0;
  m[56]=42.0; m[57]=26.0; m[58]=38.0; m[59]=22.0; m[60]=41.0; m[61]=25.0; m[62]=37.0; m[63]=21.0;
  return m[idx] / 64.0;
}

void main(){
  // Pixelation: evaluate the wave at block centres.
  vec2 block = floor(gl_FragCoord.xy / uPixelSize) * uPixelSize + uPixelSize * 0.5;
  vec2 uv = block / uResolution;
  uv -= 0.5;
  uv.x *= uResolution.x / uResolution.y;

  float f = pattern(uv);

  if (uEnableMouse == 1) {
    vec2 mouseNDC = (uMousePos / uResolution - 0.5) * vec2(1.0, -1.0);
    mouseNDC.x *= uResolution.x / uResolution.y;
    float dist = length(uv - mouseNDC);
    float effect = 1.0 - smoothstep(0.0, uMouseRadius, dist);
    f -= 0.5 * effect;
  }

  // Base navy (#0A1E3D) → waveColor.
  vec3 col = mix(vec3(0.039, 0.118, 0.239), uWaveColor, f);

  // Bayer dither + quantise.
  float threshold = bayer8(floor(gl_FragCoord.xy / uPixelSize)) - 0.25;
  float stepv = 1.0 / (uColorNum - 1.0);
  col += threshold * stepv;
  col = clamp(col - 0.2, 0.0, 1.0);
  col = floor(col * (uColorNum - 1.0) + 0.5) / (uColorNum - 1.0);

  fragColor = vec4(col, 1.0);
}
`;

export default function Dither({
  waveSpeed = 0.05,
  waveFrequency = 3,
  waveAmplitude = 0.3,
  waveColor = [1, 1, 1],
  colorNum = 4,
  pixelSize = 2,
  disableAnimation = false,
  enableMouseInteraction = true,
  mouseRadius = 0.3,
}: DitherProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const visibleRef = useRef(true);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const canvas = document.createElement("canvas");
    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: "high-performance",
    });
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    container.appendChild(renderer.domElement);

    const uniforms = {
      uResolution: { value: new THREE.Vector2(1, 1) },
      uTime: { value: 0 },
      uWaveSpeed: { value: waveSpeed },
      uWaveFrequency: { value: waveFrequency },
      uWaveAmplitude: { value: waveAmplitude },
      uWaveColor: { value: new THREE.Color(...waveColor) },
      uColorNum: { value: colorNum },
      uPixelSize: { value: pixelSize * renderer.getPixelRatio() },
      uMousePos: { value: new THREE.Vector2(0, 0) },
      uEnableMouse: { value: enableMouseInteraction ? 1 : 0 },
      uMouseRadius: { value: mouseRadius },
    };

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const material = new THREE.ShaderMaterial({
      vertexShader: VERTEX_SRC,
      fragmentShader: FRAGMENT_SRC,
      uniforms,
      glslVersion: THREE.GLSL3,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
    scene.add(quad);

    const clock = new THREE.Clock();
    const setSize = () => {
      const w = container.clientWidth || 1;
      const h = container.clientHeight || 1;
      renderer.setSize(w, h, false);
      uniforms.uResolution.value.set(renderer.domElement.width, renderer.domElement.height);
      uniforms.uPixelSize.value = pixelSize * renderer.getPixelRatio();
    };
    setSize();
    const ro = new ResizeObserver(setSize);
    ro.observe(container);

    const onPointerMove = (e: PointerEvent) => {
      if (!enableMouseInteraction) return;
      const rect = renderer.domElement.getBoundingClientRect();
      const dpr = renderer.getPixelRatio();
      uniforms.uMousePos.value.set(
        (e.clientX - rect.left) * dpr,
        (e.clientY - rect.top) * dpr,
      );
    };
    renderer.domElement.addEventListener("pointermove", onPointerMove, { passive: true });

    const io = new IntersectionObserver(
      ([entry]) => {
        visibleRef.current = entry.isIntersecting;
      },
      { threshold: 0 },
    );
    io.observe(container);

    let raf = 0;
    const animate = () => {
      if (!visibleRef.current) {
        raf = requestAnimationFrame(animate);
        return;
      }
      if (!disableAnimation) uniforms.uTime.value = clock.getElapsedTime();
      renderer.render(scene, camera);
      raf = requestAnimationFrame(animate);
    };
    raf = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      quad.geometry.dispose();
      material.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      if (renderer.domElement.parentElement === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [
    waveSpeed,
    waveFrequency,
    waveAmplitude,
    waveColor,
    colorNum,
    pixelSize,
    disableAnimation,
    enableMouseInteraction,
    mouseRadius,
  ]);

  return (
    <div
      ref={containerRef}
      className="dither-container"
      aria-label="Dither animated background"
    />
  );
}
