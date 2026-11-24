// WJGoldDiamond: concordância (transição suave) entre aro, fios, folhas, garras e cabeça (J9b), na malha
// unida pelo manifold-3d. A superfície da joia não é mexida: perto de cada junção (onde peças diferentes se
// encontram) calcula-se o FECHAMENTO pelo raio R (dilatar R e erodir R: é o que a bola de raio R rolando por
// fora enche nos cantos côncavos) num campo de distâncias em voxels, e esse enchimento é unido à joia (só
// acrescenta metal: nada fica mais fino). Os assentos e cortes são tirados do enchimento (continuam vivos).
// Também: espessura por raios (testes) e normais para a vista com quebra nas arestas vivas.
// Puro + manifold-3d: worker e testes em Node.

import type { Malha } from "./escultura";
import type { V3 } from "./regras";

/** Origem de cada triângulo: peça unida (com o raio de concordância) ou corte (assento, gravação, ocar). */
export interface Origem { corte: boolean; raio: number }

/** Alcance do enchimento em volta da junção (em raios) e voxels por raio. */
const ALCANCE = 2.5;
const VOXELS_POR_RAIO = 3.5;
const MAX_VOXELS = 2_000_000;

/** Transformada de distância exata (quadrada) em 1D (Felzenszwalb–Huttenlocher), no lugar. */
function edt1(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array) {
  let k = 0;
  v[0] = 0; z[0] = -Infinity; z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    if (f[q] === Infinity) continue;
    if (f[v[k]] === Infinity) { v[k] = q; continue; }
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (k > 0 && s <= z[k]) { k--; s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
    if (k === 0 && f[v[0]] !== Infinity && s <= z[0]) { v[0] = q; z[1] = Infinity; continue; }
    k++; v[k] = q; z[k] = s; z[k + 1] = Infinity;
  }
  if (f[v[0]] === Infinity) { for (let q = 0; q < n; q++) d[q] = Infinity; return; }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
  }
}

/** Distância (em voxels) de cada voxel até a semente mais próxima (semente = 1). */
function edt3(sem: Uint8Array, nx: number, ny: number, nz: number): Float32Array {
  const N = nx * ny * nz, g = new Float64Array(N);
  for (let i = 0; i < N; i++) g[i] = sem[i] ? 0 : Infinity;
  const m = Math.max(nx, ny, nz), f = new Float64Array(m), d = new Float64Array(m), v = new Int32Array(m), z = new Float64Array(m + 1);
  // eixo x
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) {
    const o = (k * ny + j) * nx;
    for (let i = 0; i < nx; i++) f[i] = g[o + i];
    edt1(f, nx, d, v, z);
    for (let i = 0; i < nx; i++) g[o + i] = d[i];
  }
  // eixo y
  for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) {
    for (let j = 0; j < ny; j++) f[j] = g[(k * ny + j) * nx + i];
    edt1(f, ny, d, v, z);
    for (let j = 0; j < ny; j++) g[(k * ny + j) * nx + i] = d[j];
  }
  // eixo z
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    for (let k = 0; k < nz; k++) f[k] = g[(k * ny + j) * nx + i];
    edt1(f, nz, d, v, z);
    for (let k = 0; k < nz; k++) g[(k * ny + j) * nx + i] = d[k];
  }
  const out = new Float32Array(N);
  for (let i = 0; i < N; i++) out[i] = Math.sqrt(g[i]);
  return out;
}

/** Triângulos por coluna (y, z) para achar onde uma reta paralela a x cruza a malha. */
class Colunas {
  private cel = new Map<number, number[]>();
  constructor(private m: Malha, private tam: number) {
    const p = m.pos;
    for (let t = 0; t < m.tri.length; t += 3) {
      let y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (let c = 0; c < 3; c++) { const v = 3 * m.tri[t + c]; y0 = Math.min(y0, p[v + 1]); y1 = Math.max(y1, p[v + 1]); z0 = Math.min(z0, p[v + 2]); z1 = Math.max(z1, p[v + 2]); }
      for (let a = Math.floor(y0 / tam); a <= Math.floor(y1 / tam); a++) for (let b = Math.floor(z0 / tam); b <= Math.floor(z1 / tam); b++) {
        const k = (a + 100000) * 200000 + (b + 100000);
        let l = this.cel.get(k);
        if (!l) this.cel.set(k, (l = []));
        l.push(t);
      }
    }
  }
  /** x onde a reta (y, z) cruza a malha, em ordem. */
  cruzamentos(y: number, z: number): number[] {
    const l = this.cel.get((Math.floor(y / this.tam) + 100000) * 200000 + (Math.floor(z / this.tam) + 100000));
    if (!l) return [];
    const p = this.m.pos, T = this.m.tri, xs: number[] = [];
    for (const t of l) {
      const a = 3 * T[t], b = 3 * T[t + 1], c = 3 * T[t + 2];
      const ay = p[a + 1], az = p[a + 2], by = p[b + 1], bz = p[b + 2], cy = p[c + 1], cz = p[c + 2];
      const det = (by - ay) * (cz - az) - (cy - ay) * (bz - az);
      if (Math.abs(det) < 1e-14) continue;
      const u = ((y - ay) * (cz - az) - (cy - ay) * (z - az)) / det, v = ((by - ay) * (z - az) - (y - ay) * (bz - az)) / det;
      if (u < 0 || v < 0 || u + v > 1) continue;
      xs.push(p[a] + u * (p[b] - p[a]) + v * (p[c] - p[a]));
    }
    return xs.sort((x, y2) => x - y2);
  }
}

export interface ResultadoEnchimento {
  /** enchimento (manifold) para unir à joia; null = nada a encher */
  enchimento: any | null;
  pontos: number;
  grupos: number;
  voxels: number;
}

/**
 * Enchimento da concordância. `m` = malha unida (sem a concordância) com a origem de cada triângulo. Pontos da
 * junção = vértices tocados por duas peças diferentes (nunca ao lado de um corte), mais amostras nas arestas
 * entre eles. Em cada grupo de pontos, numa grade de voxels: dentro da joia (raios em x), distância até a joia
 * (dilatar R), distância até fora da dilatação (erodir R) e distância até a junção (máscara). O campo
 * min(fechamento − R − ε, alcance − distância à junção) vira malha pelo levelSet do manifold.
 */
export function enchimento(w: { Manifold: any }, m: Malha, origemTri: Int32Array, origens: Origem[]): ResultadoEnchimento {
  const p = m.pos, T = m.tri, nv = p.length / 3;
  const fonte = new Int32Array(nv).fill(-1), multi = new Uint8Array(nv), preso = new Uint8Array(nv), raio = new Float32Array(nv);
  for (let t = 0; t < T.length / 3; t++) {
    const o = origens[origemTri[t]];
    for (let c = 0; c < 3; c++) {
      const v = T[3 * t + c];
      if (o.corte) { preso[v] = 1; continue; }
      if (fonte[v] === -1) fonte[v] = origemTri[t];
      else if (fonte[v] !== origemTri[t]) multi[v] = 1;
      raio[v] = Math.max(raio[v], o.raio);
    }
  }
  const ehJ = (v: number) => multi[v] && !preso[v] && raio[v] > 0;
  // pontos da junção (x, y, z, R), com amostras nas arestas entre dois vértices da junção
  const pts: number[] = [];
  let rMax = 0;
  for (let v = 0; v < nv; v++) if (ehJ(v)) { pts.push(p[3 * v], p[3 * v + 1], p[3 * v + 2], raio[v]); rMax = Math.max(rMax, raio[v]); }
  if (!pts.length) return { enchimento: null, pontos: 0, grupos: 0, voxels: 0 };
  const passo = rMax / VOXELS_POR_RAIO / 2;
  const vistas = new Set<number>();
  for (let t = 0; t < T.length; t += 3)
    for (let c = 0; c < 3; c++) {
      const a = T[t + c], b = T[t + ((c + 1) % 3)];
      if (!ehJ(a) || !ehJ(b)) continue;
      const k = a < b ? a * 4294967296 + b : b * 4294967296 + a;
      if (vistas.has(k)) continue;
      vistas.add(k);
      const L = Math.hypot(p[3 * b] - p[3 * a], p[3 * b + 1] - p[3 * a + 1], p[3 * b + 2] - p[3 * a + 2]);
      if (L > 1.5) continue;
      const n = Math.floor(L / passo);
      for (let i = 1; i < n; i++) { const s = i / n; pts.push(p[3 * a] + (p[3 * b] - p[3 * a]) * s, p[3 * a + 1] + (p[3 * b + 1] - p[3 * a + 1]) * s, p[3 * a + 2] + (p[3 * b + 2] - p[3 * a + 2]) * s, Math.max(raio[a], raio[b])); }
    }
  // grupos: pontos ligados a menos de 2 alcances viram uma grade só (caixas que se tocam se juntam)
  const tamC = 2 * ALCANCE * rMax, celulas = new Map<string, number[]>();
  for (let i = 0; i < pts.length; i += 4) {
    const k = `${Math.floor(pts[i] / tamC)},${Math.floor(pts[i + 1] / tamC)},${Math.floor(pts[i + 2] / tamC)}`;
    let l = celulas.get(k);
    if (!l) celulas.set(k, (l = []));
    l.push(i);
  }
  const grupoDe = new Map<string, number>();
  const caixas: { min: V3; max: V3; pts: number[] }[] = [];
  for (const k of celulas.keys()) {
    if (grupoDe.has(k)) continue;
    const g = caixas.length, fila = [k], cx: { min: V3; max: V3; pts: number[] } = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity], pts: [] };
    grupoDe.set(k, g);
    while (fila.length) {
      const c = fila.pop()!;
      for (const i of celulas.get(c)!) { cx.pts.push(i); for (let e = 0; e < 3; e++) { cx.min[e] = Math.min(cx.min[e], pts[i + e]); cx.max[e] = Math.max(cx.max[e], pts[i + e]); } }
      const [a, b, d] = c.split(",").map(Number);
      for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) {
        const nk = `${a + x},${b + y},${d + z}`;
        if (celulas.has(nk) && !grupoDe.has(nk)) { grupoDe.set(nk, g); fila.push(nk); }
      }
    }
    caixas.push(cx);
  }
  const colunas = new Colunas(m, 0.25);
  const pecas: any[] = [];
  let voxels = 0;
  for (const cx of caixas) {
    const rG = Math.max(...cx.pts.map((i) => pts[i + 3]));
    let h = rG / VOXELS_POR_RAIO;
    const marg = ALCANCE * rG + 3 * h;
    const o: V3 = [cx.min[0] - marg, cx.min[1] - marg, cx.min[2] - marg];
    const tam: V3 = [cx.max[0] - cx.min[0] + 2 * marg, cx.max[1] - cx.min[1] + 2 * marg, cx.max[2] - cx.min[2] + 2 * marg];
    while (Math.ceil(tam[0] / h) * Math.ceil(tam[1] / h) * Math.ceil(tam[2] / h) > MAX_VOXELS) h *= 1.15;
    const nx = Math.ceil(tam[0] / h), ny = Math.ceil(tam[1] / h), nz = Math.ceil(tam[2] / h), N = nx * ny * nz;
    voxels += N;
    // dentro da joia: paridade dos cruzamentos de cada linha em x (pequeno desvio evita passar por arestas)
    const dentro = new Uint8Array(N);
    for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) {
      const y = o[1] + (j + 0.5) * h + 1.3e-7, z = o[2] + (k + 0.5) * h + 0.7e-7;
      const xs = colunas.cruzamentos(y, z);
      for (let q = 0; q + 1 < xs.length; q += 2) {
        const i0 = Math.max(0, Math.ceil((xs[q] - o[0]) / h - 0.5)), i1 = Math.min(nx - 1, Math.floor((xs[q + 1] - o[0]) / h - 0.5));
        for (let i = i0; i <= i1; i++) dentro[(k * ny + j) * nx + i] = 1;
      }
    }
    // dilatar R (distância até a joia) e erodir R (distância até fora da dilatação)
    const dOut = edt3(dentro, nx, ny, nz);
    const fora = new Uint8Array(N);
    for (let i = 0; i < N; i++) fora[i] = dOut[i] * h > rG ? 1 : 0;
    const e = edt3(fora, nx, ny, nz);
    // máscara: perto da junção
    const sem = new Uint8Array(N);
    for (const i of cx.pts) {
      const a = Math.floor((pts[i] - o[0]) / h), b = Math.floor((pts[i + 1] - o[1]) / h), c = Math.floor((pts[i + 2] - o[2]) / h);
      if (a >= 0 && b >= 0 && c >= 0 && a < nx && b < ny && c < nz) sem[(c * ny + b) * nx + a] = 1;
    }
    const dj = edt3(sem, nx, ny, nz);
    // campo (mm, positivo dentro do enchimento): fechamento um voxel para dentro (a superfície da joia fica
    // intacta fora dos cantos) e só dentro do alcance da junção; suavizado 3×3×3 (sem degraus de voxel)
    const eps = h;
    const F0 = new Float32Array(N);
    for (let i = 0; i < N; i++) F0[i] = Math.min(e[i] * h - (rG + eps), ALCANCE * rG - dj[i] * h);
    const F = new Float32Array(N);
    for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      let s = 0, c = 0;
      for (let dk = -1; dk <= 1; dk++) for (let dj2 = -1; dj2 <= 1; dj2++) for (let di = -1; di <= 1; di++) {
        const a = i + di, b = j + dj2, d = k + dk;
        if (a < 0 || b < 0 || d < 0 || a >= nx || b >= ny || d >= nz) continue;
        s += F0[(d * ny + b) * nx + a]; c++;
      }
      F[(k * ny + j) * nx + i] = s / c;
    }
    // sem nada a encher (cantos sem concavidade): pula
    let tem = false;
    for (let i = 0; i < N && !tem; i++) if (F[i] > 0) tem = true;
    if (!tem) continue;
    const campo = (q: V3) => {
      const x = (q[0] - o[0]) / h - 0.5, y = (q[1] - o[1]) / h - 0.5, z = (q[2] - o[2]) / h - 0.5;
      const i = Math.floor(x), j = Math.floor(y), k = Math.floor(z);
      if (i < 0 || j < 0 || k < 0 || i >= nx - 1 || j >= ny - 1 || k >= nz - 1) return -1;
      const fx = x - i, fy = y - j, fz = z - k, I = (a: number, b: number, c: number) => F[((k + c) * ny + (j + b)) * nx + (i + a)];
      const c00 = I(0, 0, 0) * (1 - fx) + I(1, 0, 0) * fx, c10 = I(0, 1, 0) * (1 - fx) + I(1, 1, 0) * fx, c01 = I(0, 0, 1) * (1 - fx) + I(1, 0, 1) * fx, c11 = I(0, 1, 1) * (1 - fx) + I(1, 1, 1) * fx;
      return (c00 * (1 - fy) + c10 * fy) * (1 - fz) + (c01 * (1 - fy) + c11 * fy) * fz;
    };
    try {
      const pc = w.Manifold.levelSet(campo, { min: [o[0] + h, o[1] + h, o[2] + h], max: [o[0] + (nx - 1) * h, o[1] + (ny - 1) * h, o[2] + (nz - 1) * h] }, h);
      if (pc.volume() > 1e-6) pecas.push(pc);
      else pc.delete();
    } catch {
      /* grupo sem enchimento */
    }
  }
  if (!pecas.length) return { enchimento: null, pontos: pts.length / 4, grupos: caixas.length, voxels };
  const u = pecas.length === 1 ? pecas[0] : w.Manifold.union(pecas);
  if (pecas.length > 1) for (const x of pecas) x.delete();
  return { enchimento: u, pontos: pts.length / 4, grupos: caixas.length, voxels };
}

// ---------------------------------------------------------------------------------------------
// espessura: raio para dentro (grade uniforme de triângulos)

export class Raios {
  private cel = new Map<number, number[]>();
  private min: [number, number, number];
  private n: [number, number, number];
  constructor(private m: Malha, private tam = 0.25) {
    const p = m.pos;
    const mn: [number, number, number] = [Infinity, Infinity, Infinity], mx: [number, number, number] = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < p.length; i += 3) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], p[i + k]); mx[k] = Math.max(mx[k], p[i + k]); }
    this.min = mn;
    this.n = [0, 1, 2].map((k) => Math.max(1, Math.ceil((mx[k] - mn[k]) / tam) + 1)) as [number, number, number];
    for (let t = 0; t < m.tri.length; t += 3) {
      const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
      for (let c = 0; c < 3; c++) for (let k = 0; k < 3; k++) { const v = p[3 * m.tri[t + c] + k]; lo[k] = Math.min(lo[k], v); hi[k] = Math.max(hi[k], v); }
      const a = lo.map((v, k) => Math.floor((v - mn[k]) / tam)), b = hi.map((v, k) => Math.floor((v - mn[k]) / tam));
      for (let x = a[0]; x <= b[0]; x++) for (let y = a[1]; y <= b[1]; y++) for (let z = a[2]; z <= b[2]; z++) {
        const k = (x * this.n[1] + y) * this.n[2] + z;
        let l = this.cel.get(k);
        if (!l) this.cel.set(k, (l = []));
        l.push(t);
      }
    }
  }

  private carimbo: Int32Array | null = null;
  private raio = 0;
  /** triângulo (índice em tri) do último acerto */
  tri = -1;

  /** Distância até o primeiro triângulo (diferente de `ignorar`) na direção d a partir de o (até `max`). */
  lancar(o: [number, number, number], d: [number, number, number], max: number, ignorar = -1): number {
    const p = this.m.pos, T = this.m.tri, tam = this.tam, n = this.n, mn = this.min;
    let melhor = Infinity;
    const carimbo = (this.carimbo ??= new Int32Array(T.length / 3).fill(-1)), id = ++this.raio;
    // percurso das células pelo raio (Amanatides–Woo)
    const c0 = Math.floor((o[0] - mn[0]) / tam), c1 = Math.floor((o[1] - mn[1]) / tam), c2 = Math.floor((o[2] - mn[2]) / tam);
    const c = [c0, c1, c2];
    const passo = [d[0] > 0 ? 1 : d[0] < 0 ? -1 : 0, d[1] > 0 ? 1 : d[1] < 0 ? -1 : 0, d[2] > 0 ? 1 : d[2] < 0 ? -1 : 0];
    const tMax = [0, 0, 0], tDelta = [0, 0, 0];
    for (let k = 0; k < 3; k++) {
      tMax[k] = d[k] === 0 ? Infinity : ((c[k] + (d[k] > 0 ? 1 : 0)) * tam + mn[k] - o[k]) / d[k];
      tDelta[k] = d[k] === 0 ? Infinity : tam / Math.abs(d[k]);
    }
    let tc = 0;
    for (let guarda = 0; guarda < 4000 && tc <= Math.min(max, melhor); guarda++) {
      if (c[0] >= 0 && c[1] >= 0 && c[2] >= 0 && c[0] < n[0] && c[1] < n[1] && c[2] < n[2]) {
        for (const t of this.cel.get((c[0] * n[1] + c[1]) * n[2] + c[2]) ?? []) {
          const ti = t / 3;
          if (t === ignorar || carimbo[ti] === id) continue;
          carimbo[ti] = id;
          const a = 3 * T[t], b = 3 * T[t + 1], cc = 3 * T[t + 2];
          // Möller–Trumbore
          const e1x = p[b] - p[a], e1y = p[b + 1] - p[a + 1], e1z = p[b + 2] - p[a + 2], e2x = p[cc] - p[a], e2y = p[cc + 1] - p[a + 1], e2z = p[cc + 2] - p[a + 2];
          const hx = d[1] * e2z - d[2] * e2y, hy = d[2] * e2x - d[0] * e2z, hz = d[0] * e2y - d[1] * e2x;
          const det = e1x * hx + e1y * hy + e1z * hz;
          if (Math.abs(det) < 1e-14) continue;
          const f = 1 / det, sx = o[0] - p[a], sy = o[1] - p[a + 1], sz = o[2] - p[a + 2];
          const u = f * (sx * hx + sy * hy + sz * hz);
          if (u < -1e-7 || u > 1 + 1e-7) continue;
          const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
          const v = f * (d[0] * qx + d[1] * qy + d[2] * qz);
          if (v < -1e-7 || u + v > 1 + 1e-7) continue;
          const dist = f * (e2x * qx + e2y * qy + e2z * qz);
          if (dist > 1e-6 && dist < melhor) { melhor = dist; this.tri = t; }
        }
      } else if (tc > 0) break;
      const k = tMax[0] < tMax[1] ? (tMax[0] < tMax[2] ? 0 : 2) : tMax[1] < tMax[2] ? 1 : 2;
      tc = tMax[k];
      tMax[k] += tDelta[k];
      c[k] += passo[k];
    }
    return melhor <= max ? melhor : Infinity;
  }
}

/**
 * Espessura (mm) nos vértices pedidos: raio a partir do vértice para dentro (contra a normal). Devolve a menor
 * e quantos ficaram abaixo de `minimo`.
 */
export function espessuras(m: Malha, vertices: number[], minimo: number): { menor: number; abaixo: number; valores: Float32Array } {
  const nv = m.pos.length / 3, p = m.pos, nrm = new Float32Array(3 * nv);
  for (let t = 0; t < m.tri.length; t += 3) {
    const a = 3 * m.tri[t], b = 3 * m.tri[t + 1], c = 3 * m.tri[t + 2];
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2], vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, L = Math.hypot(nx, ny, nz) || 1;
    for (const k of [a, b, c]) { nrm[k] += nx / L; nrm[k + 1] += ny / L; nrm[k + 2] += nz / L; }
  }
  const r = new Raios(m);
  const valores = new Float32Array(vertices.length);
  let menor = Infinity, abaixo = 0;
  vertices.forEach((v, i) => {
    const L = Math.hypot(nrm[3 * v], nrm[3 * v + 1], nrm[3 * v + 2]) || 1;
    const d: [number, number, number] = [-nrm[3 * v] / L, -nrm[3 * v + 1] / L, -nrm[3 * v + 2] / L];
    // sai um pouco para dentro (não acerta os próprios triângulos)
    const o: [number, number, number] = [p[3 * v] + d[0] * 1e-4, p[3 * v + 1] + d[1] * 1e-4, p[3 * v + 2] + d[2] * 1e-4];
    const e = r.lancar(o, d, 4) + 1e-4;
    valores[i] = e;
    if (e < menor) menor = e;
    if (e < minimo) abaixo++;
  });
  return { menor, abaixo, valores };
}

// ---------------------------------------------------------------------------------------------
// normais para a vista: triângulos soltos, normal média só entre faces com menos de `angulo` graus

export function malhaVista(m: Malha, angulo = 35): { pos: Float32Array; nor: Float32Array; idx: Uint32Array } {
  const p = m.pos, T = m.tri, nt = T.length / 3, nv = p.length / 3;
  const fn = new Float32Array(3 * nt);
  for (let t = 0; t < nt; t++) {
    const a = 3 * T[3 * t], b = 3 * T[3 * t + 1], c = 3 * T[3 * t + 2];
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2], vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
    fn[3 * t] = uy * vz - uz * vy; fn[3 * t + 1] = uz * vx - ux * vz; fn[3 * t + 2] = ux * vy - uy * vx;
  }
  // faces por vértice (CSR)
  const cont = new Uint32Array(nv + 1);
  for (let i = 0; i < T.length; i++) cont[T[i] + 1]++;
  for (let i = 0; i < nv; i++) cont[i + 1] += cont[i];
  const lista = new Uint32Array(T.length), cur = cont.slice(0, nv);
  for (let i = 0; i < T.length; i++) lista[cur[T[i]]++] = Math.floor(i / 3);
  const cosA = Math.cos((angulo * Math.PI) / 180);
  const pos = new Float32Array(9 * nt), nor = new Float32Array(9 * nt);
  for (let t = 0; t < nt; t++) {
    const L0 = Math.hypot(fn[3 * t], fn[3 * t + 1], fn[3 * t + 2]) || 1;
    for (let c = 0; c < 3; c++) {
      const v = T[3 * t + c];
      let nx = 0, ny = 0, nz = 0;
      for (let k = cont[v]; k < cont[v + 1]; k++) {
        const u = lista[k], L = Math.hypot(fn[3 * u], fn[3 * u + 1], fn[3 * u + 2]) || 1;
        if ((fn[3 * u] * fn[3 * t] + fn[3 * u + 1] * fn[3 * t + 1] + fn[3 * u + 2] * fn[3 * t + 2]) / (L * L0) < cosA) continue;
        nx += fn[3 * u]; ny += fn[3 * u + 1]; nz += fn[3 * u + 2];
      }
      const L = Math.hypot(nx, ny, nz) || 1, o = 9 * t + 3 * c;
      pos[o] = p[3 * v]; pos[o + 1] = p[3 * v + 1]; pos[o + 2] = p[3 * v + 2];
      nor[o] = nx / L; nor[o + 1] = ny / L; nor[o + 2] = nz / L;
    }
  }
  return { pos, nor, idx: Uint32Array.from({ length: 3 * nt }, (_, i) => i) };
}
