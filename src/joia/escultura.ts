// WJGoldDiamond: escultura livre em malha (folhas, flores, volutas orgânicas, relevos).
// Cada escultura parte de uma forma fechada (esfera, gota, folha, cápsula) com topologia de
// icosfera: a topologia sai só de (forma, nível) e o arquivo guarda apenas as posições
// (quantizadas em 16 bits, base64). Pincéis: puxar, inflar, suavizar, achatar, vinco e arrastar,
// com queda suave, simetria no X local e inversão. Puro: interface, worker e testes em Node.

import type { V3 } from "./regras";

export type FormaBase = "esfera" | "gota" | "folha" | "capsula";
export type Pincel = "puxar" | "inflar" | "suavizar" | "achatar" | "vinco" | "arrastar";

export interface Escultura {
  id: string;
  nome: string;
  ativo: boolean;
  base: FormaBase;
  /** nível de subdivisão da icosfera (3 a 6: 642 a 40 962 vértices) */
  nivel: number;
  /** posições esculpidas (quantizadas); ausente = forma inicial */
  pos?: { min: V3; max: V3; dados: string };
  /** lugar na joia: θ ao longo do aro (°, 0 = topo), lateral z (mm), altura sobre o aro (mm), tamanho (mm), giros (°) */
  lugar: { th: number; z: number; altura: number; tamanho: number; rx: number; ry: number; rz: number };
  /** cópia espelhada do outro lado do aro (−θ) */
  espelhar: boolean;
}

export interface Malha { pos: Float32Array; tri: Uint32Array }

// ---------------------------------------------------------------------------------------------
// topologia: icosfera de raio 1

const cacheTopo = new Map<number, Malha>();

/** Icosfera unitária no nível n (vértices na esfera; a ordem é sempre a mesma para o mesmo n). */
export function icosfera(n: number): Malha {
  const c = cacheTopo.get(n);
  if (c) return { pos: c.pos.slice(), tri: c.tri };
  const t = (1 + Math.sqrt(5)) / 2;
  let v: number[] = [-1, t, 0, 1, t, 0, -1, -t, 0, 1, -t, 0, 0, -1, t, 0, 1, t, 0, -1, -t, 0, 1, -t, t, 0, -1, t, 0, 1, -t, 0, -1, -t, 0, 1];
  let f: number[] = [0, 11, 5, 0, 5, 1, 0, 1, 7, 0, 7, 10, 0, 10, 11, 1, 5, 9, 5, 11, 4, 11, 10, 2, 10, 7, 6, 7, 1, 8, 3, 9, 4, 3, 4, 2, 3, 2, 6, 3, 6, 8, 3, 8, 9, 4, 9, 5, 2, 4, 11, 6, 2, 10, 8, 6, 7, 9, 8, 1];
  const norm = () => {
    for (let i = 0; i < v.length; i += 3) {
      const L = Math.hypot(v[i], v[i + 1], v[i + 2]);
      v[i] /= L; v[i + 1] /= L; v[i + 2] /= L;
    }
  };
  norm();
  for (let k = 0; k < n; k++) {
    const r = subdividirTopo(new Float32Array(v), new Uint32Array(f));
    v = Array.from(r.pos);
    f = Array.from(r.tri);
    norm();
  }
  const m = { pos: new Float32Array(v), tri: new Uint32Array(f) };
  cacheTopo.set(n, m);
  return { pos: m.pos.slice(), tri: m.tri };
}

/** Subdivisão pelo ponto médio das arestas (4 triângulos por triângulo), ordem determinística. */
export function subdividirTopo(pos: Float32Array, tri: Uint32Array): Malha {
  const nv = pos.length / 3;
  const meio = new Map<number, number>();
  const novos: number[] = [];
  const idMeio = (a: number, b: number) => {
    const k = a < b ? a * 1e7 + b : b * 1e7 + a;
    let id = meio.get(k);
    if (id === undefined) {
      id = nv + novos.length / 3;
      novos.push((pos[3 * a] + pos[3 * b]) / 2, (pos[3 * a + 1] + pos[3 * b + 1]) / 2, (pos[3 * a + 2] + pos[3 * b + 2]) / 2);
      meio.set(k, id);
    }
    return id;
  };
  const out: number[] = [];
  for (let i = 0; i < tri.length; i += 3) {
    const a = tri[i], b = tri[i + 1], c = tri[i + 2];
    const ab = idMeio(a, b), bc = idMeio(b, c), ca = idMeio(c, a);
    out.push(a, ab, ca, b, bc, ab, c, ca, bc, ab, bc, ca);
  }
  const p = new Float32Array(pos.length + novos.length);
  p.set(pos);
  p.set(novos, pos.length);
  return { pos: p, tri: new Uint32Array(out) };
}

/** Forma inicial (raio ~1, comprimento no X local, altura no Y). */
export function formaInicial(base: FormaBase, nivel: number): Malha {
  const m = icosfera(nivel);
  const p = m.pos;
  for (let i = 0; i < p.length; i += 3) {
    const x = p[i], y = p[i + 1], z = p[i + 2];
    if (base === "gota") {
      // gota deitada: redonda em −X, ponta em +X
      const u = (x + 1) / 2;
      const k = Math.sin(Math.PI * Math.pow(u, 0.65)) * 0.75 + 0.05;
      p[i] = x * 1.4; p[i + 1] = y * k; p[i + 2] = z * k;
    } else if (base === "folha") {
      // folha: elipse pontuda no X, achatada no Y, levemente curvada
      const k = Math.pow(Math.max(0, 1 - x * x), 0.6);
      p[i] = x * 1.6; p[i + 1] = y * 0.12 * k + 0.25 * (1 - x * x) - 0.25; p[i + 2] = z * 0.7 * k;
    } else if (base === "capsula") {
      p[i] = x * 0.45 + Math.sign(x) * 1.0; p[i + 1] = y * 0.45; p[i + 2] = z * 0.45;
    }
  }
  return m;
}

// ---------------------------------------------------------------------------------------------
// posições: codificação compacta

function base64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function deBase64(t: string): Uint8Array {
  const s = atob(t);
  const b = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
  return b;
}

export function codificar(pos: Float32Array): NonNullable<Escultura["pos"]> {
  const min: V3 = [Infinity, Infinity, Infinity], max: V3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i += 3) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], pos[i + k]); max[k] = Math.max(max[k], pos[i + k]); }
  const q = new Uint16Array(pos.length);
  for (let i = 0; i < pos.length; i++) {
    const k = i % 3, d = max[k] - min[k] || 1;
    q[i] = Math.round(((pos[i] - min[k]) / d) * 65535);
  }
  return { min, max, dados: base64(new Uint8Array(q.buffer)) };
}

export function decodificar(c: NonNullable<Escultura["pos"]>, n: number): Float32Array | null {
  const b = deBase64(c.dados);
  if (b.length !== n * 2) return null;
  const q = new Uint16Array(b.buffer, b.byteOffset, n);
  const p = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const k = i % 3;
    p[i] = c.min[k] + (q[i] / 65535) * (c.max[k] - c.min[k]);
  }
  return p;
}

/** Malha local da escultura (forma inicial ou posições esculpidas). */
export function malhaLocal(e: Escultura): Malha {
  const m = formaInicial(e.base, e.nivel);
  if (e.pos) {
    const p = decodificar(e.pos, m.pos.length);
    if (p) m.pos = p;
  }
  return m;
}

/** Sobe um nível de subdivisão mantendo a forma esculpida. */
export function subdividir(e: Escultura): Escultura {
  if (e.nivel >= 6) return e;
  const m = malhaLocal(e);
  const s = subdividirTopo(m.pos, m.tri);
  suavizarTudo(s, 1, 0.5);
  return { ...e, nivel: e.nivel + 1, pos: codificar(s.pos) };
}

// ---------------------------------------------------------------------------------------------
// vizinhança, normais e pincéis

export interface Vizinhanca { ini: Uint32Array; viz: Uint32Array }

export function vizinhanca(tri: Uint32Array, nv: number): Vizinhanca {
  const conj: Set<number>[] = Array.from({ length: nv }, () => new Set());
  for (let i = 0; i < tri.length; i += 3) {
    const a = tri[i], b = tri[i + 1], c = tri[i + 2];
    conj[a].add(b).add(c); conj[b].add(a).add(c); conj[c].add(a).add(b);
  }
  const ini = new Uint32Array(nv + 1);
  for (let i = 0; i < nv; i++) ini[i + 1] = ini[i] + conj[i].size;
  const viz = new Uint32Array(ini[nv]);
  for (let i = 0; i < nv; i++) viz.set([...conj[i]], ini[i]);
  return { ini, viz };
}

export function normais(pos: Float32Array, tri: Uint32Array, out: Float32Array = new Float32Array(pos.length)): Float32Array {
  out.fill(0);
  for (let i = 0; i < tri.length; i += 3) {
    const a = 3 * tri[i], b = 3 * tri[i + 1], c = 3 * tri[i + 2];
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const k of [a, b, c]) { out[k] += nx; out[k + 1] += ny; out[k + 2] += nz; }
  }
  for (let i = 0; i < out.length; i += 3) {
    const L = Math.hypot(out[i], out[i + 1], out[i + 2]) || 1;
    out[i] /= L; out[i + 1] /= L; out[i + 2] /= L;
  }
  return out;
}

function suavizarTudo(m: Malha, passos: number, k: number) {
  const vz = vizinhanca(m.tri, m.pos.length / 3);
  for (let s = 0; s < passos; s++) {
    const p = m.pos.slice();
    for (let i = 0; i < p.length / 3; i++) {
      let x = 0, y = 0, z = 0;
      const a = vz.ini[i], b = vz.ini[i + 1];
      for (let j = a; j < b; j++) { const q = 3 * vz.viz[j]; x += p[q]; y += p[q + 1]; z += p[q + 2]; }
      const n = b - a || 1;
      m.pos[3 * i] += (x / n - p[3 * i]) * k;
      m.pos[3 * i + 1] += (y / n - p[3 * i + 1]) * k;
      m.pos[3 * i + 2] += (z / n - p[3 * i + 2]) * k;
    }
  }
}

export interface Toque {
  pincel: Pincel;
  /** centro e normal no espaço local da escultura */
  c: V3;
  n: V3;
  /** raio no espaço local */
  r: number;
  /** força 0–1 (já com a pressão da caneta) */
  f: number;
  inverter: boolean;
  /** arrastar: deslocamento local deste passo */
  d?: V3;
  /** arrastar: pesos capturados no início do traço */
  pesos?: Map<number, number>;
}

const queda = (d: number, r: number) => {
  const u = 1 - (d * d) / (r * r);
  return u > 0 ? u * u : 0;
};

/** Pesos (queda) dos vértices dentro do raio; usado também para capturar o "arrastar". */
export function dentroDoRaio(pos: Float32Array, c: V3, r: number): Map<number, number> {
  const out = new Map<number, number>();
  const r2 = r * r;
  for (let i = 0, k = 0; i < pos.length; i += 3, k++) {
    const dx = pos[i] - c[0], dy = pos[i + 1] - c[1], dz = pos[i + 2] - c[2];
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 < r2) out.set(k, queda(Math.sqrt(d2), r));
  }
  return out;
}

/**
 * Aplica um toque do pincel (e o espelhado em X, se `simetria`). Devolve os vértices mexidos.
 * `nor` = normais atuais dos vértices; `vz` = vizinhança (suavizar).
 */
export function aplicarToque(pos: Float32Array, nor: Float32Array, vz: Vizinhanca, t: Toque, simetria: boolean): number {
  const toques = [t];
  if (simetria && Math.abs(t.c[0]) > t.r * 0.05) {
    toques.push({ ...t, c: [-t.c[0], t.c[1], t.c[2]], n: [-t.n[0], t.n[1], t.n[2]], d: t.d && [-t.d[0], t.d[1], t.d[2]], pesos: t.pesos && espelharPesos(pos, t.pesos) });
  }
  let mexidos = 0;
  for (const q of toques) mexidos += toque(pos, nor, vz, q);
  return mexidos;
}

const cacheEspelho = new WeakMap<Map<number, number>, Map<number, number>>();
/** Pesos do lado espelhado (vértice mais próximo do espelho de cada vértice capturado). */
function espelharPesos(pos: Float32Array, pesos: Map<number, number>): Map<number, number> {
  const c = cacheEspelho.get(pesos);
  if (c) return c;
  const out = new Map<number, number>();
  for (const [i, w] of pesos) {
    const x = -pos[3 * i], y = pos[3 * i + 1], z = pos[3 * i + 2];
    let melhor = -1, dm = Infinity;
    for (let j = 0; j < pos.length / 3; j++) {
      const d = (pos[3 * j] - x) ** 2 + (pos[3 * j + 1] - y) ** 2 + (pos[3 * j + 2] - z) ** 2;
      if (d < dm) { dm = d; melhor = j; }
    }
    if (melhor >= 0 && !pesos.has(melhor)) out.set(melhor, w);
  }
  cacheEspelho.set(pesos, out);
  return out;
}

function toque(pos: Float32Array, nor: Float32Array, vz: Vizinhanca, t: Toque): number {
  const sinal = t.inverter ? -1 : 1;
  if (t.pincel === "arrastar") {
    if (!t.pesos || !t.d) return 0;
    for (const [i, w] of t.pesos) { pos[3 * i] += t.d[0] * w; pos[3 * i + 1] += t.d[1] * w; pos[3 * i + 2] += t.d[2] * w; }
    return t.pesos.size;
  }
  const alvo = dentroDoRaio(pos, t.c, t.r);
  if (!alvo.size) return 0;
  const passo = t.r * 0.06 * t.f;
  // plano médio (achatar) e normal média (puxar)
  let cx = 0, cy = 0, cz = 0, nx = 0, ny = 0, nz = 0, sw = 0;
  for (const [i, w] of alvo) {
    cx += pos[3 * i] * w; cy += pos[3 * i + 1] * w; cz += pos[3 * i + 2] * w;
    nx += nor[3 * i] * w; ny += nor[3 * i + 1] * w; nz += nor[3 * i + 2] * w;
    sw += w;
  }
  cx /= sw; cy /= sw; cz /= sw;
  const nl = Math.hypot(nx, ny, nz) || 1;
  nx /= nl; ny /= nl; nz /= nl;
  const orig = t.pincel === "suavizar" ? pos.slice() : pos;
  for (const [i, w] of alvo) {
    const k = 3 * i;
    switch (t.pincel) {
      case "puxar":
        pos[k] += nx * passo * w * sinal; pos[k + 1] += ny * passo * w * sinal; pos[k + 2] += nz * passo * w * sinal;
        break;
      case "inflar":
        pos[k] += nor[k] * passo * w * sinal; pos[k + 1] += nor[k + 1] * passo * w * sinal; pos[k + 2] += nor[k + 2] * passo * w * sinal;
        break;
      case "suavizar": {
        let x = 0, y = 0, z = 0;
        const a = vz.ini[i], b = vz.ini[i + 1];
        for (let j = a; j < b; j++) { const q = 3 * vz.viz[j]; x += orig[q]; y += orig[q + 1]; z += orig[q + 2]; }
        const n = b - a || 1, s = Math.min(1, 0.6 * t.f * w);
        pos[k] += (x / n - orig[k]) * s; pos[k + 1] += (y / n - orig[k + 1]) * s; pos[k + 2] += (z / n - orig[k + 2]) * s;
        break;
      }
      case "achatar": {
        const dist = (pos[k] - cx) * nx + (pos[k + 1] - cy) * ny + (pos[k + 2] - cz) * nz;
        const s = Math.min(1, 0.5 * t.f * w);
        pos[k] -= nx * dist * s; pos[k + 1] -= ny * dist * s; pos[k + 2] -= nz * dist * s;
        break;
      }
      case "vinco": {
        // puxa para o centro do pincel (afina) e afunda junto da linha (inverter: crista)
        const s = 0.25 * t.f * w;
        pos[k] += (t.c[0] - pos[k]) * s - nx * passo * w * sinal * 0.6;
        pos[k + 1] += (t.c[1] - pos[k + 1]) * s - ny * passo * w * sinal * 0.6;
        pos[k + 2] += (t.c[2] - pos[k + 2]) * s - nz * passo * w * sinal * 0.6;
        break;
      }
    }
  }
  return alvo.size;
}

// ---------------------------------------------------------------------------------------------
// lugar na joia: local → mundo

/** Matriz 4×4 (coluna maior, como no Three.js) do local da escultura para a joia. */
export function matrizLugar(e: Escultura, R: number, t: (th: number) => number, espelho = false): number[] {
  const L = e.lugar;
  const th = (espelho ? -L.th : L.th) * Math.PI / 180;
  const s = Math.max(0.05, L.tamanho / 2);
  const rc = R + t(th) + L.altura;
  // referencial no aro: X = tangente, Y = radial, Z = eixo do aro
  const T: V3 = [Math.cos(th), -Math.sin(th), 0], Rr: V3 = [Math.sin(th), Math.cos(th), 0], Z: V3 = [0, 0, 1];
  const G = rotacaoXYZ(L.rx, L.ry, L.rz);
  const col = (v: V3): V3 => [T[0] * v[0] + Rr[0] * v[1] + Z[0] * v[2], T[1] * v[0] + Rr[1] * v[1] + Z[1] * v[2], T[2] * v[0] + Rr[2] * v[1] + Z[2] * v[2]];
  const ex = col([G[0], G[1], G[2]]), ey = col([G[3], G[4], G[5]]), ez = col([G[6], G[7], G[8]]);
  const sx = espelho ? -s : s;
  return [ex[0] * sx, ex[1] * sx, ex[2] * sx, 0, ey[0] * s, ey[1] * s, ey[2] * s, 0, ez[0] * s, ez[1] * s, ez[2] * s, 0, rc * Rr[0], rc * Rr[1], L.z, 1];
}

/** Colunas de Rz·Ry·Rx (graus). */
function rotacaoXYZ(ax: number, ay: number, az: number): number[] {
  const [x, y, z] = [ax, ay, az].map((g) => (g * Math.PI) / 180);
  const cx = Math.cos(x), sx = Math.sin(x), cy = Math.cos(y), sy = Math.sin(y), cz = Math.cos(z), sz = Math.sin(z);
  return [cz * cy, sz * cy, -sy, cz * sy * sx - sz * cx, sz * sy * sx + cz * cx, cy * sx, cz * sy * cx + sz * sx, sz * sy * cx - cz * sx, cy * cx];
}

/** Malhas no mundo (com a cópia espelhada), prontas para a união. Espelho inverte a ordem dos triângulos. */
export function malhasNoMundo(es: Escultura[], R: number, t: (th: number) => number): Malha[] {
  const out: Malha[] = [];
  for (const e of es) {
    if (!e.ativo) continue;
    const m = malhaLocal(e);
    for (const esp of e.espelhar ? [false, true] : [false]) {
      const M = matrizLugar(e, R, t, esp);
      const p = new Float32Array(m.pos.length);
      for (let i = 0; i < p.length; i += 3) {
        const x = m.pos[i], y = m.pos[i + 1], z = m.pos[i + 2];
        p[i] = M[0] * x + M[4] * y + M[8] * z + M[12];
        p[i + 1] = M[1] * x + M[5] * y + M[9] * z + M[13];
        p[i + 2] = M[2] * x + M[6] * y + M[10] * z + M[14];
      }
      let tri = m.tri;
      if (esp) {
        tri = m.tri.slice();
        for (let i = 0; i < tri.length; i += 3) [tri[i + 1], tri[i + 2]] = [tri[i + 2], tri[i + 1]];
      }
      out.push({ pos: p, tri });
    }
  }
  return out;
}

/** Volume de uma malha fechada (teorema da divergência). */
export function volumeMalha(m: Malha): number {
  let v = 0;
  const p = m.pos, t = m.tri;
  for (let i = 0; i < t.length; i += 3) {
    const a = 3 * t[i], b = 3 * t[i + 1], c = 3 * t[i + 2];
    v += p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) - p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c]) + p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c]);
  }
  return v / 6;
}

export function esculturaNova(id: string, base: FormaBase, n: number): Escultura {
  return {
    id, nome: `Escultura ${n}`, ativo: true, base, nivel: 5,
    lugar: { th: base === "folha" ? 22 : 0, z: 0, altura: 0.2, tamanho: base === "folha" ? 5 : 3, rx: 0, ry: base === "folha" ? 0 : 0, rz: 0 },
    espelhar: base === "folha",
  };
}
