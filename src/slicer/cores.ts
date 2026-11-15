// WJSlicer3D: pintura de cores (até 4 por peça) e o que ela vira no fatiamento. Puro (sem DOM): roda na
// tela (pincel, balde, ângulo, corpo, borracha), no worker e em Node (scripts/teste-slicer.ts).
//
// Modelo: cada triângulo da malha tem uma cor (0–3 = filamento 1–4; 0 é a cor de fábrica da peça).
// Na camada, a cor de cada célula da seção é a do trecho de superfície pintada mais perto (região de
// Voronoi das paredes pintadas, como nos fatiadores de várias cores), e cada caminho é cortado onde a
// cor muda. Veja docs/global/wjslicer3d.md §5.

import { celula, type Grade } from "./campo";
import type { MalhaImpressao } from "./caminhos";
import type { IdMaterial } from "./perfis";

export const MAX_CORES = 4;

/** Filamento do projeto (cor, material e preço): preparado para a biblioteca de custos (S3). */
export interface Filamento {
  id: string;
  nome: string;
  /** cor de exibição, "#rrggbb" */
  cor: string;
  material: IdMaterial;
  /** R$/kg */
  precoKg: number;
}

export const filamentosPadrao = (material: IdMaterial = "pla", precoKg = 120): Filamento[] => [
  { id: "f1", nome: "Cinza", cor: "#8d99a6", material, precoKg },
  { id: "f2", nome: "Vermelho", cor: "#d93a2b", material, precoKg },
  { id: "f3", nome: "Azul", cor: "#2f6fd0", material, precoKg },
  { id: "f4", nome: "Amarelo", cor: "#e8b923", material, precoKg },
];

// ---------- topologia (vizinhança, normais, corpos) ----------

export interface Topologia {
  /** número de triângulos */
  n: number;
  /** vizinhos pelas três arestas (a→b, b→c, c→a); -1 = aresta livre */
  viz: Int32Array;
  /** normal unitária de cada triângulo */
  normal: Float32Array;
  /** centro de cada triângulo */
  centro: Float32Array;
  /** corpo de cada triângulo (componente ligado por arestas) */
  corpo: Int32Array;
  corpos: number;
}

export function topologia(m: MalhaImpressao): Topologia {
  const { pos, tri } = m;
  const n = tri.length / 3, nv = pos.length / 3;
  const viz = new Int32Array(n * 3).fill(-1);
  const normal = new Float32Array(n * 3), centro = new Float32Array(n * 3);
  const pai = Int32Array.from({ length: n }, (_, i) => i);
  const raiz = (x: number) => {
    while (pai[x] !== x) x = pai[x] = pai[pai[x]];
    return x;
  };
  const arestas = new Map<number, number>();
  for (let t = 0; t < n; t++) {
    const a = tri[t * 3], b = tri[t * 3 + 1], c = tri[t * 3 + 2];
    const ux = pos[b * 3] - pos[a * 3], uy = pos[b * 3 + 1] - pos[a * 3 + 1], uz = pos[b * 3 + 2] - pos[a * 3 + 2];
    const vx = pos[c * 3] - pos[a * 3], vy = pos[c * 3 + 1] - pos[a * 3 + 1], vz = pos[c * 3 + 2] - pos[a * 3 + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const L = Math.hypot(nx, ny, nz) || 1;
    normal.set([nx / L, ny / L, nz / L], t * 3);
    centro.set([(pos[a * 3] + pos[b * 3] + pos[c * 3]) / 3, (pos[a * 3 + 1] + pos[b * 3 + 1] + pos[c * 3 + 1]) / 3, (pos[a * 3 + 2] + pos[b * 3 + 2] + pos[c * 3 + 2]) / 3], t * 3);
    for (let e = 0; e < 3; e++) {
      const p = tri[t * 3 + e], q = tri[t * 3 + ((e + 1) % 3)];
      const chave = Math.min(p, q) * nv + Math.max(p, q);
      const o = arestas.get(chave);
      if (o === undefined) arestas.set(chave, t * 3 + e);
      else {
        const to = Math.floor(o / 3);
        if (viz[o] < 0) viz[o] = t;
        if (viz[t * 3 + e] < 0) viz[t * 3 + e] = to;
        const ra = raiz(t), rb = raiz(to);
        if (ra !== rb) pai[ra] = rb;
      }
    }
  }
  const corpo = new Int32Array(n);
  const ids = new Map<number, number>();
  for (let t = 0; t < n; t++) {
    const r = raiz(t);
    let id = ids.get(r);
    if (id === undefined) {
      id = ids.size;
      ids.set(r, id);
    }
    corpo[t] = id;
  }
  return { n, viz, normal, centro, corpo, corpos: ids.size };
}

// ---------- ferramentas de pintura (mudam `cores` no lugar e devolvem quantos triângulos mudaram) ----------

export function novasCores(n: number): Uint8Array {
  return new Uint8Array(n);
}

/** Pincel esférico: triângulos com o centro até `raio` mm do ponto e virados para o mesmo lado da superfície tocada. */
export function pincel(top: Topologia, cores: Uint8Array, p: [number, number, number], normal: [number, number, number] | null, raio: number, cor: number): number {
  let mudou = 0;
  const r2 = raio * raio;
  for (let t = 0; t < top.n; t++) {
    if (cores[t] === cor) continue;
    const dx = top.centro[t * 3] - p[0], dy = top.centro[t * 3 + 1] - p[1], dz = top.centro[t * 3 + 2] - p[2];
    if (dx * dx + dy * dy + dz * dz > r2) continue;
    if (normal && top.normal[t * 3] * normal[0] + top.normal[t * 3 + 1] * normal[1] + top.normal[t * 3 + 2] * normal[2] < 0.2) continue;
    cores[t] = cor;
    mudou++;
  }
  return mudou;
}

export type ModoBalde =
  /** só o que é plano como o triângulo tocado (até 1°) */
  | { tipo: "face" }
  /** tudo o que está ligado e tem a mesma cor, em qualquer ângulo */
  | { tipo: "regiao" }
  /** espalha enquanto o ângulo entre triângulos vizinhos não passa de `graus` (aresta viva para) */
  | { tipo: "angulo"; graus: number };

/** Balde: a partir do triângulo `t0`, pinta a região contínua da mesma cor que o modo permite. */
export function balde(top: Topologia, cores: Uint8Array, t0: number, cor: number, modo: ModoBalde): number {
  const base = cores[t0];
  if (base === cor) return 0;
  const cosFace = Math.cos((1 * Math.PI) / 180);
  const cosAng = modo.tipo === "angulo" ? Math.cos((modo.graus * Math.PI) / 180) : -2;
  const nz = top.normal;
  const pilha = [t0];
  cores[t0] = cor;
  let mudou = 1;
  while (pilha.length) {
    const t = pilha.pop()!;
    for (let e = 0; e < 3; e++) {
      const v = top.viz[t * 3 + e];
      if (v < 0 || cores[v] !== base) continue;
      const base0 = t0 * 3, atual = t * 3, vv = v * 3;
      if (modo.tipo === "face") {
        if (nz[base0] * nz[vv] + nz[base0 + 1] * nz[vv + 1] + nz[base0 + 2] * nz[vv + 2] < cosFace) continue;
      } else if (modo.tipo === "angulo") {
        if (nz[atual] * nz[vv] + nz[atual + 1] * nz[vv + 1] + nz[atual + 2] * nz[vv + 2] < cosAng) continue;
      }
      cores[v] = cor;
      mudou++;
      pilha.push(v);
    }
  }
  return mudou;
}

/** Corpo inteiro: todos os triângulos do corpo (componente ligado) do triângulo `t0`. */
export function pintarCorpo(top: Topologia, cores: Uint8Array, t0: number, cor: number): number {
  const c = top.corpo[t0];
  let mudou = 0;
  for (let t = 0; t < top.n; t++)
    if (top.corpo[t] === c && cores[t] !== cor) {
      cores[t] = cor;
      mudou++;
    }
  return mudou;
}

/** Quantos triângulos há de cada cor. */
export function contarCores(cores: Uint8Array): number[] {
  const r = new Array<number>(MAX_CORES).fill(0);
  for (let t = 0; t < cores.length; t++) r[cores[t]]++;
  return r;
}

// ---------- cor das células de uma camada ----------

/**
 * Cor de cada célula da grade: semeia as células dos segmentos de corte com a cor do triângulo de
 * origem e espalha para as vizinhas (duas varreduras de distância em chanfro, como o campo de
 * distância): cada célula fica com a cor do trecho pintado mais perto. 255 = sem semente.
 */
export function corDasCelulas(g: Grade, segs: Float64Array, corSeg: Uint8Array, planos?: Float64Array, rim = 0): Uint8Array {
  const { cols, lins, c } = g;
  const N = cols * lins;
  const cor = new Uint8Array(N).fill(255);
  const dist = new Float32Array(N).fill(1e9);
  const ns = corSeg.length;
  for (let s = 0; s < ns; s++) {
    const x1 = segs[s * 4], y1 = segs[s * 4 + 1], x2 = segs[s * 4 + 2], y2 = segs[s * 4 + 3];
    const L = Math.hypot(x2 - x1, y2 - y1), passos = Math.max(1, Math.ceil(L / (c * 0.5)));
    for (let k = 0; k <= passos; k++) {
      const q = celula(g, x1 + ((x2 - x1) * k) / passos, y1 + ((y2 - y1) * k) / passos);
      if (q >= 0) {
        cor[q] = corSeg[s];
        dist[q] = 0;
      }
    }
  }
  const D = Math.SQRT2;
  const relaxa = (q: number, o: number, w: number) => {
    const d = dist[o] + w;
    if (d < dist[q]) {
      dist[q] = d;
      cor[q] = cor[o];
    }
  };
  for (let j = 0; j < lins; j++)
    for (let i = 0; i < cols; i++) {
      const q = j * cols + i;
      if (i > 0) relaxa(q, q - 1, 1);
      if (j > 0) {
        relaxa(q, q - cols, 1);
        if (i > 0) relaxa(q, q - cols - 1, D);
        if (i < cols - 1) relaxa(q, q - cols + 1, D);
      }
    }
  for (let j = lins - 1; j >= 0; j--)
    for (let i = cols - 1; i >= 0; i--) {
      const q = j * cols + i;
      if (i < cols - 1) relaxa(q, q + 1, 1);
      if (j < lins - 1) {
        relaxa(q, q + cols, 1);
        if (i < cols - 1) relaxa(q, q + cols + 1, D);
        if (i > 0) relaxa(q, q + cols - 1, D);
      }
    }
  // faces horizontais pintadas: a cor vale no miolo (além de `rim` mm da parede); a borda segue as laterais
  if (planos)
    for (let k = 0; k + 6 < planos.length; k += 7) {
      const ax = planos[k], ay = planos[k + 1], bx = planos[k + 2], by = planos[k + 3], cx = planos[k + 4], cy = planos[k + 5], corP = planos[k + 6];
      const i0 = Math.max(0, Math.floor((Math.min(ax, bx, cx) - g.x0) / c)), i1 = Math.min(cols - 1, Math.floor((Math.max(ax, bx, cx) - g.x0) / c));
      const j0 = Math.max(0, Math.floor((Math.min(ay, by, cy) - g.y0) / c)), j1 = Math.min(lins - 1, Math.floor((Math.max(ay, by, cy) - g.y0) / c));
      const den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
      if (Math.abs(den) < 1e-12) continue;
      for (let j = j0; j <= j1; j++)
        for (let i = i0; i <= i1; i++) {
          const x = g.x0 + (i + 0.5) * c, y = g.y0 + (j + 0.5) * c;
          const l1 = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / den, l2 = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / den;
          if (l1 < 0 || l2 < 0 || 1 - l1 - l2 < 0) continue;
          const q = j * cols + i;
          if (dist[q] * c > rim) cor[q] = corP;
        }
    }
  return cor;
}

/** Cores (semente) de uma lista de triângulos horizontais. */
export function coresDosPlanos(planos?: Float64Array): number[] {
  const r = new Set<number>();
  if (planos) for (let k = 6; k < planos.length; k += 7) r.add(planos[k]);
  return [...r];
}

/** Caminho (polilinha) e o que o corte por cor precisa dele. */
interface CaminhoCortavel {
  pts: Float64Array;
  fechado: boolean;
  vSeg?: Float32Array;
}

/**
 * Corta o caminho onde a cor da célula muda. Devolve os pedaços com a cor de cada um (o caminho
 * inteiro, sem cópia, se tiver uma cor só). `passo`: distância entre as amostras (mm).
 */
export function cortarPorCor<T extends CaminhoCortavel>(t: T, g: Grade, mapa: Uint8Array, padrao: number, passo: number): { t: T; cor: number }[] {
  const p = t.pts, np = p.length / 2, ne = t.fechado ? np : np - 1;
  const ax: number[] = [], ay: number[] = [], bx: number[] = [], by: number[] = [], cs: number[] = [], vs: number[] = [];
  const corEm = (x: number, y: number) => {
    const q = celula(g, x, y);
    const v = q >= 0 ? mapa[q] : 255;
    return v === 255 ? padrao : v;
  };
  for (let e = 0; e < ne; e++) {
    const x1 = p[e * 2], y1 = p[e * 2 + 1], x2 = p[((e + 1) % np) * 2], y2 = p[((e + 1) % np) * 2 + 1];
    const L = Math.hypot(x2 - x1, y2 - y1), n = Math.max(1, Math.ceil(L / passo));
    const v = t.vSeg ? t.vSeg[e] : 0;
    let ini = 0, corIni = corEm(x1 + ((x2 - x1) * 0.5) / n, y1 + ((y2 - y1) * 0.5) / n);
    for (let s = 1; s <= n; s++) {
      const cs1 = s < n ? corEm(x1 + ((x2 - x1) * (s + 0.5)) / n, y1 + ((y2 - y1) * (s + 0.5)) / n) : -1;
      if (s === n || cs1 !== corIni) {
        const f0 = ini / n, f1 = s / n;
        ax.push(x1 + (x2 - x1) * f0);
        ay.push(y1 + (y2 - y1) * f0);
        bx.push(x1 + (x2 - x1) * f1);
        by.push(y1 + (y2 - y1) * f1);
        cs.push(corIni);
        vs.push(v);
        ini = s;
        corIni = cs1;
      }
    }
  }
  const m = cs.length;
  if (!m) return [{ t, cor: padrao }];
  if (cs.every((c) => c === cs[0])) return [{ t, cor: cs[0] }];
  // início da volta numa mudança de cor (laço) e corte em corridas de mesma cor
  let k0 = 0;
  if (t.fechado) {
    for (let k = 0; k < m; k++)
      if (cs[k] !== cs[(k - 1 + m) % m]) {
        k0 = k;
        break;
      }
  }
  const saida: { t: T; cor: number }[] = [];
  let k = 0;
  while (k < m) {
    const a = (k0 + k) % m, cor = cs[a];
    const xs: number[] = [ax[a], ay[a]], vv: number[] = [];
    let j = k;
    while (j < m && cs[(k0 + j) % m] === cor) {
      const i = (k0 + j) % m;
      xs.push(bx[i], by[i]);
      vv.push(vs[i]);
      j++;
    }
    saida.push({ t: { ...t, pts: Float64Array.from(xs), fechado: false, vSeg: t.vSeg ? Float32Array.from(vv) : undefined }, cor });
    k = j;
  }
  return saida;
}
