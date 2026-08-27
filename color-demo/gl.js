"use strict";(()=>{const I=`#version 300 es
void main(){
  vec2 p = vec2((gl_VertexID<<1)&2, gl_VertexID&2);
  gl_Position = vec4(p*2.0-1.0, 0.0, 1.0);
}`,b=`#version 300 es
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
`,G={color:b+`
uniform sampler3D u_lut;
uniform float u_n;
uniform int u_orig;
uniform vec2 u_out;
void main(){
  vec3 c = texture(u_a, (vec2(P()) + 0.5) / u_out).rgb;
  if (u_orig == 0) c = texture(u_lut, (c*(u_n-1.0)+0.5)/u_n).rgb;
  o = vec4(c, 1.0);
}`,lum:b+"void main(){ o = vec4(lum(texelFetch(u_a, P(), 0).rgb)); }",boxh:b+`
uniform int u_r;
void main(){
  ivec2 p = P(); int W = textureSize(u_a, 0).x;
  float acc = 0.0;
  for (int t = -u_r; t <= u_r; t++)
    acc += texelFetch(u_a, ivec2(clamp(p.x+t, 0, W-1), p.y), 0).r;
  o = vec4(acc / float(2*u_r+1));
}`,boxv:b+`
uniform int u_r;
void main(){
  ivec2 p = P(); int H = textureSize(u_a, 0).y;
  float acc = 0.0;
  for (int t = -u_r; t <= u_r; t++)
    acc += texelFetch(u_a, ivec2(p.x, clamp(p.y+t, 0, H-1)), 0).r;
  o = vec4(acc / float(2*u_r+1));
}`,boxh3:b+`
uniform int u_r;
void main(){
  ivec2 p = P(); int W = textureSize(u_a, 0).x;
  vec3 acc = vec3(0.0);
  for (int t = -u_r; t <= u_r; t++)
    acc += texelFetch(u_a, ivec2(clamp(p.x+t, 0, W-1), p.y), 0).rgb;
  o = vec4(acc / float(2*u_r+1), 1.0);
}`,boxv3:b+`
uniform int u_r;
void main(){
  ivec2 p = P(); int H = textureSize(u_a, 0).y;
  vec3 acc = vec3(0.0);
  for (int t = -u_r; t <= u_r; t++)
    acc += texelFetch(u_a, ivec2(p.x, clamp(p.y+t, 0, H-1)), 0).rgb;
  o = vec4(acc / float(2*u_r+1), 1.0);
}`,down:b+`
uniform int u_ds;
void main(){
  ivec2 p2 = P(); ivec2 dim = textureSize(u_a, 0);
  vec4 acc = vec4(0.0); int n = 0;
  for (int dy = 0; dy < u_ds; dy++) for (int dx = 0; dx < u_ds; dx++) {
    ivec2 q = p2*u_ds + ivec2(dx, dy);
    if (q.x < dim.x && q.y < dim.y) { acc += texelFetch(u_a, q, 0); n++; }
  }
  o = acc / float(max(n, 1));
}`,up:b+`
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
}`,downsum:b+`
uniform int u_ds;
void main(){
  ivec2 p2 = P(); ivec2 dim = textureSize(u_a, 0);
  float acc = 0.0;
  for (int dy = 0; dy < u_ds; dy++) for (int dx = 0; dx < u_ds; dx++) {
    ivec2 q = p2*u_ds + ivec2(dx, dy);
    if (q.x < dim.x && q.y < dim.y) acc += texelFetch(u_a, q, 0).r;
  }
  o = vec4(acc);
}`,detail:b+`
uniform float u_coef;   
void main(){
  vec3 c = texelFetch(u_a, P(), 0).rgb;
  float l = texelFetch(u_b, P(), 0).r;
  float b = texelFetch(u_c, P(), 0).r;
  float det = tanhv((l - b) * 3.0) / 3.0;
  float ln = min(1.0, max(1e-6, l + det * u_coef));
  float g = ln / max(l, 1e-6);
  o = vec4(clamp(c*g, 0.0, 1.0), 1.0);
}`,maskl:b+`
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
}`,maskrgb:b+`
uniform float u_th;
uniform float u_den;
void main(){
  vec3 c = texelFetch(u_a, P(), 0).rgb;
  float l = texelFetch(u_b, P(), 0).r;
  float w = clamp01((l - u_th) / u_den); w *= w;
  o = vec4(c*w, 1.0);
}`,screen1:b+`
uniform float u_gain;
uniform vec3 u_tint;
void main(){
  vec3 c = texelFetch(u_a, P(), 0).rgb;
  float al = texelFetch(u_b, P(), 0).r * u_gain;
  vec3 v = min(vec3(1.0), al * u_tint);
  o = vec4(1.0 - (1.0 - c) * (1.0 - v), 1.0);
}`,screen3:b+`
uniform float u_gain;
void main(){
  vec3 c = texelFetch(u_a, P(), 0).rgb;
  vec3 v = min(vec3(1.0), texelFetch(u_b, P(), 0).rgb * u_gain);
  o = vec4(1.0 - (1.0 - c) * (1.0 - v), 1.0);
}`,mist:b+`
uniform float u_gain;   
uniform float u_veil;   
uniform float u_media;  
void main(){
  vec3 c = texelFetch(u_a, P(), 0).rgb;
  vec3 C = texelFetch(u_b, P(), 0).rgb;
  float V = 0.5 * texelFetch(u_c, P(), 0).r + 0.5 * u_media;
  vec3 v = min(vec3(1.0), C * u_gain);
  vec3 x = 1.0 - (1.0 - c) * (1.0 - v);
  x += u_veil * V * (1.0 - x);
  o = vec4(clamp(x, 0.0, 1.0), 1.0);
}`,stella:b+`
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
}`,ca:b+`
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
}`,vignetta:b+`
uniform float u_f;
void main(){
  ivec2 p = P(); ivec2 dim = textureSize(u_a, 0);
  vec3 c = texelFetch(u_a, p, 0).rgb;
  float dx = (float(p.x) - float(dim.x)/2.0) / (float(dim.x)/2.0);
  float dy = (float(p.y) - float(dim.y)/2.0) / (float(dim.y)/2.0);
  float d = sqrt(dx*dx + dy*dy) / 1.41421356237;
  float m = pow(clamp01((d - 0.78) / 0.22), 2.2);
  o = vec4(clamp(c * (1.0 - m*u_f), 0.0, 1.0), 1.0);
}`,grana:b+`
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
}`,final:b+`
uniform vec2 u_dim;
void main(){
  ivec2 p = ivec2(int(gl_FragCoord.x), int(u_dim.y) - 1 - int(gl_FragCoord.y));
  vec3 c = texelFetch(u_a, p, 0).rgb;
  vec4 wm = texelFetch(u_b, p, 0);
  o = vec4(mix(c, wm.rgb, wm.a), 1.0);
}`};class B{constructor(p){this.canvas=p,this.ok=!1;const i=p.getContext("webgl2",{premultipliedAlpha:!1,preserveDrawingBuffer:!1});if(i&&i.getExtension("EXT_color_buffer_float")){this.gl=i,this.progs={};for(const[t,m]of Object.entries(G)){const y=this._link(I,m);if(!y)return;this.progs[t]=y}this.vao=i.createVertexArray(),this.texPool=new Map,this.fbo=i.createFramebuffer(),this.srcTex=i.createTexture(),this.wmTex=i.createTexture(),this.lutTex=i.createTexture(),this.lutN=0,this.ok=!0}}_link(p,i){const t=this.gl,m=(e,c)=>{const v=t.createShader(e);return t.shaderSource(v,c),t.compileShader(v),t.getShaderParameter(v,t.COMPILE_STATUS)?v:(console.error("shader:",t.getShaderInfoLog(v)),null)},y=m(t.VERTEX_SHADER,p),r=m(t.FRAGMENT_SHADER,i);if(!y||!r)return null;const n=t.createProgram();return t.attachShader(n,y),t.attachShader(n,r),t.linkProgram(n),t.getProgramParameter(n,t.LINK_STATUS)?n:(console.error(t.getProgramInfoLog(n)),null)}setLut(p,i){const t=this.gl;t.bindTexture(t.TEXTURE_3D,this.lutTex),t.texParameteri(t.TEXTURE_3D,t.TEXTURE_MIN_FILTER,t.LINEAR),t.texParameteri(t.TEXTURE_3D,t.TEXTURE_MAG_FILTER,t.LINEAR),t.texParameteri(t.TEXTURE_3D,t.TEXTURE_WRAP_S,t.CLAMP_TO_EDGE),t.texParameteri(t.TEXTURE_3D,t.TEXTURE_WRAP_T,t.CLAMP_TO_EDGE),t.texParameteri(t.TEXTURE_3D,t.TEXTURE_WRAP_R,t.CLAMP_TO_EDGE),t.texImage3D(t.TEXTURE_3D,0,t.RGBA8,i,i,i,0,t.RGBA,t.UNSIGNED_BYTE,p),this.lutN=i}setWatermark(p){const i=this.gl;i.bindTexture(i.TEXTURE_2D,this.wmTex),i.pixelStorei(i.UNPACK_FLIP_Y_WEBGL,!1),i.texImage2D(i.TEXTURE_2D,0,i.RGBA8,i.RGBA,i.UNSIGNED_BYTE,p),i.texParameteri(i.TEXTURE_2D,i.TEXTURE_MIN_FILTER,i.NEAREST),i.texParameteri(i.TEXTURE_2D,i.TEXTURE_MAG_FILTER,i.NEAREST)}_tex(p,i,t){const m=p+":"+i+"x"+t;let y=this.texPool.get(m);if(!y){const r=this.gl;y=r.createTexture(),r.bindTexture(r.TEXTURE_2D,y),r.texStorage2D(r.TEXTURE_2D,1,r.RGBA32F,i,t),r.texParameteri(r.TEXTURE_2D,r.TEXTURE_MIN_FILTER,r.NEAREST),r.texParameteri(r.TEXTURE_2D,r.TEXTURE_MAG_FILTER,r.NEAREST),r.texParameteri(r.TEXTURE_2D,r.TEXTURE_WRAP_S,r.CLAMP_TO_EDGE),r.texParameteri(r.TEXTURE_2D,r.TEXTURE_WRAP_T,r.CLAMP_TO_EDGE),this.texPool.set(m,y)}return y}_pass(p,i,t,m,y,r){const n=this.gl;n.useProgram(p),i?(n.bindFramebuffer(n.FRAMEBUFFER,this.fbo),n.framebufferTexture2D(n.FRAMEBUFFER,n.COLOR_ATTACHMENT0,n.TEXTURE_2D,i,0)):n.bindFramebuffer(n.FRAMEBUFFER,null),n.viewport(0,0,t,m);const e=["u_a","u_b","u_c"];y.forEach((c,v)=>{n.activeTexture(n.TEXTURE0+v),n.bindTexture(n.TEXTURE_2D,c),n.uniform1i(n.getUniformLocation(p,e[v]),v)}),r&&r(n,p),n.bindVertexArray(this.vao),n.drawArrays(n.TRIANGLES,0,3)}_box(p,i,t,m,y,r){const n=this.progs[r?"boxh3":"boxh"],e=this.progs[r?"boxv3":"boxv"];let c=i,v=this._tex(p+"~",t,m);for(let o=0;o<3;o++)this._pass(n,v,t,m,[c],(U,D)=>U.uniform1i(U.getUniformLocation(D,"u_r"),y)),this._pass(e,c,t,m,[v],(U,D)=>U.uniform1i(U.getUniformLocation(D,"u_r"),y));return c}_lum(p,i,t){const m=this._tex("L",i,t);return this._pass(this.progs.lum,m,i,t,[p]),m}render(p,i,t,m,y,r,n){const e=this.gl;(this.canvas.width!==i||this.canvas.height!==t)&&(this.canvas.width=i,this.canvas.height=t),e.bindTexture(e.TEXTURE_2D,this.srcTex),e.pixelStorei(e.UNPACK_FLIP_Y_WEBGL,!1),e.texImage2D(e.TEXTURE_2D,0,e.RGBA8,e.RGBA,e.UNSIGNED_BYTE,p),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MIN_FILTER,e.LINEAR),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MAG_FILTER,e.LINEAR),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_S,e.CLAMP_TO_EDGE),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_T,e.CLAMP_TO_EDGE);let c=this._tex("imgA",i,t);this._pass(this.progs.color,c,i,t,[null],(o,U)=>{o.activeTexture(o.TEXTURE0),o.bindTexture(o.TEXTURE_2D,this.srcTex),o.uniform1i(o.getUniformLocation(U,"u_a"),0),o.activeTexture(o.TEXTURE3),o.bindTexture(o.TEXTURE_3D,this.lutTex),o.uniform1i(o.getUniformLocation(U,"u_lut"),3),o.uniform1f(o.getUniformLocation(U,"u_n"),this.lutN),o.uniform1i(o.getUniformLocation(U,"u_orig"),n?1:0),o.uniform2f(o.getUniformLocation(U,"u_out"),i,t)});let v=this._tex("imgB",i,t);if(!n){const o={enhance:m[0],halation:m[1],bloom:m[2],vignetta:m[3],grana:m[4],promist:m[5],mist_bianca:m[6],glimmer:m[7],pelle:m[8],streak:m[9],ca:m[10],stella:m[11]},U=Math.max(i,t),D=Math.max(1,Math.round(.012*U)),N=Math.max(2,Math.round(.018*U)),k=Math.max(1,Math.round(.01*U)),L=Math.max(1,Math.min(4,Math.floor(U/960)));let F=this._lum(c,i,t);const A=()=>{const s=c;c=v,v=s},X=(s,u,x,T,f)=>{let d=this._tex("m0",i,t);if(this._pass(this.progs.maskl,d,i,t,[F],(a,E)=>a.uniform1i(a.getUniformLocation(E,"u_mode"),s)),x>1){const a=Math.max(1,Math.floor(i/x)),E=Math.max(1,Math.floor(t/x)),P=this._tex("sm0",a,E);this._pass(this.progs.down,P,a,E,[d],(h,g)=>h.uniform1i(h.getUniformLocation(g,"u_ds"),x)),this._box("sm0",P,a,E,Math.max(1,Math.floor(u/x)),!1),this._pass(this.progs.up,d,i,t,[P],(h,g)=>h.uniform1i(h.getUniformLocation(g,"u_ds"),x))}else this._box("m0",d,i,t,u,!1);this._pass(this.progs.screen1,v,i,t,[c,d],(a,E)=>{a.uniform1f(a.getUniformLocation(E,"u_gain"),T),a.uniform3f(a.getUniformLocation(E,"u_tint"),f[0],f[1],f[2])}),A(),F=this._lum(c,i,t)};if(o.enhance>0||o.pelle>0)for(const[s,u,x]of[[o.enhance,D,2],[o.pelle,Math.max(1,Math.round(.007*U)),-1.6]]){if(s<=0)continue;const T=this._tex("B",i,t);this._pass(this.progs.lum,T,i,t,[c]),this._box("B",T,i,t,u,!1),this._pass(this.progs.detail,v,i,t,[c,F,T],(f,d)=>f.uniform1f(f.getUniformLocation(d,"u_coef"),s*x)),A(),F=this._lum(c,i,t)}if(o.halation>0&&X(0,N,L,o.halation,[1,.36,.12]),o.bloom>0&&X(1,k,L,o.bloom,[1,1,1]),o.streak>0){let s=this._tex("m0",i,t);this._pass(this.progs.maskl,s,i,t,[F],(h,g)=>h.uniform1i(h.getUniformLocation(g,"u_mode"),2));const u=Math.max(4,Math.round(.1*i)),x=Math.max(1,Math.floor(i/L)),T=Math.max(1,Math.floor(t/L));let f=s,d=i,a=t;L>1&&(f=this._tex("sm0",x,T),d=x,a=T,this._pass(this.progs.down,f,x,T,[s],(h,g)=>h.uniform1i(h.getUniformLocation(g,"u_ds"),L)));const E=Math.max(1,Math.floor(u/L)),P=this._tex("sm0~",d,a);for(let h=0;h<3;h++){this._pass(this.progs.boxh,P,d,a,[f],(l,R)=>l.uniform1i(l.getUniformLocation(R,"u_r"),E));const g=f;f=P,this._pass(this.progs.boxh,g,d,a,[f],(l,R)=>l.uniform1i(l.getUniformLocation(R,"u_r"),0)),f=g}L>1?this._pass(this.progs.up,s,i,t,[f],(h,g)=>h.uniform1i(h.getUniformLocation(g,"u_ds"),L)):s=f,this._pass(this.progs.screen1,v,i,t,[c,s],(h,g)=>{h.uniform1f(h.getUniformLocation(g,"u_gain"),o.streak*2.2),h.uniform3f(h.getUniformLocation(g,"u_tint"),.3,.55,1)}),A(),F=this._lum(c,i,t)}if(o.promist>0){const s=Math.max(3,Math.round(.035*U)),u=Math.max(2,L),x=this._tex("C",i,t);this._pass(this.progs.maskrgb,x,i,t,[c,F],(a,E)=>{a.uniform1f(a.getUniformLocation(E,"u_th"),.45),a.uniform1f(a.getUniformLocation(E,"u_den"),.55)});const T=Math.max(1,Math.floor(i/u)),f=Math.max(1,Math.floor(t/u)),d=this._tex("sc",T,f);this._pass(this.progs.down,d,T,f,[x],(a,E)=>a.uniform1i(a.getUniformLocation(E,"u_ds"),u)),this._box("sc",d,T,f,Math.max(1,Math.floor(s/u)),!0),this._pass(this.progs.up,x,i,t,[d],(a,E)=>a.uniform1i(a.getUniformLocation(E,"u_ds"),u)),this._pass(this.progs.screen3,v,i,t,[c,x],(a,E)=>a.uniform1f(a.getUniformLocation(E,"u_gain"),o.promist*1.5)),A(),F=this._lum(c,i,t)}if(o.stella>0){let s=this._tex("m0",i,t);this._pass(this.progs.maskl,s,i,t,[F],(l,R)=>l.uniform1i(l.getUniformLocation(R,"u_mode"),4));const u=Math.max(1,Math.floor(i/L)),x=Math.max(1,Math.floor(t/L));let T=s,f=i,d=t;L>1&&(T=this._tex("sm0",u,x),f=u,d=x,this._pass(this.progs.down,T,u,x,[s],(l,R)=>l.uniform1i(l.getUniformLocation(R,"u_ds"),L)));const a=Math.max(2,Math.min(4,Math.floor(y/2))),E=y===4?Math.PI/4:0,P=Math.max(3,Math.round(.09*i/L)),h=this._tex("R",f,d);this._pass(this.progs.stella,h,f,d,[T],(l,R)=>{l.uniform1i(l.getUniformLocation(R,"u_r"),P),l.uniform1i(l.getUniformLocation(R,"u_assi"),a),l.uniform1f(l.getUniformLocation(R,"u_base"),E)});let g=h;L>1&&(g=this._tex("m1",i,t),this._pass(this.progs.up,g,i,t,[h],(l,R)=>l.uniform1i(l.getUniformLocation(R,"u_ds"),L))),this._pass(this.progs.screen1,v,i,t,[c,g],(l,R)=>{l.uniform1f(l.getUniformLocation(R,"u_gain"),o.stella*2.4),l.uniform3f(l.getUniformLocation(R,"u_tint"),1,1,1)}),A(),F=this._lum(c,i,t)}if(o.mist_bianca>0){const s=Math.max(3,Math.round(.035*U)),u=Math.max(2,L),x=Math.max(1,Math.floor(i/u)),T=Math.max(1,Math.floor(t/u)),f=Math.ceil(i/8),d=Math.ceil(t/8),a=this._tex("sum",f,d);this._pass(this.progs.downsum,a,f,d,[F],(_,M)=>_.uniform1i(_.getUniformLocation(M,"u_ds"),8));const E=new Float32Array(f*d*4);e.readPixels(0,0,f,d,e.RGBA,e.FLOAT,E);let P=0;for(let _=0;_<f*d;_++)P+=E[_*4];const h=P/(i*t),g=this._tex("V",i,t);this._pass(this.progs.lum,g,i,t,[c]);const l=this._tex("sv",x,T);this._pass(this.progs.down,l,x,T,[g],(_,M)=>_.uniform1i(_.getUniformLocation(M,"u_ds"),u)),this._box("sv",l,x,T,Math.max(1,Math.floor(s/u)),!1),this._pass(this.progs.up,g,i,t,[l],(_,M)=>_.uniform1i(_.getUniformLocation(M,"u_ds"),u));const R=this._tex("C",i,t);this._pass(this.progs.maskrgb,R,i,t,[c,F],(_,M)=>{_.uniform1f(_.getUniformLocation(M,"u_th"),.35),_.uniform1f(_.getUniformLocation(M,"u_den"),.65)});const S=this._tex("sc",x,T);this._pass(this.progs.down,S,x,T,[R],(_,M)=>_.uniform1i(_.getUniformLocation(M,"u_ds"),u)),this._box("sc",S,x,T,Math.max(1,Math.floor(s/u)),!0),this._pass(this.progs.up,R,i,t,[S],(_,M)=>_.uniform1i(_.getUniformLocation(M,"u_ds"),u)),this._pass(this.progs.mist,v,i,t,[c,R,g],(_,M)=>{_.uniform1f(_.getUniformLocation(M,"u_gain"),o.mist_bianca*1.3),_.uniform1f(_.getUniformLocation(M,"u_veil"),o.mist_bianca*.22),_.uniform1f(_.getUniformLocation(M,"u_media"),h)}),A(),F=this._lum(c,i,t)}o.glimmer>0&&X(3,Math.max(2,Math.round(.008*U)),L,o.glimmer*1.4,[1,1,1]),o.ca>0&&(this._pass(this.progs.ca,v,i,t,[c],(s,u)=>s.uniform1f(s.getUniformLocation(u,"u_ca"),o.ca)),A()),o.vignetta>0&&(this._pass(this.progs.vignetta,v,i,t,[c],(s,u)=>s.uniform1f(s.getUniformLocation(u,"u_f"),o.vignetta)),A()),o.grana>0&&(this._pass(this.progs.grana,v,i,t,[c],(s,u)=>{s.uniform1f(s.getUniformLocation(u,"u_f"),o.grana),s.uniform1ui(s.getUniformLocation(u,"u_seme"),r>>>0)}),A())}this._pass(this.progs.final,null,i,t,[c,this.wmTex],(o,U)=>o.uniform2f(o.getUniformLocation(U,"u_dim"),i,t))}_readForParity(p,i){const t=this.gl,m=this.texPool.get("imgA:"+p+"x"+i),y=new Uint8Array(p*i*4);return t.bindFramebuffer(t.FRAMEBUFFER,null),t.readPixels(0,0,p,i,t.RGBA,t.UNSIGNED_BYTE,y),y}}window.PulseGL=B})();
