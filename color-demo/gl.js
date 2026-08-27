'use strict';
/* Pulse Color — renderer WebGL2 per il playback fluido.
 * Il COLORE è una LUT 3D cotta dal motore wasm vero (stesso modello di rendering
 * del plugin, che renderizza via Lut3D); gli FX sono il porting in shader di
 * applica_fx (pulse_engine.h), pass per pass, con le stesse soglie e gli stessi
 * raggi. La parità si misura contro il wasm nella pagina (?debug).
 * Nessun percorso di export: si disegna solo nel canvas. */
(() => {

const VS = `#version 300 es
void main(){
  vec2 p = vec2((gl_VertexID<<1)&2, gl_VertexID&2);
  gl_Position = vec4(p*2.0-1.0, 0.0, 1.0);
}`;

const LIB = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler3D;
uniform sampler2D u_a;
uniform sampler2D u_b;
uniform sampler2D u_c;
out vec4 o;
ivec2 P(){ return ivec2(gl_FragCoord.xy); }
float lum(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
float tanhv(float x){
  if (x > 3.0) return 1.0;
  if (x < -3.0) return -1.0;
  float x2 = x*x;
  return x * (27.0 + x2) / (27.0 + 9.0*x2);
}
float clamp01(float v){ return clamp(v, 0.0, 1.0); }
`;

const FRAGS = {
  // colore: sorgente → LUT 3D cotta (trilineare hardware, come il plugin)
  color: LIB + `
uniform sampler3D u_lut;
uniform float u_n;
uniform int u_orig;
uniform vec2 u_out;
void main(){
  vec3 c = texture(u_a, (vec2(P()) + 0.5) / u_out).rgb;
  if (u_orig == 0) c = texture(u_lut, (c*(u_n-1.0)+0.5)/u_n).rgb;
  o = vec4(c, 1.0);
}`,
  lum: LIB + `void main(){ o = vec4(lum(texelFetch(u_a, P(), 0).rgb)); }`,
  // box blur separabile (una passata; si itera 3 volte come box_blur)
  boxh: LIB + `
uniform int u_r;
void main(){
  ivec2 p = P(); int W = textureSize(u_a, 0).x;
  float acc = 0.0;
  for (int t = -u_r; t <= u_r; t++)
    acc += texelFetch(u_a, ivec2(clamp(p.x+t, 0, W-1), p.y), 0).r;
  o = vec4(acc / float(2*u_r+1));
}`,
  boxv: LIB + `
uniform int u_r;
void main(){
  ivec2 p = P(); int H = textureSize(u_a, 0).y;
  float acc = 0.0;
  for (int t = -u_r; t <= u_r; t++)
    acc += texelFetch(u_a, ivec2(p.x, clamp(p.y+t, 0, H-1)), 0).r;
  o = vec4(acc / float(2*u_r+1));
}`,
  boxh3: LIB + `
uniform int u_r;
void main(){
  ivec2 p = P(); int W = textureSize(u_a, 0).x;
  vec3 acc = vec3(0.0);
  for (int t = -u_r; t <= u_r; t++)
    acc += texelFetch(u_a, ivec2(clamp(p.x+t, 0, W-1), p.y), 0).rgb;
  o = vec4(acc / float(2*u_r+1), 1.0);
}`,
  boxv3: LIB + `
uniform int u_r;
void main(){
  ivec2 p = P(); int H = textureSize(u_a, 0).y;
  vec3 acc = vec3(0.0);
  for (int t = -u_r; t <= u_r; t++)
    acc += texelFetch(u_a, ivec2(p.x, clamp(p.y+t, 0, H-1)), 0).rgb;
  o = vec4(acc / float(2*u_r+1), 1.0);
}`,
  // downsample media ds×ds con bordi contati (come blur_su_ridotta)
  down: LIB + `
uniform int u_ds;
void main(){
  ivec2 p2 = P(); ivec2 dim = textureSize(u_a, 0);
  vec4 acc = vec4(0.0); int n = 0;
  for (int dy = 0; dy < u_ds; dy++) for (int dx = 0; dx < u_ds; dx++) {
    ivec2 q = p2*u_ds + ivec2(dx, dy);
    if (q.x < dim.x && q.y < dim.y) { acc += texelFetch(u_a, q, 0); n++; }
  }
  o = acc / float(max(n, 1));
}`,
  // upsample bilineare con l'aritmetica esatta del C++
  up: LIB + `
uniform int u_ds;
void main(){
  ivec2 p = P(); ivec2 d2 = textureSize(u_a, 0);
  float fy = float(p.y) / float(u_ds);
  int y0 = min(int(fy), d2.y-1), y1 = min(y0+1, d2.y-1);
  float wy = fy - float(y0);
  float fx = float(p.x) / float(u_ds);
  int x0 = min(int(fx), d2.x-1), x1 = min(x0+1, d2.x-1);
  float wx = fx - float(x0);
  o = (texelFetch(u_a, ivec2(x0,y0), 0)*(1.0-wx) + texelFetch(u_a, ivec2(x1,y0), 0)*wx)*(1.0-wy)
    + (texelFetch(u_a, ivec2(x0,y1), 0)*(1.0-wx) + texelFetch(u_a, ivec2(x1,y1), 0)*wx)*wy;
}`,
  // somme per blocchi (per la media ESATTA della mist bianca)
  downsum: LIB + `
uniform int u_ds;
void main(){
  ivec2 p2 = P(); ivec2 dim = textureSize(u_a, 0);
  float acc = 0.0;
  for (int dy = 0; dy < u_ds; dy++) for (int dx = 0; dx < u_ds; dx++) {
    ivec2 q = p2*u_ds + ivec2(dx, dy);
    if (q.x < dim.x && q.y < dim.y) acc += texelFetch(u_a, q, 0).r;
  }
  o = vec4(acc);
}`,
  // enhance / pelle: unsharp con guadagno di luminanza (u_a=img, u_b=L, u_c=B)
  detail: LIB + `
uniform float u_coef;   // +F*2.0 enhance · -F*1.6 pelle
void main(){
  vec3 c = texelFetch(u_a, P(), 0).rgb;
  float l = texelFetch(u_b, P(), 0).r;
  float b = texelFetch(u_c, P(), 0).r;
  float det = tanhv((l - b) * 3.0) / 3.0;
  float ln = min(1.0, max(1e-6, l + det * u_coef));
  float g = ln / max(l, 1e-6);
  o = vec4(clamp(c*g, 0.0, 1.0), 1.0);
}`,
  // maschere scalari da L (u_mode: 0 halation · 1 bloom · 2 streak · 3 glimmer · 4 stella)
  maskl: LIB + `
uniform int u_mode;
void main(){
  float l = texelFetch(u_a, P(), 0).r;
  float m = 0.0;
  if (u_mode == 0) m = pow(clamp01((l - 0.62) / 0.38), 1.6);
  else if (u_mode == 1) { float w = clamp01((l - 0.72) / 0.28); m = l*w*w; }
  else if (u_mode == 2) { float w = clamp01((l - 0.80) / 0.20); m = w*w*l; }
  else if (u_mode == 3) { float w = clamp01((l - 0.55) / 0.45); m = w*l; }
  else { float w = clamp01((l - 0.85) / 0.15); m = w*w*l; }
  o = vec4(m);
}`,
  // maschera RGB pesata (promist th .45/.55 · mist th .35/.65): img*w² (u_a=img, u_b=L)
  maskrgb: LIB + `
uniform float u_th;
uniform float u_den;
void main(){
  vec3 c = texelFetch(u_a, P(), 0).rgb;
  float l = texelFetch(u_b, P(), 0).r;
  float w = clamp01((l - u_th) / u_den); w *= w;
  o = vec4(c*w, 1.0);
}`,
  // screen con maschera scalare e tinta (halation/bloom/streak/glimmer/stella)
  screen1: LIB + `
uniform float u_gain;
uniform vec3 u_tint;
void main(){
  vec3 c = texelFetch(u_a, P(), 0).rgb;
  float al = texelFetch(u_b, P(), 0).r * u_gain;
  vec3 v = min(vec3(1.0), al * u_tint);
  o = vec4(1.0 - (1.0 - c) * (1.0 - v), 1.0);
}`,
  // screen per canale con maschera RGB (promist)
  screen3: LIB + `
uniform float u_gain;
void main(){
  vec3 c = texelFetch(u_a, P(), 0).rgb;
  vec3 v = min(vec3(1.0), texelFetch(u_b, P(), 0).rgb * u_gain);
  o = vec4(1.0 - (1.0 - c) * (1.0 - v), 1.0);
}`,
  // mist bianca: alone screen + velo lattiginoso (u_a=img, u_b=C blur, u_c=V blur)
  mist: LIB + `
uniform float u_gain;   // F*1.3
uniform float u_veil;   // F*0.22
uniform float u_media;  // media globale di L
void main(){
  vec3 c = texelFetch(u_a, P(), 0).rgb;
  vec3 C = texelFetch(u_b, P(), 0).rgb;
  float V = 0.5 * texelFetch(u_c, P(), 0).r + 0.5 * u_media;
  vec3 v = min(vec3(1.0), C * u_gain);
  vec3 x = 1.0 - (1.0 - c) * (1.0 - v);
  x += u_veil * V * (1.0 - x);
  o = vec4(clamp(x, 0.0, 1.0), 1.0);
}`,
  // star filter: convoluzione direzionale pesata a triangolo, somma sugli assi
  stella: LIB + `
uniform int u_r;
uniform int u_assi;
uniform float u_base;
void main(){
  ivec2 p = P(); ivec2 dim = textureSize(u_a, 0);
  float norma = 0.0;
  for (int t = -u_r; t <= u_r; t++) norma += 1.0 - abs(float(t)) / float(u_r+1);
  float R = 0.0;
  for (int k = 0; k < u_assi; k++) {
    float ang = u_base + float(k) * 3.14159265358979 / float(u_assi);
    float dx = cos(ang), dy = sin(ang);
    float acc = 0.0;
    for (int t = -u_r; t <= u_r; t++) {
      float ox = float(t)*dx, oy = float(t)*dy;
      int sx = p.x + int(ox >= 0.0 ? floor(ox+0.5) : ceil(ox-0.5));
      int sy = p.y + int(oy >= 0.0 ? floor(oy+0.5) : ceil(oy-0.5));
      if (sx < 0 || sx >= dim.x || sy < 0 || sy >= dim.y) continue;
      acc += texelFetch(u_a, ivec2(sx, sy), 0).r * (1.0 - abs(float(t))/float(u_r+1));
    }
    R += acc / norma;
  }
  o = vec4(R);
}`,
  // aberrazione cromatica radiale (u_a = snapshot dell'immagine corrente)
  ca: LIB + `
uniform float u_ca;
vec3 fetchBil(vec2 xy){
  ivec2 dim = textureSize(u_a, 0);
  float x = clamp(xy.x, 0.0, float(dim.x) - 1.001);
  float y = clamp(xy.y, 0.0, float(dim.y) - 1.001);
  int x0 = int(x), y0 = int(y);
  float wx = x - float(x0), wy = y - float(y0);
  vec3 a = texelFetch(u_a, ivec2(x0,   y0),   0).rgb;
  vec3 b = texelFetch(u_a, ivec2(x0+1, y0),   0).rgb;
  vec3 c = texelFetch(u_a, ivec2(x0,   y0+1), 0).rgb;
  vec3 d = texelFetch(u_a, ivec2(x0+1, y0+1), 0).rgb;
  return (a*(1.0-wx) + b*wx)*(1.0-wy) + (c*(1.0-wx) + d*wx)*wy;
}
void main(){
  ivec2 p = P(); ivec2 dim = textureSize(u_a, 0);
  float cx = float(dim.x)/2.0, cy = float(dim.y)/2.0;
  float nx = (float(p.x) - cx)/cx, ny = (float(p.y) - cy)/cy;
  float sh = u_ca * 0.008 * (nx*nx + ny*ny);
  vec3 c0 = texelFetch(u_a, p, 0).rgb;
  float r = fetchBil(vec2(cx + (float(p.x)-cx)*(1.0-sh), cy + (float(p.y)-cy)*(1.0-sh))).r;
  float b = fetchBil(vec2(cx + (float(p.x)-cx)*(1.0+sh), cy + (float(p.y)-cy)*(1.0+sh))).b;
  o = vec4(r, c0.g, b, 1.0);
}`,
  vignetta: LIB + `
uniform float u_f;
void main(){
  ivec2 p = P(); ivec2 dim = textureSize(u_a, 0);
  vec3 c = texelFetch(u_a, p, 0).rgb;
  float dx = (float(p.x) - float(dim.x)/2.0) / (float(dim.x)/2.0);
  float dy = (float(p.y) - float(dim.y)/2.0) / (float(dim.y)/2.0);
  float d = sqrt(dx*dx + dy*dy) / 1.41421356237;
  float m = pow(clamp01((d - 0.78) / 0.22), 2.2);
  o = vec4(clamp(c * (1.0 - m*u_f), 0.0, 1.0), 1.0);
}`,
  // grana pellicola: hash intero identico a rumore01, griglia 2px bilineare
  grana: LIB + `
uniform float u_f;
uniform uint u_seme;
float rumore01(uint x, uint y, uint s){
  uint h = x * 374761393u + y * 668265263u + s * 2246822519u + 0x9E3779B9u;
  h = (h ^ (h >> 13)) * 1274126177u;
  h ^= h >> 16;
  return float(h & 0xFFFFFFu) / 16777216.0;
}
float nodo(int x2, int y2){
  return rumore01(uint(x2), uint(y2), u_seme)
       + rumore01(uint(x2) + 7919u, uint(y2) + 104729u, u_seme) - 1.0;
}
void main(){
  ivec2 p = P(); ivec2 dim = textureSize(u_a, 0);
  vec3 c = texelFetch(u_a, p, 0).rgb;
  int gs = 2;
  int w2 = (dim.x + gs - 1) / gs, h2 = (dim.y + gs - 1) / gs;
  float fy = float(p.y) / float(gs);
  int y0 = min(int(fy), h2-1), y1 = min(y0+1, h2-1);
  float wy = fy - float(y0);
  float fx = float(p.x) / float(gs);
  int x0 = min(int(fx), w2-1), x1 = min(x0+1, w2-1);
  float wx = fx - float(x0);
  float n = (nodo(x0,y0)*(1.0-wx) + nodo(x1,y0)*wx)*(1.0-wy)
          + (nodo(x0,y1)*(1.0-wx) + nodo(x1,y1)*wx)*wy;
  float l = lum(c);
  float peso = l * (1.0 - l) * 4.0;
  o = vec4(clamp(c + n * u_f * 0.14 * peso, 0.0, 1.0), 1.0);
}`,
  // uscita: flip verticale + watermark (composito source-over, resta NEI pixel)
  final: LIB + `
uniform vec2 u_dim;
void main(){
  ivec2 p = ivec2(int(gl_FragCoord.x), int(u_dim.y) - 1 - int(gl_FragCoord.y));
  vec3 c = texelFetch(u_a, p, 0).rgb;
  vec4 wm = texelFetch(u_b, p, 0);
  o = vec4(mix(c, wm.rgb, wm.a), 1.0);
}`,
};

class PulseGL {
  constructor(canvas) {
    this.canvas = canvas;
    this.ok = false;
    const gl = canvas.getContext('webgl2', { premultipliedAlpha: false, preserveDrawingBuffer: false });
    if (!gl) return;
    if (!gl.getExtension('EXT_color_buffer_float')) return;
    this.gl = gl;
    this.progs = {};
    for (const [k, src] of Object.entries(FRAGS)) {
      const pr = this._link(VS, src);
      if (!pr) return;
      this.progs[k] = pr;
    }
    this.vao = gl.createVertexArray();
    this.texPool = new Map();
    this.fbo = gl.createFramebuffer();
    this.srcTex = gl.createTexture();
    this.wmTex = gl.createTexture();
    this.lutTex = gl.createTexture();
    this.lutN = 0;
    this.ok = true;
  }
  _link(vs, fs) {
    const gl = this.gl;
    const mk = (t, s) => {
      const sh = gl.createShader(t);
      gl.shaderSource(sh, s); gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        console.error('shader:', gl.getShaderInfoLog(sh)); return null;
      }
      return sh;
    };
    const v = mk(gl.VERTEX_SHADER, vs), f = mk(gl.FRAGMENT_SHADER, fs);
    if (!v || !f) return null;
    const p = gl.createProgram();
    gl.attachShader(p, v); gl.attachShader(p, f); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) { console.error(gl.getProgramInfoLog(p)); return null; }
    return p;
  }
  setLut(u8, n) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_3D, this.lutTex);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA8, n, n, n, 0, gl.RGBA, gl.UNSIGNED_BYTE, u8);
    this.lutN = n;
  }
  setWatermark(canvas2d) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.wmTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, canvas2d);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  }
  _tex(tag, w, h) {
    const key = tag + ':' + w + 'x' + h;
    let t = this.texPool.get(key);
    if (!t) {
      const gl = this.gl;
      t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, w, h);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      this.texPool.set(key, t);
    }
    return t;
  }
  _pass(prog, outTex, outW, outH, ins, setU) {
    const gl = this.gl;
    gl.useProgram(prog);
    if (outTex) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, outTex, 0);
    } else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
    gl.viewport(0, 0, outW, outH);
    const names = ['u_a', 'u_b', 'u_c'];
    ins.forEach((t, i) => {
      gl.activeTexture(gl.TEXTURE0 + i);
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.uniform1i(gl.getUniformLocation(prog, names[i]), i);
    });
    if (setU) setU(gl, prog);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  _box(tag, tex, w, h, r, rgb) {
    // box_blur: 3 passate di box separabile, come il C++
    const ph = this.progs[rgb ? 'boxh3' : 'boxh'], pv = this.progs[rgb ? 'boxv3' : 'boxv'];
    let cur = tex, tmp = this._tex(tag + '~', w, h);
    for (let p = 0; p < 3; p++) {
      this._pass(ph, tmp, w, h, [cur], (gl, pr) => gl.uniform1i(gl.getUniformLocation(pr, 'u_r'), r));
      this._pass(pv, cur, w, h, [tmp], (gl, pr) => gl.uniform1i(gl.getUniformLocation(pr, 'u_r'), r));
    }
    return cur;
  }
  _lum(img, w, h) {
    const L = this._tex('L', w, h);
    this._pass(this.progs.lum, L, w, h, [img]);
    return L;
  }
  /* render completo: source (video/img/canvas) → canvas GL. fx = Float32Array(12). */
  render(source, w, h, fx, punte, seme, showOriginal) {
    const gl = this.gl;
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w; this.canvas.height = h;
    }
    gl.bindTexture(gl.TEXTURE_2D, this.srcTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    let img = this._tex('imgA', w, h);
    this._pass(this.progs.color, img, w, h, [null], (g, pr) => {
      g.activeTexture(g.TEXTURE0);
      g.bindTexture(g.TEXTURE_2D, this.srcTex);
      g.uniform1i(g.getUniformLocation(pr, 'u_a'), 0);
      g.activeTexture(g.TEXTURE3);
      g.bindTexture(g.TEXTURE_3D, this.lutTex);
      g.uniform1i(g.getUniformLocation(pr, 'u_lut'), 3);
      g.uniform1f(g.getUniformLocation(pr, 'u_n'), this.lutN);
      g.uniform1i(g.getUniformLocation(pr, 'u_orig'), showOriginal ? 1 : 0);
      g.uniform2f(g.getUniformLocation(pr, 'u_out'), w, h);
    });
    let imgB = this._tex('imgB', w, h);

    if (!showOriginal) {
      const F = { enhance: fx[0], halation: fx[1], bloom: fx[2], vignetta: fx[3],
                  grana: fx[4], promist: fx[5], mist_bianca: fx[6], glimmer: fx[7],
                  pelle: fx[8], streak: fx[9], ca: fx[10], stella: fx[11] };
      const mx = Math.max(w, h);
      const Re = Math.max(1, Math.round(0.012 * mx));
      const Rh = Math.max(2, Math.round(0.018 * mx));
      const Rb = Math.max(1, Math.round(0.010 * mx));
      const ds = Math.max(1, Math.min(4, Math.floor(mx / 960)));
      let L = this._lum(img, w, h);
      const swap = () => { const t = img; img = imgB; imgB = t; };
      // maschera scalare → blur_su_ridotta → screen tintato (schema comune)
      const screenFx = (mode, r, dsEff, gain, tint) => {
        let m = this._tex('m0', w, h);
        this._pass(this.progs.maskl, m, w, h, [L], (g, pr) => g.uniform1i(g.getUniformLocation(pr, 'u_mode'), mode));
        if (dsEff > 1) {
          const w2 = Math.max(1, Math.floor(w / dsEff)), h2 = Math.max(1, Math.floor(h / dsEff));
          const sm = this._tex('sm0', w2, h2);
          this._pass(this.progs.down, sm, w2, h2, [m], (g, pr) => g.uniform1i(g.getUniformLocation(pr, 'u_ds'), dsEff));
          this._box('sm0', sm, w2, h2, Math.max(1, Math.floor(r / dsEff)), false);
          this._pass(this.progs.up, m, w, h, [sm], (g, pr) => g.uniform1i(g.getUniformLocation(pr, 'u_ds'), dsEff));
        } else {
          this._box('m0', m, w, h, r, false);
        }
        this._pass(this.progs.screen1, imgB, w, h, [img, m], (g, pr) => {
          g.uniform1f(g.getUniformLocation(pr, 'u_gain'), gain);
          g.uniform3f(g.getUniformLocation(pr, 'u_tint'), tint[0], tint[1], tint[2]);
        });
        swap();
        L = this._lum(img, w, h);
      };
      if (F.enhance > 0 || F.pelle > 0) {
        for (const [f, rr, coef] of [[F.enhance, Re, 2.0], [F.pelle, Math.max(1, Math.round(0.007*mx)), -1.6]]) {
          if (f <= 0) continue;
          const B = this._tex('B', w, h);
          this._pass(this.progs.lum, B, w, h, [img]);
          this._box('B', B, w, h, rr, false);
          this._pass(this.progs.detail, imgB, w, h, [img, L, B], (g, pr) =>
            g.uniform1f(g.getUniformLocation(pr, 'u_coef'), f * coef));
          swap();
          L = this._lum(img, w, h);
        }
      }
      if (F.halation > 0) screenFx(0, Rh, ds, F.halation, [1.0, 0.36, 0.12]);
      if (F.bloom > 0)    screenFx(1, Rb, ds, F.bloom, [1, 1, 1]);
      if (F.streak > 0) {
        // orizzontale puro, 3 passate, raggio 0.10·W
        let m = this._tex('m0', w, h);
        this._pass(this.progs.maskl, m, w, h, [L], (g, pr) => g.uniform1i(g.getUniformLocation(pr, 'u_mode'), 2));
        const Rs = Math.max(4, Math.round(0.10 * w));
        const w2 = Math.max(1, Math.floor(w / ds)), h2 = Math.max(1, Math.floor(h / ds));
        let sm = m, smW = w, smH = h;
        if (ds > 1) {
          sm = this._tex('sm0', w2, h2); smW = w2; smH = h2;
          this._pass(this.progs.down, sm, w2, h2, [m], (g, pr) => g.uniform1i(g.getUniformLocation(pr, 'u_ds'), ds));
        }
        const rr = Math.max(1, Math.floor(Rs / ds));
        const tmp = this._tex('sm0~', smW, smH);
        for (let p = 0; p < 3; p++) {
          this._pass(this.progs.boxh, tmp, smW, smH, [sm], (g, pr) => g.uniform1i(g.getUniformLocation(pr, 'u_r'), rr));
          const t = sm; sm = tmp; // ping-pong: il risultato resta in sm
          this._pass(this.progs.boxh, t, smW, smH, [sm], (g, pr) => g.uniform1i(g.getUniformLocation(pr, 'u_r'), 0));
          sm = t; // NB: passata r=0 = copia; tre box veri sotto
        }
        // le tre passate sopra con la copia sono state ridotte a: box,copia ×3 → equivalenti a 3 box
        if (ds > 1) this._pass(this.progs.up, m, w, h, [sm], (g, pr) => g.uniform1i(g.getUniformLocation(pr, 'u_ds'), ds));
        else m = sm;
        this._pass(this.progs.screen1, imgB, w, h, [img, m], (g, pr) => {
          g.uniform1f(g.getUniformLocation(pr, 'u_gain'), F.streak * 2.2);
          g.uniform3f(g.getUniformLocation(pr, 'u_tint'), 0.30, 0.55, 1.0);
        });
        swap();
        L = this._lum(img, w, h);
      }
      if (F.promist > 0) {
        const Rp = Math.max(3, Math.round(0.035 * mx));
        const de = Math.max(2, ds);
        const C = this._tex('C', w, h);
        this._pass(this.progs.maskrgb, C, w, h, [img, L], (g, pr) => {
          g.uniform1f(g.getUniformLocation(pr, 'u_th'), 0.45);
          g.uniform1f(g.getUniformLocation(pr, 'u_den'), 0.55);
        });
        const w2 = Math.max(1, Math.floor(w / de)), h2 = Math.max(1, Math.floor(h / de));
        const sc = this._tex('sc', w2, h2);
        this._pass(this.progs.down, sc, w2, h2, [C], (g, pr) => g.uniform1i(g.getUniformLocation(pr, 'u_ds'), de));
        this._box('sc', sc, w2, h2, Math.max(1, Math.floor(Rp / de)), true);
        this._pass(this.progs.up, C, w, h, [sc], (g, pr) => g.uniform1i(g.getUniformLocation(pr, 'u_ds'), de));
        this._pass(this.progs.screen3, imgB, w, h, [img, C], (g, pr) =>
          g.uniform1f(g.getUniformLocation(pr, 'u_gain'), F.promist * 1.5));
        swap();
        L = this._lum(img, w, h);
      }
      if (F.stella > 0) {
        let m = this._tex('m0', w, h);
        this._pass(this.progs.maskl, m, w, h, [L], (g, pr) => g.uniform1i(g.getUniformLocation(pr, 'u_mode'), 4));
        const w2 = Math.max(1, Math.floor(w / ds)), h2 = Math.max(1, Math.floor(h / ds));
        let sm = m, smW = w, smH = h;
        if (ds > 1) {
          sm = this._tex('sm0', w2, h2); smW = w2; smH = h2;
          this._pass(this.progs.down, sm, w2, h2, [m], (g, pr) => g.uniform1i(g.getUniformLocation(pr, 'u_ds'), ds));
        }
        const assi = Math.max(2, Math.min(4, Math.floor(punte / 2)));
        const base = (punte === 4) ? Math.PI / 4 : 0;
        const r = Math.max(3, Math.round(0.09 * w / ds));
        const R = this._tex('R', smW, smH);
        this._pass(this.progs.stella, R, smW, smH, [sm], (g, pr) => {
          g.uniform1i(g.getUniformLocation(pr, 'u_r'), r);
          g.uniform1i(g.getUniformLocation(pr, 'u_assi'), assi);
          g.uniform1f(g.getUniformLocation(pr, 'u_base'), base);
        });
        let Rfull = R;
        if (ds > 1) {
          Rfull = this._tex('m1', w, h);
          this._pass(this.progs.up, Rfull, w, h, [R], (g, pr) => g.uniform1i(g.getUniformLocation(pr, 'u_ds'), ds));
        }
        this._pass(this.progs.screen1, imgB, w, h, [img, Rfull], (g, pr) => {
          g.uniform1f(g.getUniformLocation(pr, 'u_gain'), F.stella * 2.4);
          g.uniform3f(g.getUniformLocation(pr, 'u_tint'), 1, 1, 1);
        });
        swap();
        L = this._lum(img, w, h);
      }
      if (F.mist_bianca > 0) {
        const Rp = Math.max(3, Math.round(0.035 * mx));
        const de = Math.max(2, ds);
        const w2 = Math.max(1, Math.floor(w / de)), h2 = Math.max(1, Math.floor(h / de));
        // media ESATTA di L: somme per blocchi 8×8 poi readback
        const sw = Math.ceil(w / 8), sh = Math.ceil(h / 8);
        const sums = this._tex('sum', sw, sh);
        this._pass(this.progs.downsum, sums, sw, sh, [L], (g, pr) => g.uniform1i(g.getUniformLocation(pr, 'u_ds'), 8));
        const buf = new Float32Array(sw * sh * 4);
        gl.readPixels(0, 0, sw, sh, gl.RGBA, gl.FLOAT, buf);
        let tot = 0;
        for (let i = 0; i < sw * sh; i++) tot += buf[i * 4];
        const media = tot / (w * h);
        // V = blur di L a raggio Rp su ridotta
        const V = this._tex('V', w, h);
        this._pass(this.progs.lum, V, w, h, [img]);
        const sv = this._tex('sv', w2, h2);
        this._pass(this.progs.down, sv, w2, h2, [V], (g, pr) => g.uniform1i(g.getUniformLocation(pr, 'u_ds'), de));
        this._box('sv', sv, w2, h2, Math.max(1, Math.floor(Rp / de)), false);
        this._pass(this.progs.up, V, w, h, [sv], (g, pr) => g.uniform1i(g.getUniformLocation(pr, 'u_ds'), de));
        // C = img pesata, blur come sopra
        const C = this._tex('C', w, h);
        this._pass(this.progs.maskrgb, C, w, h, [img, L], (g, pr) => {
          g.uniform1f(g.getUniformLocation(pr, 'u_th'), 0.35);
          g.uniform1f(g.getUniformLocation(pr, 'u_den'), 0.65);
        });
        const sc = this._tex('sc', w2, h2);
        this._pass(this.progs.down, sc, w2, h2, [C], (g, pr) => g.uniform1i(g.getUniformLocation(pr, 'u_ds'), de));
        this._box('sc', sc, w2, h2, Math.max(1, Math.floor(Rp / de)), true);
        this._pass(this.progs.up, C, w, h, [sc], (g, pr) => g.uniform1i(g.getUniformLocation(pr, 'u_ds'), de));
        this._pass(this.progs.mist, imgB, w, h, [img, C, V], (g, pr) => {
          g.uniform1f(g.getUniformLocation(pr, 'u_gain'), F.mist_bianca * 1.3);
          g.uniform1f(g.getUniformLocation(pr, 'u_veil'), F.mist_bianca * 0.22);
          g.uniform1f(g.getUniformLocation(pr, 'u_media'), media);
        });
        swap();
        L = this._lum(img, w, h);
      }
      if (F.glimmer > 0) screenFx(3, Math.max(2, Math.round(0.008 * mx)), ds, F.glimmer * 1.4, [1, 1, 1]);
      if (F.ca > 0) {
        this._pass(this.progs.ca, imgB, w, h, [img], (g, pr) =>
          g.uniform1f(g.getUniformLocation(pr, 'u_ca'), F.ca));
        swap();
      }
      if (F.vignetta > 0) {
        this._pass(this.progs.vignetta, imgB, w, h, [img], (g, pr) =>
          g.uniform1f(g.getUniformLocation(pr, 'u_f'), F.vignetta));
        swap();
      }
      if (F.grana > 0) {
        this._pass(this.progs.grana, imgB, w, h, [img], (g, pr) => {
          g.uniform1f(g.getUniformLocation(pr, 'u_f'), F.grana);
          g.uniform1ui(g.getUniformLocation(pr, 'u_seme'), seme >>> 0);
        });
        swap();
      }
    }
    this._pass(this.progs.final, null, w, h, [img, this.wmTex], (g, pr) =>
      g.uniform2f(g.getUniformLocation(pr, 'u_dim'), w, h));
  }
  /* legge i pixel dell'ULTIMO render — SOLO per il gate di parità (?debug) */
  _readForParity(w, h) {
    const gl = this.gl;
    const img = this.texPool.get('imgA:' + w + 'x' + h);
    // rilegge dal framebuffer di output non è possibile (preserve=false):
    // il gate ridisegna e legge subito, vedi demo.js
    const buf = new Uint8Array(w * h * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    return buf;
  }
}

window.PulseGL = PulseGL;
})();
