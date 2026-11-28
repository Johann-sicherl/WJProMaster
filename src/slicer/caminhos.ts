// WJSlicer3D: caminho da ferramenta de cada camada de uma peça (código próprio, sem G-code).
// 1. Corte da malha em camadas (segmentos no plano do meio de cada camada) e mapa dentro/fora.
// 2. Por camada: campo de distância → paredes (curvas de nível para dentro: externa e internas),
//    região do preenchimento (com a sobreposição nas paredes) e classes por célula pelas camadas
//    vizinhas: fundo/topo sólidos (N camadas), superfície de topo, ponte (sólido sobre o vazio),
//    esparso (área pequena vira sólido).
// 3. Linhas de preenchimento de cada padrão recortadas pela região e ligadas junto às paredes
//    (âncoras) quando dá; o resto vira deslocamento.
// 4. Suporte normal (colunas pelo ângulo-limite, folgas em Z e XY, interface densa) e em árvore
//    (galhos que descem dos pontos de contato, se juntam e desviam da peça), borda (aba).
// Puro: testado em scripts/teste-slicer.ts.

import {
  amostrar, campoDistancia, campoDoMapa, celula, compactar, comprimento, contornos, expandir, rasterizar, recortar, rotular, type Grade,
} from "./campo";
import { desviar, escolherCostura, girar, pontaFinal, pontaInicial, recuar, sorteio, transformarLaco, areaLaco } from "./costura";
import { GeradorM1, type ParedeGerada } from "./paredes";
import type { Parte } from "./planejador";
import type { Maquina, Padrao, Processo, TipoSuporte } from "./perfis";

/** Malha já na posição de impressão (Z para cima): 3 números por vértice, 3 índices por triângulo. */
export interface MalhaImpressao {
  pos: Float32Array;
  tri: Uint32Array;
}

export interface Ajustes {
  altura: number;
  paredes: number;
  topo: number;
  fundo: number;
  /** 0–1 */
  preenchimento: number;
  padrao: Padrao;
  suporte: TipoSuporte;
  borda: boolean;
  saia: boolean;
}

export const ajustesPadrao = (p: Processo): Ajustes => ({
  altura: p.altura, paredes: p.paredes, topo: p.topo, fundo: p.fundo, preenchimento: p.preenchimento, padrao: p.padrao,
  suporte: "nenhum", borda: false, saia: false,
});

/** Distância entre centros de linhas vizinhas: o filete tem as pontas arredondadas. */
export const espacamento = (w: number, h: number) => w - h * (1 - Math.PI / 4);

/** Um caminho de extrusão: polilinha (fechada nos laços), parte, largura, fluxo e movimento. */
export interface Trecho {
  pts: Float64Array;
  fechado: boolean;
  parte: Parte;
  w: number;
  fluxo: number;
  v: number;
  a: number;
  j: number;
  /** limite de velocidade de cada segmento (parede em balanço) */
  vSeg?: Float32Array;
  /** deslocamento até este trecho fica dentro do preenchimento (não retrai) */
  semRetrair?: boolean;
  /** M2: laço com a costura já escolhida (começa em pts[0]; sem isso, no ponto mais perto do bico) */
  costura?: boolean;
  /** M2: depois do trecho, entra na peça (mm, à esquerda do sentido de impressão) sem extrudar */
  limpar?: number;
  /** M2: chega ao início por dentro da peça (mm), sem extrudar */
  limparAntes?: number;
  /** M2: pontos do deslocamento até este trecho que desviam das paredes (vale só saindo de `viaDe`) */
  via?: Float64Array;
  viaDe?: [number, number];
}

/** Alturas das camadas: topo de cada camada (mm). */
export function alturasCamadas(H: number, h1: number, h: number): number[] {
  const n = H <= h1 + 1e-6 ? 1 : 1 + Math.ceil((H - h1) / h - 1e-6);
  return Array.from({ length: n }, (_, i) => (i === 0 ? h1 : h1 + i * h));
}

/** Caixa da malha. */
export function caixa(pos: Float32Array): { min: [number, number, number]; max: [number, number, number] } {
  const min: [number, number, number] = [Infinity, Infinity, Infinity], max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i += 3)
    for (let k = 0; k < 3; k++) {
      const x = pos[i + k];
      if (x < min[k]) min[k] = x;
      if (x > max[k]) max[k] = x;
    }
  return { min, max };
}

/** Volume pela divergência; null se alguma aresta não tiver exatamente dois triângulos. */
export function volumeMalha(m: MalhaImpressao): number | null {
  const { pos: p, tri } = m;
  const nv = p.length / 3;
  const arestas = new Map<number, number>();
  let v = 0;
  for (let t = 0; t < tri.length; t += 3) {
    const a = tri[t], b = tri[t + 1], c = tri[t + 2];
    if (a === b || b === c || a === c) continue;
    const ax = p[a * 3], ay = p[a * 3 + 1], az = p[a * 3 + 2];
    const bx = p[b * 3], by = p[b * 3 + 1], bz = p[b * 3 + 2];
    const cx = p[c * 3], cy = p[c * 3 + 1], cz = p[c * 3 + 2];
    v += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
    for (const [i, j] of [[a, b], [b, c], [c, a]]) {
      const k = i < j ? i * nv + j : j * nv + i;
      arestas.set(k, (arestas.get(k) ?? 0) + 1);
    }
  }
  for (const n of arestas.values()) if (n !== 2) return null;
  return Math.abs(v);
}

/** Corte de uma peça: segmentos e mapa (em bits) de cada camada, na grade da peça. */
export interface Fatias {
  g: Grade;
  n: number;
  segs: Float64Array[];
  bits: Uint32Array[];
  areas: number[];
  /** cor (0–3) de cada segmento de `segs`, quando a peça foi pintada */
  corSeg?: Uint8Array[];
  /**
   * Faces quase horizontais (topo e fundo) pintadas ou não: triângulos (ax, ay, bx, by, cx, cy, cor) que
   * valem para as camadas logo abaixo (topo) ou logo acima (fundo) delas, onde o corte não as encontra
   */
  corPlano?: Float64Array[];
}

/** limite de células da grade e de memória dos mapas de todas as camadas (bytes) */
const MAX_CELULAS = 200_000, MAX_MAPAS = 48e6, CELULA_MIN = 0.15;

/**
 * Corta a malha nos planos do meio de cada camada (`zs` = topo das camadas, base em z = 0).
 * `margem`: folga em volta da peça na grade (borda/aba).
 */
export function fatiarMalha(m: MalhaImpressao, zs: number[], margem: number, progresso?: (f: number) => void, cores?: Uint8Array, prof?: [number, number]): Fatias {
  const { pos, tri } = m;
  const nt = tri.length / 3;
  const { min, max } = caixa(pos);
  const n = zs.filter((z, i) => (i === 0 ? 0 : zs[i - 1]) < max[2] - 1e-6).length;
  const L = max[0] - min[0] + 2 * margem, P = max[1] - min[1] + 2 * margem;
  const c = Math.max(CELULA_MIN, Math.sqrt((L * P) / MAX_CELULAS), Math.sqrt((L * P * n) / (8 * MAX_MAPAS)));
  const cols = Math.ceil(L / c) + 2, lins = Math.ceil(P / c) + 2;
  const g: Grade = { x0: min[0] - margem - c, y0: min[1] - margem - c, c, cols, lins };
  const zmin = new Float32Array(nt), zmax = new Float32Array(nt);
  for (let t = 0; t < nt; t++) {
    const a = pos[tri[t * 3] * 3 + 2], b = pos[tri[t * 3 + 1] * 3 + 2], cc = pos[tri[t * 3 + 2] * 3 + 2];
    zmin[t] = Math.min(a, b, cc);
    zmax[t] = Math.max(a, b, cc);
  }
  let corPlano: Float64Array[] | undefined;
  if (cores && prof) {
    // faces horizontais: sem segmento no corte, a cor vale para as camadas de topo (abaixo) e de fundo (acima)
    const mid = Float64Array.from({ length: n }, (_, i) => ((i === 0 ? 0 : zs[i - 1]) + zs[i]) / 2);
    const lb = (x: number) => {
      let lo = 0, hi = n;
      while (lo < hi) {
        const m = (lo + hi) >> 1;
        if (mid[m] < x) lo = m + 1;
        else hi = m;
      }
      return lo;
    };
    const lis: number[][] = Array.from({ length: n }, () => []);
    for (let t = 0; t < nt; t++) {
      if (zmax[t] - zmin[t] >= zs[0]) continue;
      const a = tri[t * 3] * 3, b = tri[t * 3 + 1] * 3, c = tri[t * 3 + 2] * 3;
      const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
      const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const L = Math.hypot(nx, ny, nz);
      if (L < 1e-12 || Math.abs(nz) / L < 0.7) continue;
      const topo = nz > 0, zt = (zmin[t] + zmax[t]) / 2, d = topo ? prof[0] : prof[1];
      if (d <= 0) continue;
      const i0 = topo ? lb(zt - d) : lb(zt), i1 = topo ? lb(zt) : lb(zt + d);
      for (let i = i0; i < i1 && i < n; i++) lis[i].push(pos[a], pos[a + 1], pos[b], pos[b + 1], pos[c], pos[c + 1], cores[t]);
    }
    corPlano = lis.map((l) => Float64Array.from(l));
  }
  const ordem = Uint32Array.from({ length: nt }, (_, i) => i).sort((a, b) => zmin[a] - zmin[b]);
  let proximo = 0;
  let ativos: number[] = [];
  const segs: Float64Array[] = [], bits: Uint32Array[] = [], areas: number[] = [], corSeg: Uint8Array[] = [];
  const bufCor: number[] = [];
  const dentro = new Uint8Array(cols * lins);
  const buf: number[] = [];
  for (let i = 0; i < n; i++) {
    const z = ((i === 0 ? 0 : zs[i - 1]) + zs[i]) / 2;
    while (proximo < nt && zmin[ordem[proximo]] <= z) ativos.push(ordem[proximo++]);
    ativos = ativos.filter((t) => zmax[t] > z);
    buf.length = 0;
    bufCor.length = 0;
    for (const t of ativos) {
      const ia = tri[t * 3], ib = tri[t * 3 + 1], ic = tri[t * 3 + 2];
      if (ia === ib || ib === ic || ia === ic) continue;
      const za = pos[ia * 3 + 2], zb = pos[ib * 3 + 2], zc = pos[ic * 3 + 2];
      const sa = za > z, sb = zb > z, sc = zc > z;
      if (sa === sb && sb === sc) continue;
      let achados = 0;
      const corta = (u: number, w: number, zu: number, zw: number) => {
        const f = (z - zu) / (zw - zu);
        buf.push(pos[u * 3] + (pos[w * 3] - pos[u * 3]) * f, pos[u * 3 + 1] + (pos[w * 3 + 1] - pos[u * 3 + 1]) * f);
        achados++;
      };
      if (sa !== sb) corta(ia, ib, za, zb);
      if (sb !== sc) corta(ib, ic, zb, zc);
      if (sc !== sa) corta(ic, ia, zc, za);
      if (achados !== 2) buf.length -= achados * 2;
      else if (cores) bufCor.push(cores[t]);
    }
    const s = Float64Array.from(buf);
    segs.push(s);
    if (cores) corSeg.push(Uint8Array.from(bufCor));
    rasterizar(s, s.length / 4, g, dentro);
    let conta = 0;
    for (let q = 0; q < dentro.length; q++) conta += dentro[q];
    areas.push(conta * c * c);
    bits.push(compactar(dentro));
    if (progresso && i % 16 === 0) progresso(i / n);
  }
  return { g, n, segs, bits, areas, corSeg: cores ? corSeg : undefined, corPlano };
}

// ---------- mapas de células ----------

/** Alarga o mapa `r` células (quadrado), em duas passadas de janela deslizante. */
export function dilatar(m: Uint8Array, g: Grade, r: number, saida: Uint8Array, aux: Uint8Array) {
  const { cols, lins } = g;
  if (r <= 0) {
    saida.set(m);
    return;
  }
  for (let j = 0; j < lins; j++) {
    const o = j * cols;
    let conta = 0;
    for (let i = 0; i < Math.min(r, cols); i++) conta += m[o + i];
    for (let i = 0; i < cols; i++) {
      if (i + r < cols) conta += m[o + i + r];
      if (i - r - 1 >= 0) conta -= m[o + i - r - 1];
      aux[o + i] = conta > 0 ? 1 : 0;
    }
  }
  for (let i = 0; i < cols; i++) {
    let conta = 0;
    for (let j = 0; j < Math.min(r, lins); j++) conta += aux[j * cols + i];
    for (let j = 0; j < lins; j++) {
      if (j + r < lins) conta += aux[(j + r) * cols + i];
      if (j - r - 1 >= 0) conta -= aux[(j - r - 1) * cols + i];
      saida[j * cols + i] = conta > 0 ? 1 : 0;
    }
  }
}

/** Mapas de suporte por camada (bits): corpo e interface. */
export interface Suportes {
  corpo: (Uint32Array | null)[];
  interface: (Uint32Array | null)[];
  /** galhos da árvore por camada: x, y, raio */
  galhos: (Float32Array | null)[];
}

const CLASSE = { esparso: 1, solido: 2, topo: 3, ponte: 4 } as const;

/**
 * Suporte da peça (de cima para baixo): o que a camada k tem além da camada de baixo alargada pelo
 * ângulo-limite precisa de apoio; a coluna desce (com folga em Z de `distZ` e em XY de `distXY`) até a
 * mesa ou até encontrar a peça. Interface densa nas camadas logo abaixo do contato. Árvore: galhos
 * que nascem nos contatos, descem desviando da peça e se juntam.
 */
export function calcularSuportes(f: Fatias, pr: Processo, tipo: Exclude<TipoSuporte, "nenhum">, h: number, progresso?: (x: number) => void): Suportes {
  const { g, n } = f;
  const N = g.cols * g.lins;
  const corpo: (Uint32Array | null)[] = new Array(n).fill(null), inter: (Uint32Array | null)[] = new Array(n).fill(null), galhos: (Float32Array | null)[] = new Array(n).fill(null);
  if (n < 3) return { corpo, interface: inter, galhos };
  const rAng = Math.max(0, Math.round(h / Math.tan((pr.anguloSuporte * Math.PI) / 180) / g.c));
  const rXY = Math.max(1, Math.round(pr.suporteDistXY / g.c));
  const folga = Math.max(0, Math.round(pr.suporteDistZ / h));
  const A = new Uint8Array(N), B = new Uint8Array(N), D = new Uint8Array(N), aux = new Uint8Array(N), O = new Uint8Array(N), S = new Uint8Array(N), bloq = new Uint8Array(N);
  const hist: Uint8Array[] = [];
  /** o que a camada k tem sem apoio na camada k−1 */
  const balanco = (k: number, saida: Uint8Array) => {
    saida.fill(0);
    if (k < 1 || k >= n) return false;
    expandir(f.bits[k], N, A);
    expandir(f.bits[k - 1], N, B);
    dilatar(B, g, rAng, D, aux);
    let algum = false;
    for (let q = 0; q < N; q++)
      if (A[q] && !D[q]) {
        saida[q] = 1;
        algum = true;
      }
    return algum;
  };
  // árvore
  let nos: { x: number; y: number; r: number }[] = [];
  const passoGalho = h * Math.tan((pr.arvore.angulo * Math.PI) / 180);
  const crescer = h * Math.tan((pr.arvore.anguloDiametro * Math.PI) / 180);
  const rPonta = pr.arvore.ponta / 2, rGalho = pr.arvore.diametro / 2;
  const colide = (x: number, y: number, r: number, mapa: Uint8Array): [number, number] | null => {
    const rr = r + pr.suporteDistXY;
    const i0 = Math.max(0, Math.floor((x - rr - g.x0) / g.c)), i1 = Math.min(g.cols - 1, Math.floor((x + rr - g.x0) / g.c));
    const j0 = Math.max(0, Math.floor((y - rr - g.y0) / g.c)), j1 = Math.min(g.lins - 1, Math.floor((y + rr - g.y0) / g.c));
    let sx = 0, sy = 0, k = 0;
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        if (!mapa[j * g.cols + i]) continue;
        const cx = g.x0 + (i + 0.5) * g.c, cy = g.y0 + (j + 0.5) * g.c;
        if ((cx - x) ** 2 + (cy - y) ** 2 <= rr * rr) {
          sx += cx;
          sy += cy;
          k++;
        }
      }
    return k ? [sx / k, sy / k] : null;
  };

  for (let j = n - 2; j >= 0; j--) {
    const k = j + 1 + folga;
    const tem = balanco(k, O);
    hist.unshift(O.slice());
    if (hist.length > Math.max(1, pr.interfaceTopo)) hist.pop();
    expandir(f.bits[j], N, A);
    dilatar(A, g, rXY, bloq, aux);
    if (tipo === "normal") {
      let algum = false;
      for (let q = 0; q < N; q++) {
        S[q] = (S[q] | O[q]) & (bloq[q] ^ 1);
        if (S[q]) algum = true;
      }
      if (algum) corpo[j] = compactar(S);
    } else {
      // galhos novos: um por bloco de `distancia` mm com balanço (no centro das células do bloco)
      if (tem) {
        const passo = Math.max(1, Math.round(pr.arvore.distancia / g.c));
        for (let bj = 0; bj < g.lins; bj += passo)
          for (let bi = 0; bi < g.cols; bi += passo) {
            let sx = 0, sy = 0, c2 = 0;
            for (let jj = bj; jj < Math.min(g.lins, bj + passo); jj++)
              for (let ii = bi; ii < Math.min(g.cols, bi + passo); ii++)
                if (O[jj * g.cols + ii]) {
                  sx += ii;
                  sy += jj;
                  c2++;
                }
            if (c2) nos.push({ x: g.x0 + (sx / c2 + 0.5) * g.c, y: g.y0 + (sy / c2 + 0.5) * g.c, r: rPonta });
          }
      }
      // descer: aproxima do vizinho mais perto (para juntar), desvia da peça, engrossa
      const novos: typeof nos = [];
      for (const no of nos) {
        let alvo: (typeof nos)[number] | null = null, dmin = 3 * pr.arvore.distancia;
        for (const o of nos) {
          if (o === no) continue;
          const d = Math.hypot(o.x - no.x, o.y - no.y);
          if (d < dmin) {
            dmin = d;
            alvo = o;
          }
        }
        let x = no.x, y = no.y;
        if (alvo && dmin > 1e-6) {
          const s = Math.min(passoGalho, dmin / 2);
          x += ((alvo.x - x) / dmin) * s;
          y += ((alvo.y - y) / dmin) * s;
        }
        const r = Math.min(Math.max(no.r + crescer, Math.min(rGalho, no.r + (rGalho - rPonta) / 5)), 10);
        let bate = colide(x, y, r, A);
        if (bate) {
          // empurra para longe da peça
          let dx = x - bate[0], dy = y - bate[1];
          const d = Math.hypot(dx, dy) || 1;
          dx /= d;
          dy /= d;
          x = no.x + dx * passoGalho * 2;
          y = no.y + dy * passoGalho * 2;
          bate = colide(x, y, r, A);
        }
        if (bate) continue; // apoia na peça e termina
        novos.push({ x, y, r });
      }
      // juntar galhos que se encostam
      nos = [];
      for (const no of novos) {
        const perto = nos.find((o) => Math.hypot(o.x - no.x, o.y - no.y) < 0.5 * Math.max(o.r, no.r));
        if (perto) {
          perto.x = (perto.x + no.x) / 2;
          perto.y = (perto.y + no.y) / 2;
          perto.r = Math.max(perto.r, no.r);
        } else nos.push(no);
      }
      if (nos.length) galhos[j] = Float32Array.from(nos.flatMap((o) => [o.x, o.y, o.r]));
      // interface: as camadas logo abaixo do contato
      S.fill(0);
    }
    // interface (os dois tipos): região de contato das últimas `interfaceTopo` camadas
    let algumI = false;
    D.fill(0);
    for (const hh of hist) for (let q = 0; q < N; q++) if (hh[q]) D[q] = 1;
    for (let q = 0; q < N; q++) {
      const v = D[q] & (bloq[q] ^ 1) & (tipo === "normal" ? S[q] : 1);
      D[q] = v;
      if (v) algumI = true;
    }
    if (algumI) inter[j] = compactar(D);
    if (progresso && j % 16 === 0) progresso((n - j) / n);
  }
  // só na mesa: colunas que encostam na peça saem inteiras (de baixo para cima)
  if (pr.soNaMesa && tipo === "normal") {
    let G: Uint8Array | null = null;
    for (let j = 0; j < n; j++) {
      if (!corpo[j]) {
        G = new Uint8Array(N);
        continue;
      }
      expandir(corpo[j]!, N, A);
      if (G) for (let q = 0; q < N; q++) A[q] &= G[q];
      G = A.slice();
      corpo[j] = G.some((x) => x) ? compactar(G) : null;
      if (inter[j]) {
        expandir(inter[j]!, N, B);
        for (let q = 0; q < N; q++) B[q] &= G[q];
        inter[j] = B.some((x) => x) ? compactar(B) : null;
      }
    }
  }
  return { corpo, interface: inter, galhos };
}

// ---------- preenchimentos ----------

/** Linhas paralelas de direção `ang` (rad), passo `S` e fase `fase`, cobrindo a caixa. */
function familia(ang: number, S: number, fase: number, cx0: number, cy0: number, cx1: number, cy1: number, saida: number[][]) {
  const dx = Math.cos(ang), dy = Math.sin(ang), nx = -dy, ny = dx;
  const cantos = [[cx0, cy0], [cx1, cy0], [cx0, cy1], [cx1, cy1]];
  let n0 = Infinity, n1 = -Infinity, t0 = Infinity, t1 = -Infinity;
  for (const [x, y] of cantos) {
    const pn = x * nx + y * ny, pt = x * dx + y * dy;
    n0 = Math.min(n0, pn);
    n1 = Math.max(n1, pn);
    t0 = Math.min(t0, pt);
    t1 = Math.max(t1, pt);
  }
  const k0 = Math.ceil((n0 - fase) / S), k1 = Math.floor((n1 - fase) / S);
  for (let k = k0; k <= k1; k++) {
    const o = k * S + fase;
    saida.push([nx * o + dx * (t0 - 1), ny * o + dy * (t0 - 1), nx * o + dx * (t1 + 1), ny * o + dy * (t1 + 1)]);
  }
}

/** Comprimento de linha por área do giroide (período 2π) no plano: medido uma vez. */
let linhaPorAreaGiroide = 0;
function medirGiroide(): number {
  if (linhaPorAreaGiroide) return linhaPorAreaGiroide;
  const nG = 160, lado = 4 * Math.PI, c = lado / nG;
  const g: Grade = { x0: 0, y0: 0, c, cols: nG, lins: nG };
  let soma = 0;
  const zsAmostra = 8;
  for (let a = 0; a < zsAmostra; a++) {
    const z = (a / zsAmostra) * 2 * Math.PI;
    const f = new Float32Array(nG * nG);
    for (let j = 0; j < nG; j++)
      for (let i = 0; i < nG; i++) {
        const x = (i + 0.5) * c, y = (j + 0.5) * c;
        f[j * nG + i] = Math.sin(x) * Math.cos(y) + Math.sin(y) * Math.cos(z) + Math.sin(z) * Math.cos(x);
      }
    for (const p of contornos(f, g, 0, 1e-4, true)) soma += comprimento(p.pts, p.fechado);
  }
  linhaPorAreaGiroide = soma / zsAmostra / ((nG - 1) * c) ** 2;
  return linhaPorAreaGiroide;
}

/** Curvas do padrão esparso da camada (antes do recorte), em coordenadas da peça. */
function curvasEsparso(padrao: Padrao, rho: number, s: number, i: number, z: number, h: number, g: Grade, cx: [number, number, number, number], saida: number[][]) {
  const [x0, y0, x1, y1] = cx;
  const q = Math.PI / 4;
  switch (padrao) {
    case "linhas":
      familia(i % 2 ? 3 * q : q, s / rho, 0, x0, y0, x1, y1, saida);
      break;
    case "cruzado": {
      const S = s / rho, bloco = Math.max(1, Math.round(S / h));
      familia(Math.floor(i / bloco) % 2 ? 3 * q : q, S, 0, x0, y0, x1, y1, saida);
      break;
    }
    case "grade":
      familia(q, (2 * s) / rho, 0, x0, y0, x1, y1, saida);
      familia(3 * q, (2 * s) / rho, 0, x0, y0, x1, y1, saida);
      break;
    case "triangulos":
    case "cubico": {
      const S = (3 * s) / rho;
      for (let k = 0; k < 3; k++) {
        const fase = padrao === "cubico" ? (k === 1 ? -1 : 1) * z * Math.SQRT1_2 : 0;
        familia(q + (k * Math.PI) / 3, S, ((fase % S) + S) % S, x0, y0, x1, y1, saida);
      }
      break;
    }
    case "favo": {
      const a = (8 * s) / (3 * Math.sqrt(3) * rho), hh = (a * Math.sqrt(3)) / 2;
      const k0 = Math.floor(y0 / hh) - 1, k1 = Math.ceil(y1 / hh) + 1;
      for (let k = k0; k <= k1; k++) {
        const yb = k * hh, ox = (k & 1 ? 1.5 * a : 0);
        const m0 = Math.floor((x0 - ox) / (3 * a)) - 1, m1 = Math.ceil((x1 - ox) / (3 * a)) + 1;
        const p: number[] = [];
        for (let m = m0; m <= m1; m++) {
          const b = ox + 3 * a * m;
          p.push(b, yb, b + a / 2, yb + hh, b + 1.5 * a, yb + hh, b + 2 * a, yb);
        }
        saida.push(p);
      }
      break;
    }
    case "giroide": {
      const kk = rho / (s * medirGiroide());
      const f = new Float32Array(g.cols * g.lins);
      const sx = new Float32Array(g.cols), cxx = new Float32Array(g.cols);
      for (let ii = 0; ii < g.cols; ii++) {
        const x = (g.x0 + (ii + 0.5) * g.c) * kk;
        sx[ii] = Math.sin(x);
        cxx[ii] = Math.cos(x);
      }
      const sz = Math.sin(z * kk), cz = Math.cos(z * kk);
      for (let jj = 0; jj < g.lins; jj++) {
        const y = (g.y0 + (jj + 0.5) * g.c) * kk, sy = Math.sin(y), cy = Math.cos(y);
        for (let ii = 0; ii < g.cols; ii++) f[jj * g.cols + ii] = sx[ii] * cy + sy * cz + sz * cxx[ii];
      }
      for (const p of contornos(f, g, 0, 0.0125, true)) {
        const arr = Array.from(p.pts);
        if (p.fechado) arr.push(arr[0], arr[1]);
        saida.push(arr);
      }
      break;
    }
  }
}

/**
 * Ordena e liga trechos abertos (linhas de preenchimento): a partir de (x, y), escolhe sempre a
 * ponta mais perto; liga com uma linha curta junto à parede quando dá (âncora), senão começa trecho novo.
 */
function ligar(
  linhas: number[][], x: number, y: number, maxLiga: number, f: Float32Array, g: Grade, nivel: number, w: number, base: Omit<Trecho, "pts" | "fechado">, saida: Trecho[],
): [number, number] {
  const usado = new Uint8Array(linhas.length);
  let restam = linhas.length;
  let atual: number[] | null = null;
  const fechar = () => {
    if (atual && atual.length >= 4) saida.push({ ...base, pts: Float64Array.from(atual), fechado: false, semRetrair: true });
    atual = null;
  };
  while (restam) {
    let melhor = -1, inv = false, dmin = Infinity;
    for (let k = 0; k < linhas.length; k++) {
      if (usado[k]) continue;
      const l = linhas[k], m = l.length;
      const d0 = (l[0] - x) ** 2 + (l[1] - y) ** 2, d1 = (l[m - 2] - x) ** 2 + (l[m - 1] - y) ** 2;
      if (d0 < dmin) {
        dmin = d0;
        melhor = k;
        inv = false;
      }
      if (d1 < dmin) {
        dmin = d1;
        melhor = k;
        inv = true;
      }
    }
    usado[melhor] = 1;
    restam--;
    let l = linhas[melhor];
    if (inv) {
      const r: number[] = [];
      for (let k = l.length - 2; k >= 0; k -= 2) r.push(l[k], l[k + 1]);
      l = r;
    }
    const d = Math.sqrt(dmin);
    let liga = false;
    if (atual && d <= maxLiga) {
      const fm = amostrar(f, g, (x + l[0]) / 2, (y + l[1]) / 2) - nivel;
      liga = fm >= -w && fm <= Math.max(w, 0.25 * d);
    }
    if (!liga) {
      fechar();
      atual = [...l];
    } else atual!.push(...l);
    x = l[l.length - 2];
    y = l[l.length - 1];
  }
  fechar();
  return [x, y];
}

/** Uma camada de uma peça: trechos em ordem de impressão (ilha por ilha) e o suporte. */
export interface CamadaPeca {
  trechos: Trecho[];
  /** ponto de partida típico (para ordenar as peças na mesa) */
  inicio: [number, number];
}

export interface Contexto {
  f: Fatias;
  maq: Maquina;
  aj: Ajustes;
  zs: number[];
  /** fluxo e vazão do material */
  vazaoMax: number;
  sup: Suportes | null;
  /** campo da camada de baixo (balanço das paredes) */
  campoAbaixo: Float32Array | null;
  /** M2: costuras da camada de baixo (x, y, …) e onde ela terminou */
  costuras?: number[];
  fimAnterior?: [number, number];
}

/** Gera os trechos da camada `i` da peça (coordenadas da peça). */
export function gerarCamada(ctx: Contexto, i: number): CamadaPeca {
  const { f: F, maq, aj } = ctx;
  const pr = maq.processo, g = F.g;
  const N = g.cols * g.lins;
  const h = i === 0 ? ctx.zs[0] : ctx.zs[i] - ctx.zs[i - 1];
  const z = (i === 0 ? 0 : ctx.zs[i - 1]) + h / 2;
  const prim = i === 0;
  const trechos: Trecho[] = [];
  const dentro = expandir(F.bits[i], N);
  // fora da peça só a borda (primeira camada) precisa de distância
  const campo = campoDistancia(F.segs[i], F.segs[i].length / 4, dentro, g, undefined, prim && aj.borda ? pr.bordaFolga + pr.bordaLargura + 1 : 1);
  const abaixo = ctx.campoAbaixo;
  ctx.campoAbaixo = campo;
  const vol = (v: number, w: number, fl: number) => Math.min(v, ctx.vazaoMax / (espacamento(w, h) * h * fl));
  const jj = (x: number) => (x > 0 ? x : pr.jPadrao);

  // ---- paredes ----
  const wE = prim ? pr.lPrimeira : pr.lParedeExt, wI = prim ? pr.lPrimeira : pr.lParedeInt;
  const sE = espacamento(wE, h), sI = espacamento(wI, h);
  const voltas = prim && pr.umaParedePrimeira ? 1 : Math.max(1, aj.paredes);
  const niveis: number[] = [sE / 2];
  for (let k = 1; k < voltas; k++) niveis.push(sE + (k - 0.5) * sI);
  const rot = rotular(dentro, g);
  const ilhaDe = (x: number, y: number) => {
    let q = celula(g, x, y);
    if (q >= 0 && rot.rot[q]) return rot.rot[q];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
      q = celula(g, x + dx * g.c, y + dy * g.c);
      if (q >= 0 && rot.rot[q]) return rot.rot[q];
    }
    return 0;
  };
  const porIlha: Trecho[][] = Array.from({ length: rot.n + 1 }, () => []);
  // paredes de cada ilha por nível (0 = externa … voltas-1; voltas = filetes do meio): a ordem das paredes sai daqui
  const porNivel: Trecho[][][] = Array.from({ length: rot.n + 1 }, () => Array.from({ length: voltas + 1 }, () => []));
  const nivelDe = new Map<Trecho, number>();
  let ultimoNivel = -1;
  // balanço: velocidade por faixa do quanto a parede sai da camada de baixo
  const velBalanco = (frac: number) => {
    if (frac < 0.1) return Infinity; // até 10% da largura conta como apoiada
    const v = frac >= 1 ? pr.vBalancoTotal : pr.vBalanco[Math.min(3, Math.floor(frac * 4))];
    return v > 0 ? v : Infinity;
  };
  // ---- M1: largura variável, vãos e uma parede só no topo (tudo desligado = clássico, sem custo extra) ----
  const wSp = prim ? pr.lPrimeira : pr.lEsparso;
  const nivel1 = sE / 2 + sE / 2 - pr.sobreposicao * wSp;
  let umaParede: Uint8Array | null = null;
  if (pr.umaParedeTopo && !prim && voltas > 1) {
    // superfície de topo: dentro nesta camada e fora na de cima; mais estreita que o limite fica com todas as paredes
    const acima = i + 1 < F.n ? expandir(F.bits[i + 1], N) : new Uint8Array(N);
    const m = new Uint8Array(N);
    let algum = false;
    for (let q = 0; q < N; q++)
      if (dentro[q] && !acima[q]) {
        m[q] = 1;
        algum = true;
      }
    if (algum && pr.umaParedeTopoLimite > 0) {
      const r = Math.max(1, Math.round(pr.umaParedeTopoLimite / 2 / g.c)), aux = new Uint8Array(N), fora = new Uint8Array(N), er = new Uint8Array(N);
      for (let q = 0; q < N; q++) fora[q] = m[q] ? 0 : 1;
      dilatar(fora, g, r, er, aux);
      for (let q = 0; q < N; q++) er[q] = er[q] ? 0 : 1;
      dilatar(er, g, r, m, aux);
      for (let q = 0; q < N; q++) if (!dentro[q]) m[q] = 0;
    }
    if (algum) umaParede = m;
  }
  const variavel = pr.geradorParedes === "larguraVariavel";
  const m1 = variavel || pr.preenchimentoVaos || umaParede
    ? new GeradorM1(F.segs[i], F.segs[i].length / 4, g, {
        variavel, vaos: pr.preenchimentoVaos, niveis: niveis.slice(0, voltas), umaParede,
        p: { sE, sI, voltas, sMin: Math.max(0.05, espacamento(pr.geradorLarguraMinima * 0.4, h)), sMax: 2 * sI, detMin: pr.geradorDetalheMinimo * 0.4, distrib: pr.geradorParedesTransicao },
        cosTrans: Math.cos((pr.geradorAnguloTransicao * Math.PI) / 180), filtro: pr.geradorFiltro,
        vaoMin: Math.max(0.05, pr.geradorDetalheMinimo * 0.4), vaoMax: espacamento(prim ? pr.lPrimeira : pr.lSolido, h),
      })
    : null;
  const vaosPorIlha: Trecho[][] = Array.from({ length: rot.n + 1 }, () => []);
  /** largura do filete para a cobertura `s` (inverso de `espacamento`) */
  const larguraDe = (s: number) => s + h * (1 - Math.PI / 4);
  const emitirParede = (pts: Float64Array, fechado: boolean, w: number, ext: boolean, Llaco: number, destino: Trecho[], parte: Parte = ext ? "paredeExt" : "paredeInt") => {
    let vSeg: Float32Array | undefined;
    if (abaixo && !prim && pr.vBalanco.some((v) => v > 0)) {
      // subdivide em passos de 1 mm e mede o balanço em cada ponto
      const np = pts.length / 2;
      const novo: number[] = [];
      for (let a = 0; a < (fechado ? np : np - 1); a++) {
        const b = (a + 1) % np;
        const ax = pts[a * 2], ay = pts[a * 2 + 1], bx = pts[b * 2], by = pts[b * 2 + 1];
        const m = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay)));
        for (let s = 0; s < m; s++) novo.push(ax + ((bx - ax) * s) / m, ay + ((by - ay) * s) / m);
      }
      if (!fechado) novo.push(pts[np * 2 - 2], pts[np * 2 - 1]);
      const nn = novo.length / 2;
      const fr = new Float32Array(nn);
      let algum = false;
      for (let a = 0; a < nn; a++) {
        const d = amostrar(abaixo, g, novo[a * 2], novo[a * 2 + 1]);
        fr[a] = (w / 2 - d) / w;
        if (fr[a] >= 0.1) algum = true;
      }
      if (algum) {
        pts = Float64Array.from(novo);
        vSeg = new Float32Array(nn);
        for (let a = 0; a < nn; a++) vSeg[a] = Math.min(velBalanco(fr[a]), velBalanco(fr[(a + 1) % nn]));
      }
    }
    let v = parte === "vaos" ? pr.vVaos : prim ? pr.vPrimeira : ext ? pr.vParedeExt : pr.vParedeInt;
    if (parte !== "vaos" && pr.limitePerimetroPequeno > 0 && Llaco < pr.limitePerimetroPequeno) v = Math.min(v, pr.vPerimetroPequeno);
    const a = parte === "vaos" ? (prim ? pr.aPrimeira : pr.aSolido) : prim ? pr.aPrimeira : ext ? pr.aParedeExt : pr.aParedeInt;
    const j = jj(parte === "vaos" ? (prim ? pr.jPrimeira : pr.jPreench) : prim ? pr.jPrimeira : ext ? pr.jParedeExt : pr.jParedeInt);
    const t: Trecho = { pts, fechado, parte, w, fluxo: 1, v: vol(v, w, 1), vSeg, a, j };
    destino.push(t);
    return t;
  };
  const gerados = (lista: ParedeGerada[], Llaco: (r: ParedeGerada) => number) => {
    for (const r of lista) {
      const ilha = ilhaDe(r.pts[0], r.pts[1]);
      const vao = r.tipo === "vao";
      emitirParede(r.pts, r.fechado, larguraDe(r.s), r.externa, Llaco(r), vao ? vaosPorIlha[ilha] : porNivel[ilha][voltas], vao ? "vaos" : undefined);
    }
  };
  // filetes do meio (o mais de dentro) e vãos, pela sonda: curva de nível rasa que existe até nas partes finas
  if (m1 && (variavel || pr.preenchimentoVaos)) {
    const nivelSonda = Math.max(0.02, Math.min(sE / 2, (pr.geradorDetalheMinimo * 0.4) / 2 * 0.9));
    gerados(m1.centros(contornos(campo, g, nivelSonda), nivelSonda), (r) => (r.fechado ? comprimento(r.pts, true) : Infinity));
  }
  for (let k = voltas - 1; k >= 0; k--) {
    const ext = k === 0;
    const w = ext ? wE : wI;
    const lacos = contornos(campo, g, niveis[k]);
    if (lacos.length) ultimoNivel = Math.max(ultimoNivel, k);
    for (const l of lacos) {
      const L = comprimento(l.pts, true);
      if (L < 3 * w) continue;
      const partes = m1 ? m1.laco(l.pts, k) : null;
      if (!partes) {
        nivelDe.set(emitirParede(l.pts, true, w, ext, L, porNivel[ilhaDe(l.pts[0], l.pts[1])][k]), k);
        continue;
      }
      for (const r of partes) nivelDe.set(emitirParede(r.pts, r.fechado, larguraDe(r.s), ext, L, porNivel[ilhaDe(r.pts[0], r.pts[1])][k]), k);
    }
  }
  // ordem das paredes: de dentro para fora (como antes: filetes do meio, voltas-1 … 0), de fora para dentro ou a 2ª,
  // a externa e depois as outras de fora para dentro
  const ordemNiveis: number[] = [];
  if (pr.ordemParedes === "externaInterna") for (let k = 0; k <= voltas; k++) ordemNiveis.push(k);
  else if (pr.ordemParedes === "internaExternaInterna" && voltas > 1) {
    ordemNiveis.push(1, 0);
    for (let k = 2; k <= voltas; k++) ordemNiveis.push(k);
  } else for (let k = voltas; k >= 0; k--) ordemNiveis.push(k);
  for (let r = 0; r <= rot.n; r++) for (const k of ordemNiveis) porIlha[r].push(...porNivel[r][k]);

  // ---- preenchimento ----
  const nivelP = ultimoNivel < 0 ? Infinity : niveis[voltas - 1] + (voltas > 1 ? sI : sE) / 2 - pr.sobreposicao * wSp;
  // uma parede só no topo: ali o preenchimento começa logo depois da parede externa (campo deslocado nessas células)
  let campoP = campo;
  if (umaParede && nivelP < Infinity && nivelP > nivel1) {
    campoP = Float32Array.from(campo);
    const dd = nivelP - nivel1;
    for (let q = 0; q < N; q++) if (umaParede[q]) campoP[q] += dd;
  }
  // classes por célula pelas camadas vizinhas (palavras de 32 bits)
  const topoN = aj.topo > 0 ? Math.max(aj.topo, Math.ceil(pr.topoMm / aj.altura - 1e-6)) : 0;
  const fundoN = aj.fundo > 0 ? Math.max(aj.fundo, Math.ceil(pr.fundoMm / aj.altura - 1e-6)) : 0;
  const W = F.bits[i].length;
  const vazio = new Uint32Array(W);
  const bitsDe = (k: number) => (k < 0 || k >= F.n ? vazio : F.bits[k]);
  const classe = new Uint8Array(N);
  const presentes = new Set<number>();
  if (nivelP < Infinity) {
    const acima = bitsDe(i + 1), abaixoB = bitsDe(i - 1);
    for (let wd = 0; wd < W; wd++) {
      const b = F.bits[i][wd];
      if (!b) continue;
      let jan = b;
      for (let k = 1; k <= topoN; k++) jan &= bitsDe(i + k)[wd];
      for (let k = 1; k <= fundoN; k++) jan &= bitsDe(i - k)[wd];
      for (let t = 0; t < 32; t++) {
        if (!((b >>> t) & 1)) continue;
        const q = wd * 32 + t;
        let cl: number;
        if (prim) cl = CLASSE.solido;
        else if (!((abaixoB[wd] >>> t) & 1)) cl = CLASSE.ponte;
        else if (!((acima[wd] >>> t) & 1)) cl = CLASSE.topo;
        else if (!((jan >>> t) & 1)) cl = CLASSE.solido;
        else cl = CLASSE.esparso;
        classe[q] = cl;
      }
    }
    // vãos preenchidos ficam fora do preenchimento
    if (m1) for (let q = 0; q < N; q++) if (m1.semPreench[q]) classe[q] = 0;
    // área pequena de esparso vira sólido
    const mE = new Uint8Array(N);
    for (let q = 0; q < N; q++) mE[q] = classe[q] === CLASSE.esparso && campoP[q] >= nivelP ? 1 : 0;
    const comp = rotular(mE, g);
    const minCel = pr.areaMinEsparso / (g.c * g.c);
    for (let q = 0; q < N; q++) {
      const r = comp.rot[q];
      if (r && comp.celulas[r] < minCel) classe[q] = CLASSE.solido;
    }
    // esparso a 100% vira sólido (como no perfil)
    if (!prim && aj.preenchimento >= 0.999) for (let q = 0; q < N; q++) if (classe[q] === CLASSE.esparso) classe[q] = CLASSE.solido;
    for (let q = 0; q < N; q++) if (classe[q] && campoP[q] >= nivelP) presentes.add(classe[q]);
  }
  // caixa da camada
  let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
  for (let q = 0; q < N; q++)
    if (dentro[q]) {
      const x = g.x0 + ((q % g.cols) + 0.5) * g.c, y = g.y0 + (Math.floor(q / g.cols) + 0.5) * g.c;
      if (x < bx0) bx0 = x;
      if (x > bx1) bx1 = x;
      if (y < by0) by0 = y;
      if (y > by1) by1 = y;
    }
  const caixaC: [number, number, number, number] = [bx0, by0, bx1, by1];
  const angSolido = i % 2 ? (3 * Math.PI) / 4 : Math.PI / 4;
  const preenchimentos: { cl: number; parte: Parte; w: number; fluxo: number; v: number; a: number; j: number; curvas: () => number[][]; liga: number }[] = [];
  const solidas = (w: number) => () => {
    const s: number[][] = [];
    familia(angSolido, espacamento(w, h), 0, bx0, by0, bx1, by1, s);
    return s;
  };
  if (prim) {
    preenchimentos.push({ cl: CLASSE.solido, parte: "solido", w: pr.lPrimeira, fluxo: 1, v: pr.vPrimeiraPreench, a: pr.aPrimeira, j: jj(pr.jPrimeira), curvas: solidas(pr.lPrimeira), liga: 5 });
  } else {
    const rho = aj.preenchimento;
    if (rho > 0)
      preenchimentos.push({
        cl: CLASSE.esparso, parte: "esparso", w: pr.lEsparso, fluxo: 1, v: pr.vEsparso, a: pr.aEsparso, j: jj(pr.jPreench), liga: pr.ancoraMax,
        curvas: () => {
          const s: number[][] = [];
          curvasEsparso(aj.padrao, Math.min(1, rho), espacamento(pr.lEsparso, h), i, z, h, g, caixaC, s);
          return s;
        },
      });
    preenchimentos.push({ cl: CLASSE.solido, parte: "solido", w: pr.lSolido, fluxo: 1, v: pr.vSolido, a: pr.aSolido, j: jj(pr.jPreench), curvas: solidas(pr.lSolido), liga: 5 });
    preenchimentos.push({ cl: CLASSE.ponte, parte: "ponte", w: pr.lSolido, fluxo: pr.fluxoPonte, v: pr.vPonte, a: pr.aPonte, j: jj(pr.jPreench), curvas: solidas(pr.lSolido), liga: 5 });
    preenchimentos.push({ cl: CLASSE.topo, parte: "topo", w: pr.lTopo, fluxo: pr.fluxoTopo, v: pr.vTopo, a: pr.aTopo, j: jj(pr.jTopo), curvas: solidas(pr.lTopo), liga: 5 });
  }

  // ---- ordem: ilha por ilha (paredes de dentro para fora, depois o preenchimento) ----
  const ordemIlhas: number[] = [];
  {
    const centros = Array.from({ length: rot.n + 1 }, () => [0, 0, 0]);
    for (let q = 0; q < N; q++) {
      const r = rot.rot[q];
      if (!r) continue;
      centros[r][0] += q % g.cols;
      centros[r][1] += Math.floor(q / g.cols);
      centros[r][2]++;
    }
    const resta = new Set(Array.from({ length: rot.n }, (_, k) => k + 1).filter((r) => centros[r][2] > 0 || porIlha[r].length));
    let px = bx0, py = by0;
    while (resta.size) {
      let melhor = -1, dmin = Infinity;
      for (const r of resta) {
        const c3 = centros[r];
        const x = g.x0 + (c3[0] / Math.max(1, c3[2]) + 0.5) * g.c, y = g.y0 + (c3[1] / Math.max(1, c3[2]) + 0.5) * g.c;
        const d = (x - px) ** 2 + (y - py) ** 2;
        if (d < dmin) {
          dmin = d;
          melhor = r;
        }
      }
      resta.delete(melhor);
      ordemIlhas.push(melhor);
      const c3 = centros[melhor];
      px = g.x0 + (c3[0] / Math.max(1, c3[2]) + 0.5) * g.c;
      py = g.y0 + (c3[1] / Math.max(1, c3[2]) + 0.5) * g.c;
    }
    if (porIlha[0].length) ordemIlhas.push(0);
  }
  // recorta cada preenchimento uma vez e distribui pelas ilhas
  const linhasPorIlha = new Map<string, number[][]>();
  for (let pi = 0; pi < preenchimentos.length; pi++) {
    const p = preenchimentos[pi];
    if (!presentes.has(p.cl) || nivelP === Infinity) continue;
    const recortes: number[][] = [];
    for (const cv of p.curvas()) recortar(cv, g, campoP, nivelP, classe, p.cl, recortes);
    for (const r of recortes) {
      if (comprimento(r, false) < p.w) continue;
      const chave = `${ilhaDe(r[0], r[1])}:${pi}`;
      let l = linhasPorIlha.get(chave);
      if (!l) linhasPorIlha.set(chave, (l = []));
      l.push(r);
    }
  }
  // ---- M2: costura, rampa, vão e limpeza dos laços de parede (com os padrões nada disso roda) ----
  const m2 = pr.costuraPosicao !== "maisProxima" || pr.costuraAlternada || pr.costuraVao > 0 || pr.costuraRampaTipo !== "nenhuma" ||
    pr.limparNosLacos || pr.limparAntesParedeExt || pr.evitarCruzarParedes;
  const costurasDaCamada: number[] = [];
  const rnd = sorteio(i * 7919 + 17);
  let pos: [number, number] | null = m2 ? (ctx.fimAnterior ?? [bx0, by0]) : null;
  const costurar = (ws: Trecho[]): Trecho[] => {
    const saida: Trecho[] = [];
    for (const t of ws) {
      if (!t.fechado || (t.parte !== "paredeExt" && t.parte !== "paredeInt") || t.pts.length < 6) {
        saida.push(t);
        pos = pontaFinal(t) ?? pos;
        continue;
      }
      let k = escolherCostura(t.pts, pr.costuraPosicao, pos, ctx.costuras ? ctx.costuras.concat(costurasDaCamada) : costurasDaCamada, rnd);
      costurasDaCamada.push(t.pts[k * 2], t.pts[k * 2 + 1]);
      const prof = nivelDe.get(t) ?? 0;
      let lt = t;
      // internas alternadas: recuadas pela profundidade (a referência da camada de cima continua sem o recuo)
      if (pr.costuraAlternada && t.parte === "paredeInt" && prof > 0) ({ t: lt, k } = recuar(t, k, prof * t.w));
      const ext = t.parte === "paredeExt";
      const rampa = ext && (pr.costuraRampaTipo === "contornoFuros" || (pr.costuraRampaTipo === "contorno" && areaLaco(t.pts) > 0));
      const partes = transformarLaco(girar(lt, k), {
        vao: pr.costuraVao * 0.4, rampa, rampaAltura: pr.costuraRampaAltura, rampaComp: pr.costuraRampaLacoInteiro ? Infinity : pr.costuraRampaComprimento,
        rampaPassos: pr.costuraRampaPassos, rampaV: pr.costuraVelocidade > 0 ? vol(pr.costuraVelocidade, t.w, 1) : 0,
        limpar: ext && pr.limparNosLacos ? t.w : 0, limparAntes: ext && pr.limparAntesParedeExt ? t.w : 0,
      });
      saida.push(...partes);
      pos = pontaFinal(partes[partes.length - 1]) ?? pos;
    }
    return saida;
  };
  for (const ilha of ordemIlhas) {
    const ws = m2 ? costurar(porIlha[ilha]) : porIlha[ilha];
    // paredes já em ordem: a partida do preenchimento é o fim da última parede
    trechos.push(...ws);
    const fimP = m2 && ws.length ? pontaFinal(ws[ws.length - 1]) : null;
    let px = fimP ? fimP[0] : ws.length ? ws[ws.length - 1].pts[0] : bx0, py = fimP ? fimP[1] : ws.length ? ws[ws.length - 1].pts[1] : by0;
    for (let pi = 0; pi < preenchimentos.length; pi++) {
      const linhas = linhasPorIlha.get(`${ilha}:${pi}`);
      if (!linhas) continue;
      const p = preenchimentos[pi];
      [px, py] = ligar(linhas, px, py, p.liga, campoP, g, nivelP, p.w, { parte: p.parte, w: p.w, fluxo: p.fluxo, v: vol(p.v, p.w, p.fluxo), a: p.a, j: p.j }, trechos);
    }
    // vãos da ilha depois do preenchimento
    trechos.push(...vaosPorIlha[ilha]);
    if (m2 && trechos.length) pos = pontaFinal(trechos[trechos.length - 1]) ?? [px, py];
  }
  if (m2) {
    ctx.costuras = costurasDaCamada;
    if (pos) ctx.fimAnterior = pos;
  }
  // ---- M2: deslocamentos que cruzariam a parede externa ou um furo seguem por dentro (entre a externa e a 2ª parede) ----
  if (pr.evitarCruzarParedes && trechos.length > 1) {
    const nv = voltas > 1 ? (niveis[0] + niveis[1]) / 2 : niveis[0];
    let lacosVia: Float64Array[] | null = null;
    const lacos = () => (lacosVia ??= contornos(campo, g, nv, 0.05).map((l) => l.pts));
    for (let k = 1; k < trechos.length; k++) {
      const a = pontaFinal(trechos[k - 1]), b = pontaInicial(trechos[k]);
      if (!a || !b || Math.hypot(b[0] - a[0], b[1] - a[1]) < 2 * g.c) continue;
      const via = desviar(a[0], a[1], b[0], b[1], campo, g, niveis[0] / 2, lacos, pr.evitarCruzarDesvio);
      if (via) trechos[k] = { ...trechos[k], via: Float64Array.from(via), viaDe: a };
    }
  }

  // ---- suporte ----
  if (ctx.sup) gerarSuporte(ctx, i, h, trechos);

  // ---- borda (aba) na primeira camada ----
  if (prim && aj.borda) {
    const sB = espacamento(pr.lPrimeira, h);
    const voltasB = Math.max(1, Math.ceil(pr.bordaLargura / sB));
    const borda: Trecho[] = [];
    for (let k = voltasB - 1; k >= 0; k--)
      for (const l of contornos(campo, g, -(pr.bordaFolga + sB / 2 + k * sB)))
        if (l.area > 0) borda.push({ pts: l.pts, fechado: true, parte: "borda", w: pr.lPrimeira, fluxo: 1, v: vol(pr.vPrimeira, pr.lPrimeira, 1), a: pr.aPrimeira, j: jj(pr.jPrimeira) });
    trechos.unshift(...borda);
  }
  const inicio: [number, number] = trechos.length ? [trechos[0].pts[0], trechos[0].pts[1]] : [0, 0];
  return { trechos, inicio };
}

/** Trechos do suporte da camada (corpo em linhas, interface densa, galhos da árvore). */
function gerarSuporte(ctx: Contexto, i: number, h: number, saida: Trecho[]) {
  const { f: F, maq } = ctx, pr = maq.processo, g = F.g, sup = ctx.sup!;
  const N = g.cols * g.lins;
  const prim = i === 0;
  const w = prim ? pr.lPrimeira : pr.lSuporte;
  const s = espacamento(w, h);
  const vol = (v: number) => Math.min(v, ctx.vazaoMax / (s * h));
  const base = { w, fluxo: 1, a: prim ? pr.aPrimeira : pr.aPadrao, j: prim && pr.jPrimeira > 0 ? pr.jPrimeira : pr.jPadrao };
  const classe = new Uint8Array(N);
  if (sup.corpo[i]) {
    const m = expandir(sup.corpo[i]!, N);
    for (let q = 0; q < N; q++) if (m[q]) classe[q] = 1;
  }
  if (sup.interface[i]) {
    const m = expandir(sup.interface[i]!, N);
    for (let q = 0; q < N; q++) if (m[q]) classe[q] = 2;
  }
  const caixaG = [g.x0, g.y0, g.x0 + g.cols * g.c, g.y0 + g.lins * g.c];
  const linhasDe = (cl: number, ang: number, passo: number, parte: Parte, v: number) => {
    const fam: number[][] = [], rec: number[][] = [];
    familia(ang, passo, 0, caixaG[0], caixaG[1], caixaG[2], caixaG[3], fam);
    for (const l of fam) recortar(l, g, null, 0, classe, cl, rec);
    const ok = rec.filter((r) => comprimento(r, false) >= w);
    if (!ok.length) return;
    const campo = campoDoMapa(classe.map((x) => (x === cl ? 1 : 0)), g);
    ligar(ok, ok[0][0], ok[0][1], 2 * passo + w, campo, g, 0, w, { ...base, parte, v: vol(prim ? pr.vPrimeira : v) }, saida);
  };
  if (sup.corpo[i]) linhasDe(1, 0, pr.espacoSuporte + w, "suporte", pr.vSuporte);
  if (sup.interface[i]) linhasDe(2, i % 2 ? Math.PI / 2 : 0, pr.espacoInterface + w, "interface", pr.vInterface);
  const galhos = sup.galhos[i];
  if (galhos) {
    for (let k = 0; k < galhos.length; k += 3) {
      const x = galhos[k], y = galhos[k + 1], r = galhos[k + 2];
      const raios = [Math.max(s / 2, r - s / 2)];
      if (2 * r > pr.arvore.paredeDupla && r - 1.5 * s > s / 2) raios.push(r - 1.5 * s);
      for (const rr of raios) {
        const nl = Math.max(8, Math.min(64, Math.ceil((2 * Math.PI * rr) / 0.6)));
        const pts = new Float64Array(nl * 2);
        for (let a = 0; a < nl; a++) {
          pts[a * 2] = x + rr * Math.cos((2 * Math.PI * a) / nl);
          pts[a * 2 + 1] = y + rr * Math.sin((2 * Math.PI * a) / nl);
        }
        saida.push({ ...base, pts, fechado: true, parte: "suporte", v: vol(prim ? pr.vPrimeira : pr.vSuporte) });
      }
    }
  }
}
