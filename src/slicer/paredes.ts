// WJSlicer3D: paredes de largura variável, preenchimento de vãos e cortes das paredes (fatia M1; código próprio).
// A espessura local da seção sai de um RAIO lançado de cada ponto da parede para dentro do material, na normal,
// até o outro lado (segmentos do corte): exato, sem esqueleto da grade. Com a espessura T:
// - "pilha" de paredes que cabe em T: no clássico, as curvas de nível de largura fixa (o que sobrar no meio é vão);
//   na largura variável, o nº de filetes que mais se aproxima de T e a sobra dividida pelos filetes de dentro
//   (entre a largura mínima e ~2× a linha), de modo que os filetes cobrem a seção inteira, sem sobra nem sobreposição;
// - o filete do meio (nº ímpar de filetes) e o vão central são polilinhas no eixo da parte fina (ponto médio do raio);
//   os dois lados acham o mesmo eixo: o primeiro a passar "reserva" as células e o outro é descartado.
// Só o lado de dentro de um ângulo de transição conta como parte fina (cantos vivos ficam como no clássico).
// Puro: testado em scripts/teste-paredes.ts.

import { areaLaco, celula, comprimento, type Grade } from "./campo";

// ---------- índice dos segmentos e raio ----------

/** Segmentos do corte em baldes de `c` mm, para raios curtos. */
export interface Indice {
  seg: Float64Array;
  x0: number;
  y0: number;
  c: number;
  cols: number;
  lins: number;
  ini: Int32Array;
  ids: Int32Array;
}

export function indexar(seg: Float64Array, ns: number, c = 1): Indice {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let k = 0; k < ns * 4; k += 2) {
    x0 = Math.min(x0, seg[k]);
    x1 = Math.max(x1, seg[k]);
    y0 = Math.min(y0, seg[k + 1]);
    y1 = Math.max(y1, seg[k + 1]);
  }
  if (!ns) x0 = y0 = x1 = y1 = 0;
  const cols = Math.max(1, Math.ceil((x1 - x0) / c) + 1), lins = Math.max(1, Math.ceil((y1 - y0) / c) + 1);
  const conta = new Int32Array(cols * lins + 1);
  const faixa = (s: number, f: (b: number) => void) => {
    const ax = seg[s * 4], ay = seg[s * 4 + 1], bx = seg[s * 4 + 2], by = seg[s * 4 + 3];
    const i0 = Math.floor((Math.min(ax, bx) - x0) / c), i1 = Math.floor((Math.max(ax, bx) - x0) / c);
    const j0 = Math.floor((Math.min(ay, by) - y0) / c), j1 = Math.floor((Math.max(ay, by) - y0) / c);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) f(j * cols + i);
  };
  for (let s = 0; s < ns; s++) faixa(s, (b) => conta[b + 1]++);
  for (let b = 0; b < cols * lins; b++) conta[b + 1] += conta[b];
  const ini = conta.slice(), ids = new Int32Array(conta[cols * lins]);
  const pos = conta.slice();
  for (let s = 0; s < ns; s++) faixa(s, (b) => (ids[pos[b]++] = s));
  return { seg, x0, y0, c, cols, lins, ini, ids };
}

/**
 * Distância ao longo do raio (x, y) + t·(dx, dy) (direção unitária) até o primeiro segmento, até `maxD`.
 * Infinity se não houver segmento ou se o lado achado não estiver de frente: |cos| entre o raio e a normal do
 * segmento abaixo de `cosMin` (ângulo de transição).
 */
export function raio(ix: Indice, x: number, y: number, dx: number, dy: number, maxD: number, cosMin: number): number {
  const { seg, c, cols, lins } = ix;
  const xe = x + dx * maxD, ye = y + dy * maxD;
  const i0 = Math.max(0, Math.floor((Math.min(x, xe) - ix.x0) / c)), i1 = Math.min(cols - 1, Math.floor((Math.max(x, xe) - ix.x0) / c));
  const j0 = Math.max(0, Math.floor((Math.min(y, ye) - ix.y0) / c)), j1 = Math.min(lins - 1, Math.floor((Math.max(y, ye) - ix.y0) / c));
  let melhor = maxD, achou = -1;
  for (let j = j0; j <= j1; j++)
    for (let i = i0; i <= i1; i++) {
      const b = j * cols + i;
      for (let k = ix.ini[b]; k < ix.ini[b + 1]; k++) {
        const s = ix.ids[k] * 4;
        const ax = seg[s], ay = seg[s + 1], ex = seg[s + 2] - ax, ey = seg[s + 3] - ay;
        const den = dx * ey - dy * ex;
        if (Math.abs(den) < 1e-12) continue;
        const wx = ax - x, wy = ay - y;
        const t = (wx * ey - wy * ex) / den, u = (wx * dy - wy * dx) / den;
        if (t > 1e-6 && t < melhor && u >= -1e-9 && u <= 1 + 1e-9) {
          melhor = t;
          achou = s;
        }
      }
    }
  if (achou < 0) return Infinity;
  const ex = seg[achou + 2] - seg[achou], ey = seg[achou + 3] - seg[achou + 1];
  return Math.abs(dx * ey - dy * ex) / Math.hypot(ex, ey) >= cosMin ? melhor : Infinity;
}

// ---------- pilha de paredes ----------

export interface ParamParedes {
  /** espaçamento (cobertura) da parede externa e das internas, nº de paredes por lado */
  sE: number;
  sI: number;
  voltas: number;
  /** cobertura mínima e máxima de um filete na largura variável */
  sMin: number;
  sMax: number;
  /** tamanho mínimo de detalhe (mais fino que isso não é impresso) */
  detMin: number;
  /** quantos filetes de dentro dividem a sobra (1 = só o mais de dentro; as externas ficam com a largura nominal) */
  distrib: number;
}

export interface Pilha {
  /** nº de filetes de lado a lado (0 = nada) */
  m: number;
  /** cobertura de cada parede de um lado, de fora para dentro */
  lados: number[];
  /** cobertura do filete do meio (nº ímpar de filetes), 0 se não houver */
  centro: number;
}

const nominais = (p: ParamParedes) => Array.from({ length: p.voltas }, (_, k) => (k === 0 ? p.sE : p.sI));
export const profundidade = (p: ParamParedes) => p.sE + (p.voltas - 1) * p.sI;

/** Pilha da largura variável para a espessura `T`; `mFixo` = nº de filetes já filtrado ao longo do caminho. */
export function pilhaVariavel(T: number, p: ParamParedes, mFixo?: number): Pilha {
  if (!(T >= p.detMin) || T <= 0) return { m: 0, lados: [], centro: 0 };
  const b = nominais(p), n = p.voltas;
  if (T >= 2 * profundidade(p) - 1e-9) return { m: 2 * n, lados: b, centro: 0 };
  const soma = (m: number) => {
    let s = 0;
    for (let k = 0; k < Math.floor(m / 2); k++) s += 2 * b[k];
    return m % 2 ? s + b[Math.floor(m / 2)] : s;
  };
  const tenta = (m: number) => {
    const L = Math.ceil(m / 2), l = b.slice(0, L);
    const K = Math.min(Math.max(1, p.distrib), L);
    let nb = 0;
    for (let k = L - K; k < L; k++) nb += k === L - 1 && m % 2 ? 1 : 2;
    const d = (T - soma(m)) / nb;
    for (let k = L - K; k < L; k++) l[k] += d;
    return l;
  };
  let m = mFixo ?? 0;
  if (!m) {
    let e = Infinity;
    for (let k = 1; k <= 2 * n; k++) {
      const x = Math.abs(T - soma(k));
      if (x < e - 1e-12) {
        e = x;
        m = k;
      }
    }
  }
  m = Math.max(1, Math.min(2 * n, m));
  let l = tenta(m);
  if (mFixo === undefined)
    for (let it = 0; it < 2 * n; it++) {
      const mn = Math.min(...l), mx = Math.max(...l);
      if (mn < p.sMin && m > 1) l = tenta(--m);
      else if (mx > p.sMax && m < 2 * n) l = tenta(++m);
      else break;
    }
  if (m === 1) return { m, lados: [], centro: T };
  return { m, lados: l.slice(0, Math.floor(m / 2)), centro: m % 2 ? l[l.length - 1] : 0 };
}

/** Profundidade que as paredes clássicas cobrem de um lado numa seção de espessura `T` (curvas de nível `niveis`). */
export function coberturaClassica(T: number, niveis: number[], p: ParamParedes): number {
  let cob = 0;
  const b = nominais(p);
  for (let k = 0; k < niveis.length; k++) if (T / 2 >= niveis[k] - 1e-9) cob = niveis[k] + b[k] / 2;
  return Math.min(cob, T / 2);
}

/** Posição (distância à borda) do centro da parede `k` de um lado da pilha. */
export function posicaoParede(p: Pilha, k: number): number {
  let s = 0;
  for (let i = 0; i < k; i++) s += p.lados[i];
  return s + p.lados[k] / 2;
}

// ---------- polilinhas ----------

/** Pontos a no máximo `passo` mm uns dos outros (mantém os vértices). */
export function reamostrar(p: ArrayLike<number>, fechado: boolean, passo: number): Float64Array {
  const n = p.length / 2, s: number[] = [];
  const lados = fechado ? n : n - 1;
  for (let a = 0; a < lados; a++) {
    const b = (a + 1) % n;
    const ax = p[a * 2], ay = p[a * 2 + 1], bx = p[b * 2], by = p[b * 2 + 1];
    const m = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / passo));
    for (let k = 0; k < m; k++) s.push(ax + ((bx - ax) * k) / m, ay + ((by - ay) * k) / m);
  }
  if (!fechado && n) s.push(p[n * 2 - 2], p[n * 2 - 1]);
  return Float64Array.from(s);
}

/** Normal para dentro do material (à esquerda do sentido do laço) em cada ponto. */
function normais(p: Float64Array, fechado: boolean): Float64Array {
  const n = p.length / 2, N = new Float64Array(n * 2);
  for (let k = 0; k < n; k++) {
    const a = fechado ? (k - 1 + n) % n : Math.max(0, k - 1), b = fechado ? (k + 1) % n : Math.min(n - 1, k + 1);
    const tx = p[b * 2] - p[a * 2], ty = p[b * 2 + 1] - p[a * 2 + 1], L = Math.hypot(tx, ty) || 1;
    N[k * 2] = -ty / L;
    N[k * 2 + 1] = tx / L;
  }
  return N;
}

/** Um caminho de parede gerado: pontos, se é laço, cobertura (espaçamento) e o tipo. */
export interface ParedeGerada {
  pts: Float64Array;
  fechado: boolean;
  /** cobertura (distância entre filetes vizinhos) */
  s: number;
  tipo: "parede" | "centro" | "vao";
  /** filete único (parte fina com um filete só): conta como parede externa */
  externa: boolean;
}

/**
 * Corta a sequência cíclica/aberta de pontos em pedaços: segmento k→k+1 vale se os dois pontos valem. Um trecho
 * contínuo mais curto que `minL` é descartado; dentro dele, um pedaço novo começa quando a cobertura muda mais que
 * `tolS` (ou o tipo de filete muda). Laço inteiro sem corte e sem mudança fica fechado.
 */
function pedacos(px: Float64Array, s: Float64Array, vale: Uint8Array, fechado: boolean, tolS: number, minL: number, tipo: ParedeGerada["tipo"], ext: (k: number) => boolean, saida: ParedeGerada[]) {
  const n = s.length, nseg = fechado ? n : n - 1;
  if (n < 2) return;
  const segOk = (k: number) => vale[k] && vale[(k + 1) % n];
  const sSeg = (k: number) => (s[k] + s[(k + 1) % n]) / 2;
  const Lseg = (k: number) => Math.hypot(px[((k + 1) % n) * 2] - px[k * 2], px[((k + 1) % n) * 2 + 1] - px[k * 2 + 1]);
  const muda = (a: number, k: number) => Math.abs(sSeg(k) - sSeg(a)) > tolS || ext(k) !== ext(a);
  if (fechado) {
    let todos = true;
    for (let k = 0; k < nseg && todos; k++) if (!segOk(k) || Math.abs(sSeg(k) - sSeg(0)) > tolS || ext(k) !== ext(0)) todos = false;
    if (todos) {
      let m = 0;
      for (let k = 0; k < nseg; k++) m += sSeg(k);
      if (comprimento(px, true) >= minL) saida.push({ pts: px, fechado: true, s: m / nseg, tipo, externa: ext(0) });
      return;
    }
  }
  // começo: depois de um segmento que não vale (ou, sem nenhum, numa mudança de cobertura)
  let ini = 0;
  if (fechado) {
    let achou = -1;
    for (let k = 0; k < nseg && achou < 0; k++) if (!segOk((k - 1 + nseg) % nseg) && segOk(k)) achou = k;
    for (let k = 0; k < nseg && achou < 0; k++) if (muda((k - 1 + nseg) % nseg, k)) achou = k;
    ini = Math.max(0, achou);
  }
  // trechos contínuos (só quebram onde a parede some)
  let t = 0;
  while (t < nseg) {
    while (t < nseg && !segOk((ini + t) % nseg)) t++;
    const t0 = t;
    let L = 0;
    while (t < nseg && segOk((ini + t) % nseg)) L += Lseg((ini + t++) % nseg);
    if (t === t0 || L < minL) continue;
    // pedaços de cobertura parecida
    let atual: number[] = [], sSoma = 0, Ls = 0, ref = -1;
    const fechar = () => {
      if (atual.length >= 4 && Ls > 0) saida.push({ pts: Float64Array.from(atual), fechado: false, s: sSoma / Ls, tipo, externa: ext(ref) });
    };
    for (let u = t0; u < t; u++) {
      const k = (ini + u) % nseg, k2 = (k + 1) % n;
      if (ref < 0 || muda(ref, k)) {
        fechar();
        atual = [px[k * 2], px[k * 2 + 1]];
        sSoma = Ls = 0;
        ref = k;
      }
      const l = Lseg(k);
      atual.push(px[k2 * 2], px[k2 * 2 + 1]);
      sSoma += sSeg(k) * l;
      Ls += l;
    }
    fechar();
  }
}

/** Filtro ao longo do caminho: trechos com o mesmo nº de filetes mais curtos que `filtro` mm herdam o vizinho. */
function filtrar(m: Int32Array, px: Float64Array, fechado: boolean, filtro: number) {
  const n = m.length;
  if (filtro <= 0 || n < 3) return;
  const comp = (a: number) => Math.hypot(px[((a + 1) % n) * 2] - px[a * 2], px[((a + 1) % n) * 2 + 1] - px[a * 2 + 1]);
  for (let volta = 0; volta < 3; volta++) {
    let mudou = false;
    let k = 0;
    // no laço, começa numa troca
    if (fechado) {
      let t = 0;
      while (t < n && m[(t - 1 + n) % n] === m[t]) t++;
      if (t === n) return;
      k = t;
    }
    for (let feitos = 0; feitos < n; ) {
      const a = (k + feitos) % n, v = m[a];
      let b = feitos, L = 0;
      while (b < n && m[(k + b) % n] === v) {
        L += comp((k + b) % n);
        b++;
      }
      const antes = m[(a - 1 + n) % n];
      const viz = fechado || feitos > 0 ? antes : b < n ? m[(k + b) % n] : v;
      if (L < filtro && viz !== v && v > 0 && viz > 0) {
        for (let t = feitos; t < b; t++) m[(k + t) % n] = viz;
        mudou = true;
      }
      feitos = b;
    }
    if (!mudou) break;
  }
}

// ---------- gerador da camada ----------

export interface OpcoesM1 {
  variavel: boolean;
  vaos: boolean;
  p: ParamParedes;
  /** curvas de nível das paredes clássicas (distância à borda de cada parede) */
  niveis: number[];
  /** cos do ângulo de transição */
  cosTrans: number;
  filtro: number;
  /** vão: cobertura mínima e máxima (acima disso o preenchimento cobre) */
  vaoMin: number;
  vaoMax: number;
  /** células com uma parede só (topo): as paredes internas são cortadas ali, fora das partes finas */
  umaParede: Uint8Array | null;
}

/** Gerador de uma camada: índice dos segmentos, grade e campo de distância da seção. */
export class GeradorM1 {
  private ix: Indice;
  readonly semPreench: Uint8Array;
  private reserva: Uint8Array;
  private D: number;

  constructor(seg: Float64Array, ns: number, private g: Grade, private o: OpcoesM1) {
    this.ix = indexar(seg, ns, 1);
    this.semPreench = new Uint8Array(g.cols * g.lins);
    this.reserva = new Uint8Array(g.cols * g.lins);
    this.D = profundidade(o.p);
  }

  /** Espessura local a partir de um ponto a `nivel` da borda, na normal (nx, ny); Infinity = parte grossa. */
  private espessura(x: number, y: number, nx: number, ny: number, nivel: number, ate: number) {
    const t = raio(this.ix, x, y, nx, ny, Math.max(0.01, ate - nivel), this.o.cosTrans);
    return t === Infinity ? Infinity : nivel + t;
  }

  /**
   * Laço da parede `k` (curva de nível `niveis[k]`): null = fica como no clássico; senão os pedaços (posição
   * ajustada e cobertura de cada trecho; trechos sem parede ficam de fora).
   */
  laco(pts: Float64Array, k: number): ParedeGerada[] | null {
    const o = this.o, nivel = o.niveis[k];
    const corta = o.umaParede && k >= 1;
    if (!o.variavel && !corta) return null;
    // ilha estreita da curva de nível junto ao eixo de uma parte fina (largura média 2·área/perímetro): na largura
    // variável quem cobre ali é o filete do meio
    if (o.variavel && (2 * Math.abs(areaLaco(pts))) / Math.max(1e-9, comprimento(pts, true)) < 0.35 * o.p.sI) return [];
    const p = reamostrar(pts, true, 0.25), n = p.length / 2, N = normais(p, true);
    const T = new Float64Array(n).fill(Infinity);
    let fino = false, cortado = false;
    if (o.variavel)
      for (let a = 0; a < n; a++) {
        T[a] = this.espessura(p[a * 2], p[a * 2 + 1], N[a * 2], N[a * 2 + 1], nivel, 2 * this.D);
        if (T[a] < 2 * this.D - 1e-9) fino = true;
      }
    const vale = new Uint8Array(n).fill(1), s = new Float64Array(n).fill(k === 0 ? o.p.sE : o.p.sI);
    if (corta)
      for (let a = 0; a < n; a++) {
        const q = celula(this.g, p[a * 2], p[a * 2 + 1]);
        if (T[a] >= 2 * this.D - 1e-9 && q >= 0 && o.umaParede![q]) {
          vale[a] = 0;
          cortado = true;
        }
      }
    if (!fino && !cortado) return null;
    const m = new Int32Array(n);
    for (let a = 0; a < n; a++) m[a] = T[a] < 2 * this.D - 1e-9 ? pilhaVariavel(T[a], o.p).m : 2 * o.p.voltas;
    filtrar(m, p, true, o.filtro);
    const q = new Float64Array(n * 2);
    for (let a = 0; a < n; a++) {
      q[a * 2] = p[a * 2];
      q[a * 2 + 1] = p[a * 2 + 1];
      if (!(T[a] < 2 * this.D - 1e-9)) continue;
      const pl = pilhaVariavel(T[a], o.p, m[a]);
      if (k >= pl.lados.length) {
        vale[a] = 0;
        continue;
      }
      const d = posicaoParede(pl, k) - nivel;
      q[a * 2] += N[a * 2] * d;
      q[a * 2 + 1] += N[a * 2 + 1] * d;
      s[a] = pl.lados[k];
    }
    const saida: ParedeGerada[] = [];
    pedacos(q, s, vale, true, 0.02, 1.5 * o.p.sI, "parede", () => false, saida);
    return saida;
  }

  /**
   * Filetes do meio (largura variável, nº ímpar de filetes) e vãos, a partir dos laços da sonda (curva de nível
   * rasa, que existe até nas partes mais finas). Marca as células dos vãos em `semPreench`.
   */
  centros(sonda: { pts: Float64Array }[], nivel: number): ParedeGerada[] {
    const o = this.o, g = this.g, saida: ParedeGerada[] = [];
    const ate = 2 * this.D + o.vaoMax;
    for (const l of sonda) {
      const p = reamostrar(l.pts, true, 0.2), n = p.length / 2, N = normais(p, true);
      const T = new Float64Array(n), m = new Int32Array(n);
      for (let a = 0; a < n; a++) {
        T[a] = this.espessura(p[a * 2], p[a * 2 + 1], N[a * 2], N[a * 2 + 1], nivel, ate);
        m[a] = o.variavel && T[a] < 2 * this.D - 1e-9 ? pilhaVariavel(T[a], o.p).m : 0;
      }
      if (o.variavel) filtrar(m, p, true, o.filtro);
      // tipo de cada ponto: 1 = filete do meio, 2 = filete único (externo), 3 = vão
      const tipo = new Uint8Array(n), s = new Float64Array(n), q = new Float64Array(n * 2);
      for (let a = 0; a < n; a++) {
        const t = T[a];
        if (!(t < ate) || t < o.p.detMin) continue;
        q[a * 2] = p[a * 2] + N[a * 2] * (t / 2 - nivel);
        q[a * 2 + 1] = p[a * 2 + 1] + N[a * 2 + 1] * (t / 2 - nivel);
        if (o.variavel && t < 2 * this.D - 1e-9) {
          const pl = pilhaVariavel(t, o.p, m[a] || undefined);
          if (pl.centro > 0) {
            tipo[a] = pl.m === 1 ? 2 : 1;
            s[a] = Math.max(pl.centro, pl.m === 1 ? o.p.sMin : 0);
          }
        } else if (o.vaos) {
          const v = t - 2 * (o.variavel ? this.D : coberturaClassica(t, o.niveis, o.p));
          if (v >= o.vaoMin && v < o.vaoMax) {
            tipo[a] = 3;
            s[a] = v;
          }
        }
      }
      // trechos seguidos do mesmo tipo (filete do meio 1/2 ou vão 3), um por vez: o que o outro lado da parte fina
      // já reservou é descartado
      const grupo = (a: number) => (tipo[a] === 3 ? 2 : tipo[a] ? 1 : 0);
      let ini = 0;
      while (ini < n && grupo(ini) === grupo((ini - 1 + n) % n)) ini++;
      const inteiro = ini === n;
      if (inteiro) ini = 0;
      for (let u = 0; u < n; ) {
        const a0 = (ini + u) % n, gr = grupo(a0);
        let len = 0;
        while (u + len < n && grupo((ini + u + len) % n) === gr) len++;
        u += len;
        if (!gr) continue;
        const fech = inteiro, m2 = fech ? n : len + (u < n || !inteiro ? 1 : 0);
        const cnt = Math.min(m2, n);
        const pq = new Float64Array(cnt * 2), ps = new Float64Array(cnt), pv = new Uint8Array(cnt), pt = new Uint8Array(cnt);
        for (let e = 0; e < cnt; e++) {
          const a = (a0 + e) % n;
          pq[e * 2] = q[a * 2];
          pq[e * 2 + 1] = q[a * 2 + 1];
          ps[e] = s[a];
          pt[e] = tipo[a];
          const c = celula(g, q[a * 2], q[a * 2 + 1]);
          pv[e] = grupo(a) === gr && c >= 0 && !this.reserva[c] ? 1 : 0;
        }
        const antes = saida.length;
        const vao = gr === 2;
        pedacos(pq, ps, pv, fech, 0.04, Math.max(0.6, 2 * o.p.sMin), vao ? "vao" : "centro", (k) => pt[k] === 2, saida);
        for (let e = antes; e < saida.length; e++) {
          const r = saida[e];
          if (!vao && !r.fechado) saida[e] = { ...r, pts: this.esticar(r.pts, r.s) };
          this.reservar(saida[e]);
        }
      }
    }
    return saida;
  }

  /** Estica as pontas do filete do meio até a ponta da parte fina (menos meia largura). */
  private esticar(p: Float64Array, s: number): Float64Array {
    const n = p.length / 2;
    if (n < 2) return p;
    const q = Float64Array.from(p);
    for (const [a, b] of [[0, 1], [n - 1, n - 2]]) {
      const dx = p[a * 2] - p[b * 2], dy = p[a * 2 + 1] - p[b * 2 + 1], L = Math.hypot(dx, dy);
      if (L < 1e-9) continue;
      const t = raio(this.ix, p[a * 2], p[a * 2 + 1], dx / L, dy / L, 3 * s, 0);
      if (t === Infinity) continue;
      const e = Math.max(0, t - s / 2);
      q[a * 2] += (dx / L) * e;
      q[a * 2 + 1] += (dy / L) * e;
    }
    return q;
  }

  /** Reserva as células cobertas pelo caminho (o outro lado da parte fina acha o mesmo eixo e é descartado). */
  private reservar(r: ParedeGerada) {
    const g = this.g, p = r.pts, n = p.length / 2;
    const raioC = Math.max(g.c, r.s / 2 + g.c / 2);
    const k = Math.ceil(raioC / g.c);
    const marcaVao = r.tipo === "vao";
    for (let a = 0; a < n; a++) {
      const cx = p[a * 2], cy = p[a * 2 + 1];
      for (let dj = -k; dj <= k; dj++)
        for (let di = -k; di <= k; di++) {
          if ((di * di + dj * dj) * g.c * g.c > raioC * raioC + 1e-12) continue;
          const q = celula(g, cx + di * g.c, cy + dj * g.c);
          if (q < 0) continue;
          this.reserva[q] = 1;
          if (marcaVao) this.semPreench[q] = 1;
        }
    }
  }
}
