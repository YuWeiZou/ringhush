/**
 * Low-resolution 2D ray-stepped lightmap.
 *
 * Every lightmap cell casts one segment toward the pointer. Buttons are
 * opaque and stop the ray; glass panels multiply the ray by transmittance.
 * The result is upscaled and blurred by CSS (diffusion slider), so the light
 * behind a button is geometrically black, including the shadow it casts.
 *
 * This keeps the existing web framework; no WebGL is required.
 */
const OPAQUE_SELECTOR = [
  'button',
  'input',
  'select',
  'textarea',
  'a',
  '[role="button"]',
  '[data-ambient-block]',
].join(',');

const CLICKABLE_SELECTOR = [
  'button',
  'input',
  'select',
  'textarea',
  'a',
  '[role="button"]',
].join(',');

const GLASS_SELECTOR = [
  '.panel',
  '.modal',
  '.lobby-card',
  '.lobby-slot',
  '.topbar',
  '.result-column',
  '.ai-proposal',
  '.lobby-history-panel',
  '.menu-layers i',
].join(',');


function intersects(ax, ay, bx, by, r) {
  // Segment A(light) -> B(cell) against an axis-aligned rectangle.
  const dx = bx - ax;
  const dy = by - ay;
  let t0 = 0;
  let t1 = 1;
  for (const axis of [0, 1]) {
    const p = axis === 0 ? ax : ay;
    const d = axis === 0 ? dx : dy;
    const min = axis === 0 ? r.left : r.top;
    const max = axis === 0 ? r.right : r.bottom;
    if (Math.abs(d) < 1e-9) {
      if (p < min || p > max) return false;
      continue;
    }
    let a = (min - p) / d;
    let b = (max - p) / d;
    if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a);
    t1 = Math.min(t1, b);
    if (t0 > t1) return false;
  }
  return t1 > 0 && t0 < 1;
}

function contains(r, x, y) {
  return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
}

function pointInPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0];
    const yi = poly[i][1];
    const xj = poly[j][0];
    const yj = poly[j][1];
    const hit = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (hit) inside = !inside;
  }
  return inside;
}

function segmentsCross(ax, ay, bx, by, cx, cy, dx, dy) {
  const den = (bx - ax) * (dy - cy) - (by - ay) * (dx - cx);
  if (Math.abs(den) < 1e-9) return false;
  const t = ((cx - ax) * (dy - cy) - (cy - ay) * (dx - cx)) / den;
  const u = ((cx - ax) * (by - ay) - (cy - ay) * (bx - ax)) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}

function parseColor(value) {
  const text = String(value || '').trim();
  const rgb = /rgba?\(([^)]+)\)/i.exec(text);
  if (rgb) {
    const p = rgb[1].split(',').map((v) => Number(v.trim()));
    if (p.length >= 3) return [p[0], p[1], p[2]];
  }
  const hex = /^#([0-9a-f]{6})$/i.exec(text);
  if (hex) {
    return [parseInt(hex[1].slice(0, 2), 16), parseInt(hex[1].slice(2, 4), 16), parseInt(hex[1].slice(4, 6), 16)];
  }
  return null;
}

function sameColor(a, b) {
  return a && b && a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}

function polyHit(ax, ay, bx, by, poly) {
  if (pointInPoly(bx, by, poly) || pointInPoly(ax, ay, poly)) return true;
  for (let i = 0; i < poly.length; i += 1) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    if (segmentsCross(ax, ay, bx, by, a[0], a[1], b[0], b[1])) return true;
  }
  return false;
}

export class AmbientLight {
  constructor(canvas = document.getElementById('ambient-light')) {
    this.canvas = canvas;
    this.ctx = null;
    this.gl = null;
    this.rippleCanvas = document.getElementById('ambient-ripple');
    this.rippleCtx = this.rippleCanvas?.getContext('2d') ?? null;
    this.gpuReady = false;
    this.gpuMaskTex = null;
    this.gpuFilterTex = null;
    this.gpuMaskCanvas = null;
    this.gpuFilterCanvas = null;
    this.gpuProgram = null;
    this.gpuLoc = null;
    this.level = 25;
    this.glass = 35;
    this.scale = 4;
    this.range = 60;
    this.tintThreshold = 50;
    this.enabled = true;
    this.paused = false;
    this.pointer = { x: window.innerWidth * 0.5, y: window.innerHeight * 0.55 };
    this.opaque = [];
    this.clickableRects = [];
    this.boardPlain = [];
    this.boardBomb = [];
    this.boardPillars = [];
    this.hoverPillar = -1;
    this.glassRects = [];
    this.hitEl = null;
    this.boardOpaque = [];
    this.boardGlass = [];
    this.boardAll = [];
    this.boardPlain = [];
    this.boardBomb = [];
    this.boardPillars = [];
    this.colorFilters = [];
    this.rippleStrength = 50;
    this.rippleDecay = 0.009;
    this.rippleCutoff = 0.01;
    this.rippleIncident = 50;
    this.rippleReflect = 50;
    this.rippleActive = false;
    this.rippleField = null;
    this.ripplePrev = null;
    this.rippleNext = null;
    this.rippleMask = null;
    this.rippleRaf = 0;
    this.rippleLast = 0;
    this.rippleDrawAt = 0;
    this.rippleMax = 0;
    this.rippleOrigin = { x: 0, y: 0 };
    this.rippleOrigins = [];
    this.rippleColorCanvas = null;
    this.rippleColorData = null;
    this.raf = 0;
    this.animTimer = 0;
    this.idle = false;
    this.idleRaf = 0;
    this.idleVX = 0;
    this.idleVY = 0;
    this.idleLast = 0;
    this.idleRippleAt = 0;
    this.initGpu();
    this.resize();
    this.refresh();
    setTimeout(() => { if (!this.paused) this.refresh(); }, 700);
    window.addEventListener('resize', () => {
      this.resize();
      this.refresh();
      this.draw();
    });
    window.addEventListener('scroll', () => this.refresh(), { passive: true });
    document.addEventListener('pointermove', (e) => {
      if (this.paused) return;
      this.stopIdle();
      this.pointer.x = e.clientX;
      this.pointer.y = e.clientY;
      this.updateHit(e.clientX, e.clientY);
      this.requestDraw();
    }, { passive: true });
    document.addEventListener('pointerleave', () => {
      if (this.paused) return;
      this.updateHit(-1, -1);
      this.startIdle();
    });
    document.addEventListener('pointerenter', () => {
      if (!this.paused) this.stopIdle();
    });
    document.addEventListener('pointerdown', (e) => {
      this.spawnRipple(e.clientX, e.clientY);
    }, { passive: true });
    window.addEventListener('blur', () => this.startIdle());
    window.addEventListener('focus', () => this.stopIdle());
    this.refreshTimer = setInterval(() => this.refresh(), 600);
  }

  initGpu() {
    const canvas = this.canvas;
    if (!canvas) return;
    const opts = { alpha: true, premultipliedAlpha: false, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: true };
    const gl = canvas.getContext('webgl2', opts) || canvas.getContext('webgl', opts);
    if (!gl) return;
    const vs = `#version 100
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;
    const fs = `#version 100
precision highp float;
uniform sampler2D uMask;
uniform sampler2D uFilter;
uniform vec2 uRes;
uniform vec2 uLight;
uniform float uRadius;
uniform float uLevel;
uniform float uGlass;
uniform float uDecay;
void main() {
  vec2 p = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  vec2 d = p - uLight;
  float dist = length(d);
  if (dist >= uRadius) { gl_FragColor = vec4(0.0); return; }
  float trans = 1.0;
  vec3 tintAccum = vec3(0.0);
  float tintAlpha = 0.0;
  bool blocked = false;
  vec2 uv0 = vec2(uLight.x / uRes.x, 1.0 - uLight.y / uRes.y);
  vec4 m0 = texture2D(uMask, uv0);
  bool inGlass = m0.g > 0.5;
  bool inButton = m0.b > 0.85;
  bool inPlain = m0.b > 0.35 && m0.b <= 0.85;
  for (int i = 1; i <= 64; i++) {
    vec2 q = mix(uLight, p, float(i) / 64.0);
    vec2 uv = vec2(q.x / uRes.x, 1.0 - q.y / uRes.y);
    vec4 m = texture2D(uMask, uv);
    if (m.r > 0.5) { blocked = true; break; }
    if (m.b > 0.85) {
      if (!inButton) { trans *= 0.45; inButton = true; }
    } else if (m.b > 0.35) {
      if (!inPlain) { blocked = true; break; }
      inButton = false;
    } else {
      if (inButton) trans *= 0.92;
      inButton = false;
      inPlain = false;
    }
    if (m.g > 0.5) {
      if (!inGlass) { trans *= uGlass * 0.97; inGlass = true; }
    } else if (inGlass) {
      trans *= uGlass * 0.97;
      inGlass = false;
    }
    vec4 f = texture2D(uFilter, uv);
    if (f.a > 0.02) {
      if (max(f.rgb.r, max(f.rgb.g, f.rgb.b)) < 0.04) {
        trans *= max(0.0, 1.0 - f.a);
      } else {
        tintAccum = 1.0 - (1.0 - tintAccum) * (1.0 - f.rgb * f.a);
        tintAlpha = 1.0 - (1.0 - tintAlpha) * (1.0 - f.a);
      }
      if (trans <= 0.001) { blocked = true; break; }
    }
  }
  if (blocked || trans <= 0.001) { gl_FragColor = vec4(0.0); return; }
  float dd = max(dist, 1.0);
  float u = dd / uRadius;
  float fall = 1.0 / (1.0 + (uDecay * u) * (uDecay * u));
  float rawAlpha = fall * uLevel * 1.55 * trans;
  float alpha = min(1.0, rawAlpha);
  vec2 uvP = vec2(p.x / uRes.x, 1.0 - p.y / uRes.y);
  vec4 mP = texture2D(uMask, uvP);
  vec3 edgeGreen = vec3(49.0, 73.0, 54.0) / 255.0;
  vec3 white = vec3(1.0, 0.985, 0.95);
  float whiteMix = smoothstep(0.06, 0.28, rawAlpha);
  vec3 sceneColor = mix(edgeGreen, white, whiteMix);
  vec3 btnColor = vec3(0.72, 0.73, 0.70);
  vec3 baseColor = mP.b > 0.5 ? btnColor : sceneColor;
  vec3 color = tintAlpha > 0.01 ? mix(baseColor, tintAccum, min(1.0, tintAlpha * 1.35)) : baseColor;
  gl_FragColor = vec4(color, alpha);
}`;
    const compile = (type, source) => {
      const sh = gl.createShader(type);
      gl.shaderSource(sh, source);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        console.warn('ambient shader', gl.getShaderInfoLog(sh));
        return null;
      }
      return sh;
    };
    const vsObj = compile(gl.VERTEX_SHADER, vs);
    const fsObj = compile(gl.FRAGMENT_SHADER, fs);
    if (!vsObj || !fsObj) return;
    const program = gl.createProgram();
    gl.attachShader(program, vsObj);
    gl.attachShader(program, fsObj);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return;
    gl.useProgram(program);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(program, 'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
    const makeTexture = () => {
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return tex;
    };
    this.gl = gl;
    this.gpuProgram = program;
    this.gpuLoc = {
      mask: gl.getUniformLocation(program, 'uMask'),
      filter: gl.getUniformLocation(program, 'uFilter'),
      res: gl.getUniformLocation(program, 'uRes'),
      light: gl.getUniformLocation(program, 'uLight'),
      radius: gl.getUniformLocation(program, 'uRadius'),
      level: gl.getUniformLocation(program, 'uLevel'),
      glass: gl.getUniformLocation(program, 'uGlass'),
      decay: gl.getUniformLocation(program, 'uDecay'),
    };
    this.gpuMaskTex = makeTexture();
    this.gpuFilterTex = makeTexture();
    this.gpuMaskCanvas = document.createElement('canvas');
    this.gpuFilterCanvas = document.createElement('canvas');
    this.gpuReady = true;
  }

  makeGpuCanvases() {
    const W = this.lowWidth;
    const H = this.lowHeight;
    for (const c of [this.gpuMaskCanvas, this.gpuFilterCanvas]) {
      if (!c) continue;
      if (c.width !== W || c.height !== H) {
        c.width = W;
        c.height = H;
      }
    }
  }

  drawPoly(ctx, poly) {
    if (!poly.length) return;
    ctx.beginPath();
    ctx.moveTo(poly[0][0], poly[0][1]);
    for (let i = 1; i < poly.length; i += 1) ctx.lineTo(poly[i][0], poly[i][1]);
    ctx.closePath();
    ctx.fill();
  }

  buildGpuScene() {
    if (!this.gl || !this.gpuReady) return;
    this.makeGpuCanvases();
    const m = this.gpuMaskCanvas.getContext('2d');
    m.clearRect(0, 0, this.lowWidth, this.lowHeight);
    m.fillStyle = 'rgb(0,255,0)';
    for (const r of this.glassRects) m.fillRect(r.left, r.top, r.right - r.left, r.bottom - r.top);
    for (const bg of this.boardGlass) this.drawPoly(m, bg.poly);
    m.fillStyle = 'rgb(0,0,255)';
    for (const r of this.clickableRects) m.fillRect(r.left, r.top, r.right - r.left, r.bottom - r.top);
    for (const bc of this.boardBomb) this.drawPoly(m, bc.poly);
    m.fillStyle = 'rgb(0,0,160)';
    for (const bp of this.boardPlain) this.drawPoly(m, bp.poly);
    for (let i = 0; i < this.boardPillars.length; i += 1) {
      const poly = this.boardPillars[i].poly;
      if (i === this.hoverPillar) {
        m.beginPath();
        m.moveTo(poly[0][0], poly[0][1]);
        for (let k = 1; k < poly.length; k += 1) m.lineTo(poly[k][0], poly[k][1]);
        m.closePath();
        m.strokeStyle = 'rgb(255,0,0)';
        m.lineWidth = 2;
        m.stroke();
      } else {
        m.fillStyle = 'rgb(255,0,0)';
        this.drawPoly(m, poly);
      }
    }
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.gpuMaskTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.gpuMaskCanvas);
  }

  buildFilterTexture() {
    if (!this.gl || !this.gpuReady) return;
    this.makeGpuCanvases();
    const c = this.gpuFilterCanvas.getContext('2d');
    c.clearRect(0, 0, this.lowWidth, this.lowHeight);
    for (const f of this.colorFilters) {
      let factor = f.factor;
      if (f.el?.classList.contains('bomb-target')) {
        const so = Number(getComputedStyle(f.el).strokeOpacity);
        if (Number.isFinite(so)) factor = Math.max(0.18, Math.min(0.62, 0.18 + so * 0.4));
      }
      c.globalAlpha = Math.max(0.02, 1 - factor);
      c.fillStyle = 'rgb(' + f.color[0] + ',' + f.color[1] + ',' + f.color[2] + ')';
      for (const poly of f.polys) this.drawPoly(c, poly);
    }
    c.globalAlpha = 1;
    c.fillStyle = 'rgb(0,0,0)';
    for (const r of this.glassRects) {
      const w = r.right - r.left;
      const h = r.bottom - r.top;
      c.globalAlpha = 0.22;
      c.fillRect(r.left, r.top, w, 1);
      c.fillRect(r.left, r.bottom - 1, w, 1);
      c.fillRect(r.left, r.top, 1, h);
      c.fillRect(r.right - 1, r.top, 1, h);
      c.globalAlpha = 0.10;
      c.fillRect(r.left + 2, r.bottom, w, 2);
      c.fillRect(r.right, r.top + 2, 2, h);
    }
    c.strokeStyle = 'rgb(0,0,0)';
    c.lineWidth = 1.5;
    for (const bg of this.boardGlass) {
      c.globalAlpha = 0.22;
      c.beginPath();
      c.moveTo(bg.poly[0][0], bg.poly[0][1]);
      for (let k = 1; k < bg.poly.length; k += 1) c.lineTo(bg.poly[k][0], bg.poly[k][1]);
      c.closePath();
      c.stroke();
    }
    c.globalAlpha = 1;
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.gpuFilterTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.gpuFilterCanvas);
  }

  drawGpu() {
    if (!this.gl || !this.gpuReady) return;
    const gl = this.gl;
    const W = this.lowWidth;
    const H = this.lowHeight;
    if (this.canvas.width !== W || this.canvas.height !== H) {
      this.canvas.width = W;
      this.canvas.height = H;
    }
    gl.viewport(0, 0, W, H);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    this.buildFilterTexture();
    gl.useProgram(this.gpuProgram);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.gpuMaskTex);
    gl.uniform1i(this.gpuLoc.mask, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.gpuFilterTex);
    gl.uniform1i(this.gpuLoc.filter, 1);
    gl.uniform2f(this.gpuLoc.res, W, H);
    gl.uniform2f(this.gpuLoc.light, this.pointer.x / this.scale, this.pointer.y / this.scale);
    gl.uniform1f(this.gpuLoc.radius, Math.max(260 / this.scale, Math.min(W, H) * (0.18 + 0.72 * this.range / 100)));
    gl.uniform1f(this.gpuLoc.level, Math.max(0, Math.min(1, this.level / 100)));
    gl.uniform1f(this.gpuLoc.glass, Math.max(0, Math.min(1, 1 - (this.glass / 100) * 0.42)));
    const t = Math.max(0, Math.min(1, (this.rippleDecay - 0.009) / 0.091));
    gl.uniform1f(this.gpuLoc.decay, 2.0 + t * 3.0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (this.animTimer) {
      clearTimeout(this.animTimer);
      this.animTimer = 0;
    }
    const pulsating = this.colorFilters.some((f) => f.el?.classList.contains('bomb-target'));
    if (pulsating && !this.paused) {
      this.animTimer = setTimeout(() => {
        this.animTimer = 0;
        if (!this.paused && this.enabled) this.draw();
      }, 50);
    }
  }

  updatePillarHover(x, y) {
    if (!this.boardPillars) return;
    let idx = -1;
    if (x >= 0 && y >= 0 && this.scale > 0) {
      const lx = x / this.scale;
      const ly = y / this.scale;
      for (let i = 0; i < this.boardPillars.length; i += 1) {
        if (pointInPoly(lx, ly, this.boardPillars[i].poly)) {
          idx = i;
          break;
        }
      }
    }
    if (idx === this.hoverPillar) return;
    this.hoverPillar = idx;
    if (this.gpuReady) this.buildGpuScene();
    this.buildRippleMask();
    this.requestDraw();
  }

  updateHit(x, y) {
    this.updatePillarHover(x, y);
    const raw = x >= 0 && y >= 0 ? document.elementFromPoint(x, y) : null;
    const hit = raw?.closest(OPAQUE_SELECTOR) ?? null;
    const noTint = Boolean(raw?.closest('[data-ambient-no-tint]'));
    if (this.hitEl && this.hitEl !== hit) this.hitEl.classList.remove('ambient-pointer-hit');
    let eligible = false;
    if (hit && !noTint) {
      const brightness = this.ringBrightness(hit);
      eligible = brightness * 255 >= this.tintThreshold;
    }
    if (hit && eligible) hit.classList.add('ambient-pointer-hit');
    else if (hit) hit.classList.remove('ambient-pointer-hit');
    this.hitEl = hit;
  }

  setLevel(level) {
    const n = Number(level);
    this.level = Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 25;
    this.enabled = this.level > 0;
    document.body.classList.toggle('ambient-off', !this.enabled);
    if (!this.enabled) {
      this.stopIdle();
      this.stopRipple();
      this.clear();
      this.updateHit(-1, -1);
      return;
    }
    this.requestDraw();
  }

  setPaused(paused) {
    this.paused = Boolean(paused);
    if (this.paused) {
      this.stopIdle();
      this.stopRipple();
      if (this.animTimer) { clearTimeout(this.animTimer); this.animTimer = 0; }
      this.updateHit(-1, -1);
    } else {
      this.refresh();
      this.requestDraw();
    }
  }

  setGlass(level) {
    const n = Number(level);
    this.glass = Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 35;
    this.requestDraw();
  }

  setTintThreshold(level) {
    const n = Number(level);
    this.tintThreshold = Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 50;
    this.updateHit(this.pointer.x, this.pointer.y);
  }

  sampleBase(cssX, cssY) {
    const lx = this.pointer.x / this.scale;
    const ly = this.pointer.y / this.scale;
    const px = cssX / this.scale;
    const py = cssY / this.scale;
    const radius = Math.max(260 / this.scale, Math.min(this.lowWidth, this.lowHeight) * (0.18 + 0.72 * this.range / 100));
    const dx = px - lx;
    const dy = py - ly;
    const d2 = dx * dx + dy * dy;
    if (d2 >= radius * radius) return 0;
    for (const poly of this.boardOpaque) {
      if (polyHit(lx, ly, px, py, poly)) return 0;
    }
    const tau = Math.max(0, Math.min(1, 1 - (this.glass / 100) * 0.42));
    let transmit = 1;
    for (const r of this.glassRects) {
      if (tau < 1 && intersects(lx, ly, px, py, r)) transmit *= tau;
    }
    for (const bg of this.boardGlass) {
      if (tau < 1 && polyHit(lx, ly, px, py, bg.poly)) transmit *= Math.pow(tau, bg.power);
    }
    let tint = null;
    for (const f of this.colorFilters) {
      let hit = false;
      for (const poly of f.polys) {
        if (polyHit(lx, ly, px, py, poly)) {
          hit = true;
          break;
        }
      }
      if (!hit) continue;
      if (tint && !sameColor(tint, f.color)) return 0;
      tint = f.color;
      transmit *= f.factor;
    }
    if (transmit <= 0.001) return 0;
    const f = 1 - Math.sqrt(d2) / radius;
    return Math.min(1, f * f * Math.max(0, Math.min(1, this.level / 100)) * 1.55 * 2.0) * transmit;
  }

  ringBrightness(el) {
    const r = el.getBoundingClientRect();
    const pad = 10;
    const left = r.left - pad;
    const right = r.right + pad;
    const top = r.top - pad;
    const bottom = r.bottom + pad;
    const points = [];
    for (let i = 0; i < 4; i += 1) {
      const t = i / 3;
      points.push([left + (right - left) * t, top], [left + (right - left) * t, bottom]);
      points.push([left, top + (bottom - top) * t], [right, top + (bottom - top) * t]);
    }
    let sum = 0;
    for (const [x, y] of points) sum += this.sampleBase(x, y);
    return points.length ? sum / points.length : 0;
  }

  setRange(level) {
    const n = Number(level);
    this.range = Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 60;
    this.requestDraw();
  }

  setRippleStrength(level) {
    const n = Number(level);
    this.rippleStrength = Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 50;
    this.requestDraw();
  }

  setRippleDecay(value) {
    const n = Number(value);
    this.rippleDecay = Number.isFinite(n) ? Math.max(0.009, Math.min(0.1, n)) : 0.009;
  }

  setRippleIncident(level) {
    const n = Number(level);
    this.rippleIncident = Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 50;
  }

  setRippleReflect(level) {
    const n = Number(level);
    this.rippleReflect = Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 50;
  }

  buildRippleMask() {
    if (!this.rippleMask || this.rippleMask.length !== this.lowWidth * this.lowHeight) {
      this.rippleMask = new Uint8Array(this.lowWidth * this.lowHeight);
    }
    this.rippleMask.fill(0);
    if (!this.rippleGlassMask || this.rippleGlassMask.length !== this.lowWidth * this.lowHeight) {
      this.rippleGlassMask = new Uint8Array(this.lowWidth * this.lowHeight);
    }
    this.rippleGlassMask.fill(0);
    const W = this.lowWidth;
    const H = this.lowHeight;
    for (const r of this.opaque) {
      const x0 = Math.max(1, Math.floor(r.left));
      const x1 = Math.min(W - 2, Math.ceil(r.right));
      const y0 = Math.max(1, Math.floor(r.top));
      const y1 = Math.min(H - 2, Math.ceil(r.bottom));
      for (let y = y0; y <= y1; y += 1) {
        for (let x = x0; x <= x1; x += 1) this.rippleMask[y * W + x] = 1;
      }
    }
    for (const r of this.glassRects) {
      const x0 = Math.max(1, Math.floor(r.left));
      const x1 = Math.min(W - 2, Math.ceil(r.right));
      const y0 = Math.max(1, Math.floor(r.top));
      const y1 = Math.min(H - 2, Math.ceil(r.bottom));
      for (let y = y0; y <= y1; y += 1) {
        for (let x = x0; x <= x1; x += 1) this.rippleGlassMask[y * W + x] = 1;
      }
    }
    this.buildRippleColorMap();
    for (const poly of this.boardAll) {
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      for (const [x, y] of poly) {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
      for (let y = Math.max(1, Math.floor(minY)); y <= Math.min(H - 2, Math.ceil(maxY)); y += 1) {
        for (let x = Math.max(1, Math.floor(minX)); x <= Math.min(W - 2, Math.ceil(maxX)); x += 1) {
          if (pointInPoly(x + 0.5, y + 0.5, poly)) this.rippleMask[y * W + x] = 1;
        }
      }
    }
  }

  buildRippleColorMap() {
    const W = this.lowWidth;
    const H = this.lowHeight;
    if (!this.rippleColorCanvas) this.rippleColorCanvas = document.createElement('canvas');
    if (this.rippleColorCanvas.width !== W || this.rippleColorCanvas.height !== H) {
      this.rippleColorCanvas.width = W;
      this.rippleColorCanvas.height = H;
    }
    const ctx = this.rippleColorCanvas.getContext('2d', { willReadFrequently: true });
    ctx.clearRect(0, 0, W, H);
    for (const f of this.colorFilters) {
      ctx.globalAlpha = 1;
      ctx.fillStyle = 'rgb(' + f.color[0] + ',' + f.color[1] + ',' + f.color[2] + ')';
      for (const poly of f.polys) {
        if (!poly.length) continue;
        ctx.beginPath();
        ctx.moveTo(poly[0][0], poly[0][1]);
        for (let i = 1; i < poly.length; i += 1) ctx.lineTo(poly[i][0], poly[i][1]);
        ctx.closePath();
        ctx.fill();
      }
    }
    this.rippleColorData = ctx.getImageData(0, 0, W, H).data;
  }

  spawnRipple(x, y) {
    if (!this.enabled || this.paused) return;
    if (!this.rippleField) return;
    const W = this.lowWidth;
    const H = this.lowHeight;
    let cx = Math.max(2, Math.min(W - 3, Math.round(x / this.scale)));
    let cy = Math.max(2, Math.min(H - 3, Math.round(y / this.scale)));
    if (this.rippleMask?.[cy * W + cx]) {
      let found = false;
      for (let radius = 1; radius <= 8 && !found; radius += 1) {
        for (let dy = -radius; dy <= radius && !found; dy += 1) {
          for (let dx = -radius; dx <= radius && !found; dx += 1) {
            const nx = cx + dx;
            const ny = cy + dy;
            if (nx < 2 || nx >= W - 2 || ny < 2 || ny >= H - 2) continue;
            if (!this.rippleMask[ny * W + nx]) {
              cx = nx;
              cy = ny;
              found = true;
            }
          }
        }
      }
      if (!found) return;
    }
    const amp = 2.2 + (this.rippleStrength / 100) * 6.5;
    for (let dy = -2; dy <= 2; dy += 1) {
      for (let dx = -2; dx <= 2; dx += 1) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 1 || nx >= W - 1 || ny < 1 || ny >= H - 1) continue;
        if (this.rippleMask[ny * W + nx]) continue;
        const dist = Math.hypot(dx, dy);
        if (dist > 2.5) continue;
        const weight = dist < 0.75 ? 1 : dist < 1.6 ? 0.55 : 0.22;
        const idx = ny * W + nx;
        this.rippleField[idx] += amp * weight;
        this.ripplePrev[idx] = this.rippleField[idx];
      }
    }
    this.rippleOrigin = { x: cx, y: cy };
    this.rippleOrigins.push({ x: cx, y: cy });
    this.rippleActive = true;
    this.startRippleLoop();
  }

  stepRipple() {
    const W = this.lowWidth;
    const H = this.lowHeight;
    const a = this.rippleField;
    const b = this.ripplePrev;
    const c = this.rippleNext;
    const mask = this.rippleMask;
    const glassMask = this.rippleGlassMask;
    const incident = Math.max(0, Math.min(1, this.rippleIncident / 100));
    const reflect = Math.max(0, Math.min(1, this.rippleReflect / 100));
    const coef = 0.34;
    const damp = 0.997;
    let max = 0;
    for (let y = 1; y < H - 1; y += 1) {
      for (let x = 1; x < W - 1; x += 1) {
        const i = y * W + x;
        if (mask[i]) {
          c[i] = 0;
          continue;
        }
        const lap = a[i - 1] + a[i + 1] + a[i - W] + a[i + W] - 4 * a[i];
        let v = (2 * a[i] - b[i] + coef * lap) * damp;
        if (x < 4 || x >= W - 4 || y < 4 || y >= H - 4) v *= 0.78;
        if (mask[i - 1] || mask[i + 1] || mask[i - W] || mask[i + W]) v *= 0.12;
        if (glassMask && glassMask[i]) {
          const edge = !glassMask[i - 1] || !glassMask[i + 1] || !glassMask[i - W] || !glassMask[i + W];
          if (edge) v *= (1 - incident) * (1 - reflect);
        }
        c[i] = v;
        const av = Math.abs(v);
        if (av > max) max = av;
      }
    }
    for (let x = 0; x < W; x += 1) {
      c[x] = 0;
      c[(H - 1) * W + x] = 0;
    }
    for (let y = 0; y < H; y += 1) {
      c[y * W] = 0;
      c[y * W + W - 1] = 0;
    }
    this.ripplePrev = a;
    this.rippleField = c;
    this.rippleNext = b;
    this.rippleMax = max;
  }

  startRippleLoop() {
    if (this.rippleRaf) return;
    this.rippleLast = performance.now();
    this.rippleDrawAt = 0;
    const tick = (ts) => {
      if (!this.rippleActive || this.paused) return;
      const steps = Math.min(4, Math.max(1, Math.round((ts - this.rippleLast) / 16.67)));
      this.rippleLast = ts;
      for (let i = 0; i < steps; i += 1) this.stepRipple();
      if (ts - this.rippleDrawAt >= 33) {
        this.rippleDrawAt = ts;
        this.drawRippleOverlay();
      }
      if (this.rippleMax < this.rippleCutoff) {
        this.stopRipple();
        this.draw();
        return;
      }
      this.rippleRaf = requestAnimationFrame(tick);
    };
    this.rippleRaf = requestAnimationFrame(tick);
  }

  drawRippleOverlay() {
    const ctx = this.rippleCtx;
    if (!ctx) return;
    const W = this.lowWidth;
    const H = this.lowHeight;
    ctx.clearRect(0, 0, W, H);
    if (!this.rippleActive || !this.rippleField) return;
    const image = ctx.createImageData(W, H);
    const data = image.data;
    const gain = 1.4 * this.rippleStrength / 100;
    const origins = this.rippleOrigins?.length ? this.rippleOrigins : [this.rippleOrigin];
    const t = Math.max(0, Math.min(1, (this.rippleDecay - 0.009) / 0.091));
    const k = 2.0 + t * 3.0;
    for (let i = 0; i < this.rippleField.length; i += 1) {
      const v = this.rippleField[i];
      if (v <= 0.002) continue;
      const x = i % W;
      const y = Math.floor(i / W);
      let spread = 0;
      for (const origin of origins) {
        const dist = Math.hypot(x - origin.x, y - origin.y);
        const s = 1 / (1 + Math.pow(k * dist / 108, 2));
        if (s > spread) spread = s;
      }
      const alpha = Math.min(1, v * gain * spread);
      if (alpha <= 0.004) continue;
      const idx = i * 4;
      const cd = this.rippleColorData;
      if (cd && cd[idx + 3] > 30) {
        data[idx] = cd[idx];
        data[idx + 1] = cd[idx + 1];
        data[idx + 2] = cd[idx + 2];
      } else {
        data[idx] = 255;
        data[idx + 1] = 248;
        data[idx + 2] = 228;
      }
      data[idx + 3] = Math.round(255 * alpha);
    }
    ctx.putImageData(image, 0, 0);
  }

  stopRipple() {
    this.rippleActive = false;
    if (this.rippleRaf) cancelAnimationFrame(this.rippleRaf);
    this.rippleRaf = 0;
    this.rippleMax = 0;
    this.rippleOrigin = { x: 0, y: 0 };
    this.rippleOrigins = [];
    this.rippleField?.fill(0);
    this.ripplePrev?.fill(0);
    this.rippleNext?.fill(0);
    this.rippleCtx?.clearRect(0, 0, this.lowWidth, this.lowHeight);
  }

  collideIdleRect(rect, prevX, prevY, x, y, vx, vy) {
    const pad = 1;
    const left = rect.left - pad;
    const right = rect.right + pad;
    const top = rect.top - pad;
    const bottom = rect.bottom + pad;
    if (x <= left || x >= right || y <= top || y >= bottom) return null;
    let nx = vx;
    let ny = vy;
    let px = x;
    let py = y;
    let hit = false;
    if (prevX <= left) {
      px = left - 1;
      nx = -Math.abs(nx);
      hit = true;
    } else if (prevX >= right) {
      px = right + 1;
      nx = Math.abs(nx);
      hit = true;
    }
    if (prevY <= top) {
      py = top - 1;
      ny = -Math.abs(ny);
      hit = true;
    } else if (prevY >= bottom) {
      py = bottom + 1;
      ny = Math.abs(ny);
      hit = true;
    }
    if (!hit) {
      const dl = Math.abs(x - left);
      const dr = Math.abs(right - x);
      const dt = Math.abs(y - top);
      const db = Math.abs(bottom - y);
      const min = Math.min(dl, dr, dt, db);
      if (min === dl) {
        px = left - 1;
        nx = -Math.abs(nx);
      } else if (min === dr) {
        px = right + 1;
        nx = Math.abs(nx);
      } else if (min === dt) {
        py = top - 1;
        ny = -Math.abs(ny);
      } else {
        py = bottom + 1;
        ny = Math.abs(ny);
      }
    }
    return { x: px, y: py, vx: nx, vy: ny };
  }

  startIdle() {
    if (!this.enabled || this.paused || this.level <= 0) return;
    if (this.idle) return;
    this.idle = true;
    this.idleLast = performance.now();
    this.idleRippleAt = 0;
    const angle = Math.random() * Math.PI * 2;
    const speed = 120 + Math.random() * 90;
    this.idleVX = Math.cos(angle) * speed;
    this.idleVY = Math.sin(angle) * speed;
    const tick = (ts) => {
      if (!this.idle) return;
      const dt = Math.min(0.05, Math.max(0, (ts - this.idleLast) / 1000));
      this.idleLast = ts;
      const margin = 24;
      const w = window.innerWidth;
      const h = window.innerHeight;
      const prevX = this.pointer.x;
      const prevY = this.pointer.y;
      this.pointer.x += this.idleVX * dt;
      this.pointer.y += this.idleVY * dt;

      let bounced = false;
      // Outer border: always reflect.
      if (this.pointer.x < margin) {
        this.pointer.x = margin;
        this.idleVX = Math.abs(this.idleVX);
        bounced = true;
      } else if (this.pointer.x > w - margin) {
        this.pointer.x = w - margin;
        this.idleVX = -Math.abs(this.idleVX);
        bounced = true;
      }
      if (this.pointer.y < margin) {
        this.pointer.y = margin;
        this.idleVY = Math.abs(this.idleVY);
        bounced = true;
      } else if (this.pointer.y > h - margin) {
        this.pointer.y = h - margin;
        this.idleVY = -Math.abs(this.idleVY);
        bounced = true;
      }

      const emitIdleRipple = () => {
        if (ts - this.idleRippleAt < 180) return;
        this.idleRippleAt = ts;
        this.spawnRipple(this.pointer.x, this.pointer.y);
      };
      if (bounced) emitIdleRipple();

      // Opaque controls: always reflect.
      for (const r of this.opaque) {
        const rect = {
          left: r.left * this.scale,
          top: r.top * this.scale,
          right: r.right * this.scale,
          bottom: r.bottom * this.scale,
        };
        const hit = this.collideIdleRect(rect, prevX, prevY, this.pointer.x, this.pointer.y, this.idleVX, this.idleVY);
        if (hit) {
          this.pointer.x = hit.x;
          this.pointer.y = hit.y;
          this.idleVX = hit.vx;
          this.idleVY = hit.vy;
          emitIdleRipple();
          break;
        }
      }

      // Glass borders: chance to reflect; otherwise pass through.
      for (const r of this.glassRects) {
        const rect = {
          left: r.left * this.scale,
          top: r.top * this.scale,
          right: r.right * this.scale,
          bottom: r.bottom * this.scale,
        };
        const wasInside =
          prevX > rect.left && prevX < rect.right && prevY > rect.top && prevY < rect.bottom;
        const isInside =
          this.pointer.x > rect.left && this.pointer.x < rect.right && this.pointer.y > rect.top && this.pointer.y < rect.bottom;
        if (wasInside === isInside) continue;
        if (Math.random() >= 0.5) continue;
        const hit = this.collideIdleRect(rect, prevX, prevY, this.pointer.x, this.pointer.y, this.idleVX, this.idleVY);
        if (hit) {
          this.pointer.x = hit.x;
          this.pointer.y = hit.y;
          this.idleVX = hit.vx;
          this.idleVY = hit.vy;
          emitIdleRipple();
          break;
        }
      }
      const speedNow = Math.hypot(this.idleVX, this.idleVY) || 1;
      const clamped = Math.max(90, Math.min(260, speedNow));
      this.idleVX = (this.idleVX / speedNow) * clamped;
      this.idleVY = (this.idleVY / speedNow) * clamped;
      if (!this.idleTickAt || ts - this.idleTickAt >= 32) {
        this.idleTickAt = ts;
        this.draw();
      }
      this.idleRaf = requestAnimationFrame(tick);
    };
    this.idleRaf = requestAnimationFrame(tick);
  }

  stopIdle() {
    if (!this.idle) return;
    this.idle = false;
    cancelAnimationFrame(this.idleRaf);
    this.idleRaf = 0;
  }

  setQuality(level) {
    const n = Number(level);
    const q = Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 50;
    this.scale = q >= 90 ? 3 : q >= 70 ? 4 : q >= 20 ? 5 : 6;
    this.initGpu();
    this.resize();
    this.refresh();
  }

  resize() {
    if (!this.canvas) return;
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.lowWidth = Math.max(1, Math.ceil(this.width / this.scale));
    this.lowHeight = Math.max(1, Math.ceil(this.height / this.scale));
    this.canvas.width = this.lowWidth;
    this.canvas.height = this.lowHeight;
    this.canvas.style.width = `${this.width}px`;
    this.canvas.style.height = `${this.height}px`;
    if (this.rippleCanvas) {
      this.rippleCanvas.width = this.lowWidth;
      this.rippleCanvas.height = this.lowHeight;
      this.rippleCanvas.style.width = this.width + 'px';
      this.rippleCanvas.style.height = this.height + 'px';
    }
    const n = this.lowWidth * this.lowHeight;
    this.rippleField = new Float32Array(n);
    this.ripplePrev = new Float32Array(n);
    this.rippleNext = new Float32Array(n);
    this.rippleOrigins = [];
    this.rippleMask = new Uint8Array(n);
    this.rippleGlassMask = new Uint8Array(n);
    this.stopRipple();
    this.geometryKey = null;
  }

  refresh() {
    if (!this.enabled || this.paused) return;
    this.opaque = this.collect(OPAQUE_SELECTOR);
    this.clickableRects = this.collect(CLICKABLE_SELECTOR);
    this.glassRects = this.collect(GLASS_SELECTOR);
    const menuVisible = !document.getElementById('menu-screen')?.classList.contains('hidden');
    if (menuVisible) {
      const cx = this.lowWidth / 2;
      const cy = this.lowHeight / 2;
      this.glassRects = this.glassRects.filter((r) => (
        Math.abs((r.left + r.right) / 2 - cx) <= 4 &&
        Math.abs((r.top + r.bottom) / 2 - cy) <= 4
      ));
    }
    this.collectBoard();
    this.updatePillarHover(this.pointer.x, this.pointer.y);
    this.buildRippleMask();
    this.buildGpuScene();
    const key = JSON.stringify([
      this.opaque.map((r) => [r.left, r.top, r.right, r.bottom]),
      this.glassRects.map((r) => [r.left, r.top, r.right, r.bottom]),
      this.boardOpaque.length,
      this.boardGlass.length,
      this.colorFilters.map((f) => [f.color, f.polys.length]),
    ]);
    if (key !== this.geometryKey) {
      this.geometryKey = key;
      this.requestDraw();
    }
  }

  collectBoard() {
    this.boardOpaque = [];
    this.boardGlass = [];
    this.boardAll = [];
    this.boardPlain = [];
    this.boardBomb = [];
    this.boardPillars = [];
    this.colorFilters = [];
    const svg = [...document.querySelectorAll('.board-svg')].find((el) => el.getClientRects().length > 0);
    if (!svg) return;
    const segs = [...svg.querySelectorAll('.seg[data-seg]')];
    if (!segs.length) return;
    const box = svg.getBoundingClientRect();
    const vb = svg.viewBox?.baseVal;
    if (!vb || !vb.width || !vb.height) return;
    const S = segs.length;
    const cx = 300;
    const cy = 300;
    const rIn = 122;
    const rOut = 238;
    const toScreen = (x, y) => [
      (box.left + ((x - vb.x) * box.width) / vb.width) / this.scale,
      (box.top + ((y - vb.y) * box.height) / vb.height) / this.scale,
    ];
    const plainEdges = [];
    for (let i = 0; i < S; i += 1) {
      const a0 = ((i * 360) / S - 90) * (Math.PI / 180);
      const a1 = (((i + 1) * 360) / S - 90) * (Math.PI / 180);
      const poly = [
        toScreen(cx + rIn * Math.cos(a0), cy + rIn * Math.sin(a0)),
        toScreen(cx + rOut * Math.cos(a0), cy + rOut * Math.sin(a0)),
        toScreen(cx + rOut * Math.cos(a1), cy + rOut * Math.sin(a1)),
        toScreen(cx + rIn * Math.cos(a1), cy + rIn * Math.sin(a1)),
      ];
      this.boardAll.push(poly);
      const el = segs[i];
      if (el.classList.contains('terrain-pillar')) {
        this.boardOpaque.push(poly);
        this.boardPillars.push({ poly, el });
      } else if (el.classList.contains('terrain-ruins')) {
        this.boardGlass.push({ poly, power: 3 });
      } else {
        if (el.classList.contains('terrain-plain')) this.boardPlain.push({ poly, el });
        if (el.classList.contains('bomb-target')) this.boardBomb.push({ poly, el });
        plainEdges.push({ el, a0, a1 });
      }
    }

    // Colored semi-transparent frames: light is tinted by the first frame it
    // crosses; a second frame of a different color blocks the ray.
    const sector = (r0, r1, a0, a1) => {
      const steps = Math.max(6, Math.min(48, Math.ceil(Math.abs(a1 - a0) / (Math.PI / 18))));
      const pts = [];
      for (let i = 0; i <= steps; i += 1) {
        const a = a0 + ((a1 - a0) * i) / steps;
        pts.push(toScreen(cx + r1 * Math.cos(a), cy + r1 * Math.sin(a)));
      }
      for (let i = steps; i >= 0; i -= 1) {
        const a = a0 + ((a1 - a0) * i) / steps;
        pts.push(toScreen(cx + r0 * Math.cos(a), cy + r0 * Math.sin(a)));
      }
      return pts;
    };
    const arcInfo = (el) => {
      if (el.tagName.toLowerCase() === 'circle') {
        const r = Number(el.getAttribute('r')) || 0;
        return r > 0 ? { r, a0: 0, a1: Math.PI * 2 } : null;
      }
      const d = el.getAttribute('d') || '';
      const n = d.match(/-?\d+(?:\.\d+)?/g)?.map(Number);
      if (!n || n.length < 9) return null;
      const r = n[2];
      const a0 = Math.atan2(n[1] - cy, n[0] - cx);
      let delta = Math.atan2(n[8] - cy, n[7] - cx) - a0;
      delta = ((delta % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
      if (n[5] === 1 && delta < Math.PI) delta += Math.PI * 2;
      return r > 0 ? { r, a0, a1: a0 + delta } : null;
    };
    const addFilter = (el, polys) => {
      const style = getComputedStyle(el);
      const color = parseColor(style.stroke);
      if (!color) return;
      const opacity = Number(style.strokeOpacity) || Number(style.opacity) || 1;
      this.colorFilters.push({ color, factor: Math.max(0.4, Math.min(0.78, opacity * 0.72)), polys, el });
    };

    // Plain blocks transmit with no body attenuation. Only their straight
    // radial borders remain high attenuation; arc edges add nothing.
    for (const edge of plainEdges) {
      if (edge.el.classList.contains('bomb-target')) continue;
      const style = getComputedStyle(edge.el);
      const color = parseColor(style.fill);
      if (!color) continue;
      const da = 2.2 / rIn;
      this.colorFilters.push({
        color,
        factor: 0.24,
        polys: [
          sector(rIn, rOut, edge.a0 - da, edge.a0 + da),
          sector(rIn, rOut, edge.a1 - da, edge.a1 + da),
        ],
      });
    }

    for (const el of svg.querySelectorAll('.sound-arc, .replay-observation-arc')) {
      const info = arcInfo(el);
      if (!info) continue;
      const style = getComputedStyle(el);
      const w = parseFloat(style.strokeWidth) || 5;
      addFilter(el, [sector(info.r - w / 2, info.r + w / 2, info.a0, info.a1)]);
    }

    for (const el of svg.querySelectorAll('.seg.bomb-target')) {
      const index = segs.indexOf(el);
      if (index < 0) continue;
      const a0 = ((index * 360) / S - 90) * (Math.PI / 180);
      const a1 = (((index + 1) * 360) / S - 90) * (Math.PI / 180);
      const style = getComputedStyle(el);
      const w = parseFloat(style.strokeWidth) || 2.8;
      const da = w / rIn;
      addFilter(el, [
        sector(rOut - w, rOut + w, a0, a1),
        sector(rIn - w, rIn + w, a0, a1),
        sector(rIn, rOut, a0 - da, a0 + da),
        sector(rIn, rOut, a1 - da, a1 + da),
      ]);
    }
  }

  collect(selector) {
    return [...document.querySelectorAll(selector)]
      .filter((el) => {
        if (!el || el.closest('#ambient-light')) return false;
        const style = getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') {
          return false;
        }
        return el.getClientRects().length > 0;
      })
      .map((el) => {
        const r = el.getBoundingClientRect();
        return {
          left: r.left / this.scale,
          top: r.top / this.scale,
          right: r.right / this.scale,
          bottom: r.bottom / this.scale,
        };
      })
      .filter((r) => r.right - r.left > 0.5 && r.bottom - r.top > 0.5);
  }

  requestDraw() {
    if (!this.enabled || this.paused || this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.draw();
    });
  }

  draw() {
    if (!this.enabled || this.paused) return;
    if (this.gpuReady) this.drawGpu();
    else this.drawCpu();
  }

  drawCpu() {
    if (!this.ctx) return;
    const W = this.lowWidth;
    const H = this.lowHeight;
    const lx = this.pointer.x / this.scale;
    const ly = this.pointer.y / this.scale;
    const radius = Math.max(260 / this.scale, Math.min(W, H) * (0.18 + 0.72 * this.range / 100));
    const tau = Math.max(0, Math.min(1, 1 - (this.glass / 100) * 0.55));
    const level = Math.max(0, Math.min(1, this.level / 100));
    const image = this.ctx.createImageData(W, H);
    const data = image.data;

    const glass = this.glassRects.filter((r) => !contains(r, lx, ly));
    const opaque = this.opaque.filter((r) => !contains(r, lx, ly));
    const colorFilters = this.colorFilters.map((f) => {
      let factor = f.factor;
      if (f.el?.classList.contains('bomb-target')) {
        const so = Number(getComputedStyle(f.el).strokeOpacity);
        if (Number.isFinite(so)) factor = Math.max(0.18, Math.min(0.62, 0.18 + so * 0.4));
      }
      return { ...f, factor };
    });

    for (let y = 0; y < H; y += 1) {
      const py = y + 0.5;
      for (let x = 0; x < W; x += 1) {
        const px = x + 0.5;
        const cdx = px - lx;
        const cdy = py - ly;
        const cellDist2 = cdx * cdx + cdy * cdy;
        const inLight = cellDist2 < radius * radius;
        const rv = this.rippleActive && this.rippleField ? this.rippleField[y * W + x] : 0;
        const rippleBlocked = this.rippleMask?.[y * W + x] === 1;
        const rippleAdd = rv > 0 && !rippleBlocked ? rv * 1.4 * this.rippleStrength / 100 : 0;
        if (!inLight && rippleAdd <= 0) continue;

        let blocked = false;
        for (let i = 0; i < opaque.length; i += 1) {
          if (intersects(lx, ly, px, py, opaque[i])) {
            blocked = true;
            break;
          }
        }
        if (!blocked) {
          for (let i = 0; i < this.boardOpaque.length; i += 1) {
            if (polyHit(lx, ly, px, py, this.boardOpaque[i])) {
              blocked = true;
              break;
            }
          }
        }

        let transmit = 1;
        let tint = null;
        if (!blocked) {
          for (let i = 0; i < glass.length; i += 1) {
            if (tau < 1 && intersects(lx, ly, px, py, glass[i])) {
              transmit *= tau;
              if (transmit <= 0.001) break;
            }
          }
          if (transmit > 0.001 && tau < 1) {
            for (let i = 0; i < this.boardGlass.length; i += 1) {
              const bg = this.boardGlass[i];
              if (polyHit(lx, ly, px, py, bg.poly)) {
                transmit *= Math.pow(tau, bg.power);
                if (transmit <= 0.001) break;
              }
            }
          }
          if (transmit > 0.001) {
            for (let i = 0; i < colorFilters.length; i += 1) {
              const filter = colorFilters[i];
              let hit = false;
              for (let j = 0; j < filter.polys.length; j += 1) {
                if (polyHit(lx, ly, px, py, filter.polys[j])) {
                  hit = true;
                  break;
                }
              }
              if (!hit) continue;
              if (tint && !sameColor(tint, filter.color)) {
                blocked = true;
                break;
              }
              tint = filter.color;
              transmit *= filter.factor;
              if (transmit <= 0.001) break;
            }
          }
        }

        let intensity = 0;
        if (!blocked && transmit > 0.001 && inLight) {
          const cellFalloff = 1 - Math.sqrt(cellDist2) / radius;
          const falloff = cellFalloff * cellFalloff;
          intensity = Math.min(1, falloff * level * 1.55) * transmit;
        }
        if (rippleAdd > 0) intensity = Math.min(1, intensity + rippleAdd);
        if (intensity <= 0.002) continue;

        const warm = Math.min(1, intensity * 1.3);
        const idx = (y * W + x) * 4;
        if (tint) {
          data[idx] = tint[0];
          data[idx + 1] = tint[1];
          data[idx + 2] = tint[2];
        } else {
          data[idx] = Math.round(150 + 105 * warm);
          data[idx + 1] = Math.round(184 + 66 * warm);
          data[idx + 2] = Math.round(150 + 82 * warm);
        }
        data[idx + 3] = Math.round(255 * intensity);
      }
    }
    this.ctx.putImageData(image, 0, 0);
    this.lastImage = image;
    if (this.animTimer) {
      clearTimeout(this.animTimer);
      this.animTimer = 0;
    }
    const pulsating = this.colorFilters.some((f) => f.el?.classList.contains('bomb-target'));
    if (pulsating && !this.paused) {
      this.animTimer = setTimeout(() => {
        this.animTimer = 0;
        if (!this.paused && this.enabled) this.draw();
      }, 50);
    }
  }
}
