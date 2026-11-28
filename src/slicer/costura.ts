// WJSlicer3D: costura dos laços de parede, rampa (costura escarfada), vão da costura, limpeza e desvio dos
// deslocamentos para não cruzar as paredes (fatia M2, docs/global/wjslicer3d-layout.md). Código próprio: só o
// comportamento das funções de um fatiador foi estudado, nenhuma linha copiada.
// Convenção dos laços (campo.ts): o lado esquerdo do sentido de impressão é o de dentro do material; contorno externo
// anti-horário (área > 0), furo horário. Tudo puro: testado em scripts/teste-costura.ts.
// Com os padrões do processo nada daqui é chamado (o resultado fica idêntico ao de antes da M2).

import { amostrar, type Grade } from "./campo";
import type { Trecho } from "./caminhos";

export type PosicaoCostura = "maisProxima" | "alinhada" | "alinhadaAtras" | "atras" | "aleatoria";

/** Peso (mm) da preferência por cantos: o canto mais vivo "puxa" a costura até essa distância. */
const PESO_CANTO = 1;
/** Costura da camada de baixo mais longe do laço que isso (mm) não serve de referência para o alinhamento. */
const ALCANCE_ALINHAR = 2;

/** Área com sinal do laço (> 0 = anti-horário = contorno externo). */
export function areaLaco(p: Float64Array): number {
  const n = p.length / 2;
  let a = 0;
  for (let k = 0, j = n - 1; k < n; j = k++) a += p[j * 2] * p[k * 2 + 1] - p[k * 2] * p[j * 2 + 1];
  return a / 2;
}

/**
 * Nota de canto de cada vértice do laço (0 = reto ou curva suave; até 1 = canto vivo), medida entre os pontos a `r` mm
 * antes e depois (as curvas de nível têm muitos vértices curtos). Canto côncavo (vira para fora do material) vale mais
 * que o convexo: a costura escondida no canto de dentro aparece menos.
 */
export function notasDeCanto(p: Float64Array, r = 0.6): Float32Array {
  const n = p.length / 2, nota = new Float32Array(n);
  if (n < 3) return nota;
  // comprimento acumulado (laço fechado)
  const s = new Float64Array(n + 1);
  for (let k = 0; k < n; k++) {
    const b = (k + 1) % n;
    s[k + 1] = s[k] + Math.hypot(p[b * 2] - p[k * 2], p[b * 2 + 1] - p[k * 2 + 1]);
  }
  const L = s[n];
  if (L < 4 * r) return nota;
  const ponto = (d: number, out: number[]) => {
    d = ((d % L) + L) % L;
    let lo = 0, hi = n;
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (s[m] <= d) lo = m;
      else hi = m;
    }
    const b = (lo + 1) % n, f = s[lo + 1] > s[lo] ? (d - s[lo]) / (s[lo + 1] - s[lo]) : 0;
    out[0] = p[lo * 2] + (p[b * 2] - p[lo * 2]) * f;
    out[1] = p[lo * 2 + 1] + (p[b * 2 + 1] - p[lo * 2 + 1]) * f;
  };
  const a = [0, 0], b = [0, 0], lim = Math.PI / 6;
  for (let k = 0; k < n; k++) {
    ponto(s[k] - r, a);
    ponto(s[k] + r, b);
    const ux = p[k * 2] - a[0], uy = p[k * 2 + 1] - a[1], vx = b[0] - p[k * 2], vy = b[1] - p[k * 2 + 1];
    const giro = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    const g = Math.min(1, Math.max(0, (Math.abs(giro) - lim) / (Math.PI / 3)));
    nota[k] = giro < 0 ? g : 0.7 * g;
  }
  return nota;
}

/** Gerador pseudoaleatório determinístico (a mesma peça dá sempre o mesmo resultado). */
export function sorteio(semente: number): () => number {
  let x = semente >>> 0 || 1;
  return () => {
    x = (x + 0x6d2b79f5) >>> 0;
    let t = x;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Costura da camada de baixo mais perto do laço (ou null se nenhuma estiver a até `ALCANCE_ALINHAR` mm dele). */
function referencia(p: Float64Array, refs: number[]): [number, number] | null {
  const n = p.length / 2;
  let melhor: [number, number] | null = null, dmin = ALCANCE_ALINHAR * ALCANCE_ALINHAR;
  for (let r = 0; r < refs.length; r += 2)
    for (let k = 0; k < n; k++) {
      const d = (p[k * 2] - refs[r]) ** 2 + (p[k * 2 + 1] - refs[r + 1]) ** 2;
      if (d < dmin) {
        dmin = d;
        melhor = [refs[r], refs[r + 1]];
      }
    }
  return melhor;
}

/**
 * Índice do vértice onde o laço começa e termina.
 * - mais próxima: o ponto mais perto do bico (`pos`);
 * - alinhada: perto da costura da camada de baixo (`refs`), puxada para o canto mais vivo; sem referência, o canto mais
 *   vivo (laço sem canto: o ponto mais perto do bico);
 * - alinhada atrás: como a alinhada, mas sem referência começa atrás;
 * - atrás: o ponto mais ao fundo da mesa (+Y), preferindo canto (empate: o mais à esquerda);
 * - aleatória: um vértice sorteado.
 */
export function escolherCostura(p: Float64Array, modo: PosicaoCostura, pos: [number, number] | null, refs: number[], rnd: () => number): number {
  const n = p.length / 2;
  if (n < 2) return 0;
  const perto = (x: number, y: number) => {
    let ini = 0, dmin = Infinity;
    for (let k = 0; k < n; k++) {
      const d = (p[k * 2] - x) ** 2 + (p[k * 2 + 1] - y) ** 2;
      if (d < dmin) {
        dmin = d;
        ini = k;
      }
    }
    return ini;
  };
  if (modo === "maisProxima") return pos ? perto(pos[0], pos[1]) : 0;
  if (modo === "aleatoria") return Math.min(n - 1, Math.floor(rnd() * n));
  const canto = notasDeCanto(p);
  const atras = () => {
    let ini = 0, cmin = Infinity;
    for (let k = 0; k < n; k++) {
      const c = -p[k * 2 + 1] - PESO_CANTO * canto[k] + 1e-3 * p[k * 2];
      if (c < cmin) {
        cmin = c;
        ini = k;
      }
    }
    return ini;
  };
  if (modo === "atras") return atras();
  const ref = referencia(p, refs);
  if (ref) {
    let ini = 0, cmin = Infinity;
    for (let k = 0; k < n; k++) {
      const c = Math.hypot(p[k * 2] - ref[0], p[k * 2 + 1] - ref[1]) - PESO_CANTO * canto[k];
      if (c < cmin - 1e-9) {
        cmin = c;
        ini = k;
      }
    }
    return ini;
  }
  if (modo === "alinhadaAtras") return atras();
  let ini = -1, cmax = 0;
  for (let k = 0; k < n; k++)
    if (canto[k] > cmax + 1e-6) {
      cmax = canto[k];
      ini = k;
    }
  return ini >= 0 ? ini : pos ? perto(pos[0], pos[1]) : 0;
}

/**
 * Ponto `d` mm antes do vértice `k` no laço (para trás do sentido de impressão), inserido como vértice novo: devolve o
 * laço com o ponto e o índice dele (o limite de velocidade do segmento dividido vale para as duas metades).
 */
export function recuar(t: Trecho, k: number, d: number): { t: Trecho; k: number } {
  const p = t.pts, n = p.length / 2;
  let resta = d, a = k;
  for (let passos = 0; passos < n && resta > 1e-9; passos++) {
    const b = (a - 1 + n) % n;
    const L = Math.hypot(p[a * 2] - p[b * 2], p[a * 2 + 1] - p[b * 2 + 1]);
    if (L > resta + 1e-9) {
      const f = resta / L, x = p[a * 2] + (p[b * 2] - p[a * 2]) * f, y = p[a * 2 + 1] + (p[b * 2 + 1] - p[a * 2 + 1]) * f;
      const q = new Float64Array(p.length + 2);
      q.set(p.subarray(0, (b + 1) * 2));
      q[(b + 1) * 2] = x;
      q[(b + 1) * 2 + 1] = y;
      q.set(p.subarray((b + 1) * 2), (b + 2) * 2);
      let vSeg: Float32Array | undefined;
      if (t.vSeg) {
        vSeg = new Float32Array(n + 1);
        vSeg.set(t.vSeg.subarray(0, b + 1));
        vSeg[b + 1] = t.vSeg[b];
        vSeg.set(t.vSeg.subarray(b + 1), b + 2);
      }
      return { t: { ...t, pts: q, vSeg }, k: b + 1 };
    }
    resta -= L;
    a = b;
  }
  return { t, k: a };
}

/** Laço girado para começar no vértice `k` (o limite de velocidade de cada segmento gira junto). */
export function girar(t: Trecho, k: number): Trecho {
  const p = t.pts, n = p.length / 2;
  if (!k) return { ...t, costura: true };
  const q = new Float64Array(p.length);
  for (let s = 0; s < n; s++) {
    q[s * 2] = p[((s + k) % n) * 2];
    q[s * 2 + 1] = p[((s + k) % n) * 2 + 1];
  }
  let vSeg: Float32Array | undefined;
  if (t.vSeg) {
    vSeg = new Float32Array(n);
    for (let s = 0; s < n; s++) vSeg[s] = t.vSeg[(s + k) % n];
  }
  return { ...t, pts: q, vSeg, costura: true };
}

/** Comprimento do laço fechado. */
function perimetro(p: Float64Array): number {
  const n = p.length / 2;
  let L = 0;
  for (let k = 0; k < n; k++) {
    const b = (k + 1) % n;
    L += Math.hypot(p[b * 2] - p[k * 2], p[b * 2 + 1] - p[k * 2 + 1]);
  }
  return L;
}

/**
 * Pedaço aberto do laço (já girado para a costura) entre os comprimentos `s0` e `s1` (0 ≤ s0 < s1 ≤ perímetro), com o
 * limite de velocidade de cada segmento.
 */
export function pedaco(t: Trecho, s0: number, s1: number): { pts: Float64Array; vSeg?: Float32Array } {
  const p = t.pts, n = p.length / 2;
  const xs: number[] = [], vs: number[] = [];
  let s = 0;
  for (let a = 0; a < n && s < s1 - 1e-12; a++) {
    const b = (a + 1) % n;
    const ax = p[a * 2], ay = p[a * 2 + 1], bx = p[b * 2], by = p[b * 2 + 1];
    const L = Math.hypot(bx - ax, by - ay);
    const e0 = s, e1 = s + L;
    s = e1;
    if (e1 <= s0 + 1e-12 || L < 1e-12) continue;
    const f0 = Math.max(0, (s0 - e0) / L), f1 = Math.min(1, (s1 - e0) / L);
    if (!xs.length) xs.push(ax + (bx - ax) * f0, ay + (by - ay) * f0);
    xs.push(ax + (bx - ax) * f1, ay + (by - ay) * f1);
    if (t.vSeg) vs.push(t.vSeg[a]);
  }
  return { pts: Float64Array.from(xs), vSeg: t.vSeg ? Float32Array.from(vs) : undefined };
}

export interface ParamLaco {
  /** vão da costura (mm): o laço termina antes de fechar */
  vao: number;
  /** rampa: aplica neste laço? altura inicial (fração), comprimento (mm; Infinity = laço inteiro), passos, velocidade (0 = a do laço) */
  rampa: boolean;
  rampaAltura: number;
  rampaComp: number;
  rampaPassos: number;
  rampaV: number;
  /** limpar depois do laço / chegar por dentro antes dele (mm; 0 = não) */
  limpar: number;
  limparAntes: number;
}

/**
 * Transforma o laço já girado para a costura: costura em rampa (começa com o fluxo subindo da altura inicial até o cheio
 * ao longo da rampa, dá a volta e passa de novo sobre a rampa com o fluxo descendo — em cada ponto da rampa as duas
 * passadas somam um filete cheio, então o material do laço não muda e o caminho cresce o comprimento da rampa) ou vão
 * da costura (o laço para `vao` mm antes de fechar). Sem nada disso devolve o próprio laço.
 */
export function transformarLaco(t: Trecho, o: ParamLaco): Trecho[] {
  const L = perimetro(t.pts);
  const base = { ...t, fechado: false, costura: undefined, limpar: undefined, limparAntes: undefined };
  let saida: Trecho[];
  if (o.rampa && L > 0) {
    const Lr = Math.min(L, o.rampaComp), m = Math.max(1, Math.round(o.rampaPassos)), a = Math.min(1, Math.max(0, o.rampaAltura));
    const v = o.rampaV > 0 ? o.rampaV : t.v;
    saida = [];
    for (let j = 0; j < m; j++) {
      const pc = pedaco(t, (Lr * j) / m, (Lr * (j + 1)) / m);
      saida.push({ ...base, ...pc, fluxo: t.fluxo * (a + ((1 - a) * (j + 0.5)) / m), v });
    }
    if (Lr < L - 1e-9) saida.push({ ...base, ...pedaco(t, Lr, L) });
    for (let j = 0; j < m; j++) {
      const pc = pedaco(t, (Lr * j) / m, (Lr * (j + 1)) / m);
      saida.push({ ...base, ...pc, fluxo: t.fluxo * (1 - a) * (1 - (j + 0.5) / m), v });
    }
    saida = saida.filter((x) => x.pts.length >= 4 && x.fluxo > 0);
  } else if (o.vao > 0 && L - o.vao > 3 * t.w) saida = [{ ...base, ...pedaco(t, 0, L - o.vao) }];
  else saida = [{ ...t, costura: true }];
  if (!saida.length) saida = [{ ...t, costura: true }];
  if (o.limparAntes > 0) saida[0] = { ...saida[0], limparAntes: o.limparAntes };
  if (o.limpar > 0) saida[saida.length - 1] = { ...saida[saida.length - 1], limpar: o.limpar };
  return saida;
}

/** Ponto de chegada e de saída de um trecho (laço sem costura fixa: desconhecido). */
export function pontaInicial(t: Trecho): [number, number] | null {
  return t.fechado && !t.costura ? null : [t.pts[0], t.pts[1]];
}
export function pontaFinal(t: Trecho): [number, number] | null {
  if (t.fechado) return t.costura ? [t.pts[0], t.pts[1]] : null;
  const n = t.pts.length;
  return [t.pts[n - 2], t.pts[n - 1]];
}

/** Ponto do laço mais perto de (x, y): segmento `a` (de a até a+1), fração `f` nele, distância `d`. */
function projetar(l: Float64Array | null, x: number, y: number): { a: number; f: number; x: number; y: number; d: number } {
  let r = { a: -1, f: 0, x: 0, y: 0, d: Infinity };
  if (!l) return r;
  const m = l.length / 2;
  for (let a = 0; a < m; a++) {
    const b = (a + 1) % m;
    const ax = l[a * 2], ay = l[a * 2 + 1], dx = l[b * 2] - ax, dy = l[b * 2 + 1] - ay, L2 = dx * dx + dy * dy;
    const f = L2 > 0 ? Math.min(1, Math.max(0, ((x - ax) * dx + (y - ay) * dy) / L2)) : 0;
    const px = ax + dx * f, py = ay + dy * f, d = Math.hypot(x - px, y - py);
    if (d < r.d) r = { a, f, x: px, y: py, d };
  }
  return r;
}

/**
 * Desvio de um deslocamento de A até B que sairia da peça (campo < `limiar`, ou seja, passaria por cima da parede
 * externa ou de um furo): segue por dentro, pelo laço `lacos` mais perto (a volta mais curta), até voltar a um trecho
 * reto que não cruza. Devolve os pontos intermediários (sem A e B) ou null (não cruza, não há como desviar ou o desvio
 * passaria de `desvioMax` mm a mais que o caminho reto; 0 = sem limite).
 */
export function desviar(
  ax: number, ay: number, bx: number, by: number, campo: Float32Array, g: Grade, limiar: number, lacos: () => Float64Array[], desvioMax: number,
): number[] | null {
  const via: number[] = [];
  let cx = ax, cy = ay;
  const passo = Math.max(0.05, g.c / 2);
  for (let volta = 0; volta < 4; volta++) {
    const L = Math.hypot(bx - cx, by - cy);
    const n = Math.floor(L / passo);
    let primeiro = -1, ultimo = -1;
    for (let k = 1; k < n; k++) {
      const f = (k * passo) / L;
      if (amostrar(campo, g, cx + (bx - cx) * f, cy + (by - cy) * f) < limiar) {
        if (primeiro < 0) primeiro = k;
        ultimo = k;
      }
    }
    if (primeiro < 0) break;
    if (volta === 3) return null;
    const ex = cx + ((bx - cx) * (primeiro - 1) * passo) / L, ey = cy + ((by - cy) * (primeiro - 1) * passo) / L;
    const rx = cx + ((bx - cx) * Math.min(n, ultimo + 1) * passo) / L, ry = cy + ((by - cy) * Math.min(n, ultimo + 1) * passo) / L;
    // laço mais perto da saída (projeção no segmento mais perto) e o ponto dele mais perto da volta
    let laco: Float64Array | null = null, pE = projetar(null, ex, ey);
    for (const l of lacos()) {
      const pr = projetar(l, ex, ey);
      if (pr.d < pE.d) {
        pE = pr;
        laco = l;
      }
    }
    if (!laco || pE.d > 2) return null;
    const pR = projetar(laco, rx, ry);
    if (pR.d > 2) return null;
    const m = laco.length / 2;
    const vx = (k: number) => laco![(k % m) * 2], vy = (k: number) => laco![(k % m) * 2 + 1];
    // volta mais curta: para a frente (vértices a+1 … b) ou para trás (vértices a … b+1)
    const frente: number[] = [], tras: number[] = [];
    if (pE.a !== pR.a || pE.f > pR.f) for (let k = (pE.a + 1) % m; ; k = (k + 1) % m) {
      frente.push(vx(k), vy(k));
      if (k === pR.a) break;
    }
    if (pE.a !== pR.a || pE.f < pR.f) for (let k = pE.a; ; k = (k - 1 + m) % m) {
      tras.push(vx(k), vy(k));
      if (k === (pR.a + 1) % m) break;
    }
    const comp = (l: number[]) => {
      let L = 0, qx = pE.x, qy = pE.y;
      for (let k = 0; k < l.length; k += 2) {
        L += Math.hypot(l[k] - qx, l[k + 1] - qy);
        qx = l[k];
        qy = l[k + 1];
      }
      return L + Math.hypot(pR.x - qx, pR.y - qy);
    };
    const caminho = comp(frente) <= comp(tras) ? frente : tras;
    via.push(pE.x, pE.y, ...caminho, pR.x, pR.y);
    cx = pR.x;
    cy = pR.y;
  }
  if (!via.length) return null;
  if (desvioMax > 0) {
    let L = Math.hypot(via[0] - ax, via[1] - ay) + Math.hypot(bx - via[via.length - 2], by - via[via.length - 1]);
    for (let k = 2; k < via.length; k += 2) L += Math.hypot(via[k] - via[k - 2], via[k + 1] - via[k - 1]);
    if (L - Math.hypot(bx - ax, by - ay) > desvioMax) return null;
  }
  return via;
}
