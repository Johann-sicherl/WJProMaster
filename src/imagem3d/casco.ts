// Imagens → modelo 3D, fase 1 (docs/global/cad.md §5): casco visual pelas silhuetas.
// Cada foto (fundo liso) vira uma silhueta; as silhuetas das vistas ortogonais (e das duas
// diagonais) "esculpem" uma grade de voxels como uma fresa que tira tudo o que fica fora do
// contorno em cada direção. A grade guarda a fração coberta (0–255), não só dentro/fora, e a
// superfície sai pelas redes de superfície (surface nets) com posição sub-voxel: lisa, fechada,
// sem tabelas. Puro (sem DOM): roda no worker e é testado em scripts/teste-imagem3d.ts.
//
// Eixos do WJCAD (Y para cima): Frontal = XY, olhando de +Z para −Z. A peça fica apoiada em Y = 0
// e centrada em X e Z.

export type NomeVista = "frente" | "tras" | "esquerda" | "direita" | "cima" | "baixo" | "frenteEsq" | "frenteDir";

export const VISTAS: { nome: NomeVista; rotulo: string; dica: string }[] = [
  { nome: "frente", rotulo: "Frente", dica: "de frente para a peça" },
  { nome: "tras", rotulo: "Trás", dica: "pelo lado de trás" },
  { nome: "esquerda", rotulo: "Esquerda", dica: "pelo lado esquerdo (a frente fica à direita da foto)" },
  { nome: "direita", rotulo: "Direita", dica: "pelo lado direito (a frente fica à esquerda da foto)" },
  { nome: "cima", rotulo: "Cima", dica: "de cima, com a frente da peça embaixo na foto" },
  { nome: "baixo", rotulo: "Baixo", dica: "de baixo, com a frente da peça em cima na foto" },
  { nome: "frenteEsq", rotulo: "Frente-esquerda", dica: "a 45° entre a frente e a esquerda, na altura da peça" },
  { nome: "frenteDir", rotulo: "Frente-direita", dica: "a 45° entre a frente e a direita, na altura da peça" },
];

/** Silhueta: 1 = peça, 0 = fundo; caixa do contorno em pixels (inclusive). */
export interface Silhueta {
  w: number;
  h: number;
  m: Uint8Array;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

// ---------------------------------------------------------------------------------------------
// silhueta pelo fundo liso

/**
 * Separa a peça do fundo liso: a cor do fundo é a mediana da borda da foto e cada pixel mais
 * distante dela que `tolerancia` (0–255, distância RGB) é peça. Limpa sujeira (manchas menores que
 * 1% da maior parte) e reflexos dentro da peça (furinhos menores que 0,2% da peça); furos
 * passantes maiores ficam.
 */
export function silhuetaDaImagem(rgba: Uint8ClampedArray | Uint8Array, w: number, h: number, tolerancia: number): Silhueta {
  const n = w * h;
  // mediana da borda (2 pixels de cada lado)
  const borda: number[][] = [[], [], []];
  const pega = (x: number, y: number) => {
    const i = (y * w + x) * 4;
    borda[0].push(rgba[i]);
    borda[1].push(rgba[i + 1]);
    borda[2].push(rgba[i + 2]);
  };
  for (let x = 0; x < w; x++) for (const y of [0, 1, h - 2, h - 1]) if (y >= 0 && y < h) pega(x, y);
  for (let y = 2; y < h - 2; y++) for (const x of [0, 1, w - 2, w - 1]) if (x >= 0 && x < w) pega(x, y);
  const med = borda.map((c) => c.sort((a, b) => a - b)[c.length >> 1] ?? 255);
  const t2 = tolerancia * tolerancia;
  const m = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const dr = rgba[i * 4] - med[0], dg = rgba[i * 4 + 1] - med[1], db = rgba[i * 4 + 2] - med[2];
    m[i] = dr * dr + dg * dg + db * db > t2 ? 1 : 0;
  }
  // componentes (4-vizinhança) da peça e do fundo
  const rotulo = new Int32Array(n).fill(-1);
  const pilha = new Int32Array(n);
  const areas: number[] = [], valor: number[] = [], tocaBorda: boolean[] = [];
  for (let s = 0; s < n; s++) {
    if (rotulo[s] >= 0) continue;
    const c = areas.length, v = m[s];
    let topo = 0, area = 0, toca = false;
    pilha[topo++] = s;
    rotulo[s] = c;
    while (topo) {
      const p = pilha[--topo];
      area++;
      const x = p % w, y = (p / w) | 0;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) toca = true;
      if (x > 0 && rotulo[p - 1] < 0 && m[p - 1] === v) { rotulo[p - 1] = c; pilha[topo++] = p - 1; }
      if (x < w - 1 && rotulo[p + 1] < 0 && m[p + 1] === v) { rotulo[p + 1] = c; pilha[topo++] = p + 1; }
      if (y > 0 && rotulo[p - w] < 0 && m[p - w] === v) { rotulo[p - w] = c; pilha[topo++] = p - w; }
      if (y < h - 1 && rotulo[p + w] < 0 && m[p + w] === v) { rotulo[p + w] = c; pilha[topo++] = p + w; }
    }
    areas.push(area);
    valor.push(v);
    tocaBorda.push(toca);
  }
  let maior = 0;
  for (let c = 0; c < areas.length; c++) if (valor[c] === 1 && areas[c] > maior) maior = areas[c];
  if (!maior) throw new Error("Não achei a peça na foto: o fundo ocupa tudo. Diminua a tolerância ou use um fundo de cor diferente da peça.");
  let areaPeca = 0;
  for (let c = 0; c < areas.length; c++) if (valor[c] === 1 && areas[c] >= maior * 0.01) areaPeca += areas[c];
  const fica = new Uint8Array(areas.length);
  for (let c = 0; c < areas.length; c++)
    fica[c] = valor[c] === 1 ? (areas[c] >= maior * 0.01 ? 1 : 0) : !tocaBorda[c] && areas[c] < areaPeca * 0.002 ? 1 : 0;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let i = 0; i < n; i++) {
    m[i] = fica[rotulo[i]];
    if (m[i]) {
      const x = i % w, y = (i / w) | 0;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 - x0 < 3 || y1 - y0 < 3) throw new Error("A peça ficou pequena demais na foto (menos de 4 pixels).");
  return { w, h, m, x0, y0, x1, y1 };
}

// ---------------------------------------------------------------------------------------------
// medidas da peça a partir das proporções das silhuetas

export type Eixo = "largura" | "altura" | "profundidade";

/**
 * Largura (X), altura (Y) e profundidade (Z) pelas proporções das caixas das silhuetas (mínimos
 * quadrados em log, para combinar as vistas que repetem uma medida) e pela medida conhecida.
 */
export function medidas(vistas: Partial<Record<NomeVista, Silhueta>>, eixo: Eixo, valor: number): { W: number; H: number; D: number } {
  // incógnitas: lw = ln W, ld = ln D, com ln H = 0
  let a11 = 0, a12 = 0, a22 = 0, b1 = 0, b2 = 0;
  const eq = (c1: number, c2: number, r: number) => {
    a11 += c1 * c1;
    a12 += c1 * c2;
    a22 += c2 * c2;
    b1 += c1 * r;
    b2 += c2 * r;
  };
  for (const [nome, s] of Object.entries(vistas) as [NomeVista, Silhueta][]) {
    const r = Math.log((s.x1 + 1 - s.x0) / (s.y1 + 1 - s.y0));
    if (nome === "frente" || nome === "tras") eq(1, 0, r);
    else if (nome === "esquerda" || nome === "direita") eq(0, 1, r);
    else if (nome === "cima" || nome === "baixo") eq(1, -1, r);
  }
  const det = a11 * a22 - a12 * a12;
  if (Math.abs(det) < 1e-9)
    throw new Error("Faltam vistas: coloque pelo menos duas vistas em direções diferentes (frente ou trás, um lado, cima ou baixo).");
  const lw = (b1 * a22 - b2 * a12) / det, ld = (a11 * b2 - a12 * b1) / det;
  let W = Math.exp(lw), H = 1, D = Math.exp(ld);
  const k = valor / (eixo === "largura" ? W : eixo === "altura" ? H : D);
  W *= k;
  H *= k;
  D *= k;
  return { W, H, D };
}

// ---------------------------------------------------------------------------------------------
// cobertura das silhuetas (soma acumulada: média exata de um retângulo fracionário)

class Cobertura {
  private S: Float32Array;
  private sw: number;
  constructor(public s: Silhueta) {
    const { w, h, m } = s;
    this.sw = w + 1;
    const S = new Float32Array((w + 1) * (h + 1));
    for (let y = 0; y < h; y++) {
      let linha = 0;
      for (let x = 0; x < w; x++) {
        linha += m[y * w + x];
        S[(y + 1) * this.sw + x + 1] = S[y * this.sw + x + 1] + linha;
      }
    }
    this.S = S;
  }
  /** soma acumulada interpolada (exata para pixels constantes) */
  private I(x: number, y: number) {
    const { w, h } = this.s;
    x = x < 0 ? 0 : x > w ? w : x;
    y = y < 0 ? 0 : y > h ? h : y;
    const xi = Math.min(w - 1, Math.floor(x)), yi = Math.min(h - 1, Math.floor(y));
    const fx = x - xi, fy = y - yi, S = this.S, sw = this.sw;
    const a = S[yi * sw + xi], b = S[yi * sw + xi + 1], c = S[(yi + 1) * sw + xi], d = S[(yi + 1) * sw + xi + 1];
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  }
  /** fração de peça no retângulo [x0,x1]×[y0,y1] (pixels), alargado a 1,5 px (antisserrilhado) */
  media(x0: number, x1: number, y0: number, y1: number) {
    if (x1 - x0 < 1.5) { const c = (x0 + x1) / 2; x0 = c - 0.75; x1 = c + 0.75; }
    if (y1 - y0 < 1.5) { const c = (y0 + y1) / 2; y0 = c - 0.75; y1 = c + 0.75; }
    const area = (x1 - x0) * (y1 - y0);
    return (this.I(x1, y1) - this.I(x0, y1) - this.I(x1, y0) + this.I(x0, y0)) / area;
  }
}

// ---------------------------------------------------------------------------------------------
// grade de voxels

export interface Grade {
  /** fração coberta 0–255 nos pontos da grade (com uma camada vazia em volta) */
  f: Uint8Array;
  gx: number;
  gy: number;
  gz: number;
  /** lado da célula (mm) e posição do ponto (0,0,0) */
  v: number;
  o: [number, number, number];
}

/** Lado da grade (pontos ao longo da maior medida) que cabe na memória. */
export function resolucaoMaxima(W: number, H: number, D: number, maxPontos = 48e6) {
  const L = Math.max(W, H, D);
  return Math.max(16, Math.floor(Math.cbrt((maxPontos * L * L * L) / (W * H * D))) - 2);
}

export function esculpir(vistas: Partial<Record<NomeVista, Silhueta>>, dim: { W: number; H: number; D: number }, N: number): Grade {
  const { W, H, D } = dim;
  const v = Math.max(W, H, D) / N;
  const nx = Math.max(1, Math.ceil(W / v)), ny = Math.max(1, Math.ceil(H / v)), nz = Math.max(1, Math.ceil(D / v));
  const gx = nx + 2, gy = ny + 2, gz = nz + 2;
  // ponto i fica em o + i·v; os pontos 1..n cobrem a peça (centralizada na grade)
  const o: [number, number, number] = [-nx * v / 2 - v / 2, (H - ny * v) / 2 - v / 2, -nz * v / 2 - v / 2];
  const f = new Uint8Array(gx * gy * gz);
  const X = (i: number) => o[0] + i * v, Y = (j: number) => o[1] + j * v, Z = (k: number) => o[2] + k * v;
  const h = v / 2;

  // tabela 2D de cobertura (0–255) de uma vista ortogonal: u(a), t(b) dão a posição normalizada
  // (0–1) na caixa da silhueta para a coordenada do mundo
  const tabela = (s: Silhueta, na: number, nb: number, u: (a: number) => number, t: (b: number) => number) => {
    const c = new Cobertura(s);
    const bw = s.x1 + 1 - s.x0, bh = s.y1 + 1 - s.y0;
    const out = new Uint8Array(na * nb);
    for (let b = 1; b < nb - 1; b++) {
      const t0 = t(b - 0.5), t1 = t(b + 0.5);
      const py0 = s.y0 + Math.min(t0, t1) * bh, py1 = s.y0 + Math.max(t0, t1) * bh;
      for (let a = 1; a < na - 1; a++) {
        const u0 = u(a - 0.5), u1 = u(a + 0.5);
        const px0 = s.x0 + Math.min(u0, u1) * bw, px1 = s.x0 + Math.max(u0, u1) * bw;
        out[b * na + a] = Math.round(255 * c.media(px0, px1, py0, py1));
      }
    }
    return out;
  };
  const ux = (i: number) => (X(i) + W / 2) / W, uxi = (i: number) => (W / 2 - X(i)) / W;
  const vy = (j: number) => (H - Y(j)) / H;
  const uz = (k: number) => (Z(k) + D / 2) / D, uzi = (k: number) => (D / 2 - Z(k)) / D;
  const xy: Uint8Array[] = [], zy: Uint8Array[] = [], xz: Uint8Array[] = [];
  if (vistas.frente) xy.push(tabela(vistas.frente, gx, gy, ux, vy));
  if (vistas.tras) xy.push(tabela(vistas.tras, gx, gy, uxi, vy));
  if (vistas.esquerda) zy.push(tabela(vistas.esquerda, gz, gy, uz, vy));
  if (vistas.direita) zy.push(tabela(vistas.direita, gz, gy, uzi, vy));
  if (vistas.cima) xz.push(tabela(vistas.cima, gx, gz, ux, uz));
  if (vistas.baixo) xz.push(tabela(vistas.baixo, gx, gz, ux, uzi));
  const juntar = (ts: Uint8Array[], n: number) => {
    if (!ts.length) return null;
    const r = ts[0].slice();
    for (const t of ts.slice(1)) for (let i = 0; i < n; i++) if (t[i] < r[i]) r[i] = t[i];
    return r;
  };
  const tXY = juntar(xy, gx * gy), tZY = juntar(zy, gz * gy), tXZ = juntar(xz, gx * gz);
  for (let k = 1; k < gz - 1; k++)
    for (let j = 1; j < gy - 1; j++) {
      const base = (k * gy + j) * gx;
      const cz = tZY ? tZY[j * gz + k] : 255;
      for (let i = 1; i < gx - 1; i++) {
        let c = cz;
        if (tXY) { const a = tXY[j * gx + i]; if (a < c) c = a; }
        if (tXZ) { const a = tXZ[k * gx + i]; if (a < c) c = a; }
        f[base + i] = c;
      }
    }

  // vistas diagonais (45° em volta de Y): a escala vem da altura; o centro horizontal, da
  // projeção do que já foi esculpido
  for (const nome of ["frenteEsq", "frenteDir"] as const) {
    const s = vistas[nome];
    if (!s) continue;
    const rx = Math.SQRT1_2, rz = nome === "frenteEsq" ? Math.SQRT1_2 : -Math.SQRT1_2;
    let smin = Infinity, smax = -Infinity;
    for (let k = 1; k < gz - 1; k++)
      for (let i = 1; i < gx - 1; i++) {
        let tem = false;
        for (let j = 1; j < gy - 1 && !tem; j++) if (f[(k * gy + j) * gx + i] > 127) tem = true;
        if (!tem) continue;
        const sv = X(i) * rx + Z(k) * rz;
        if (sv < smin) smin = sv;
        if (sv > smax) smax = sv;
      }
    if (!(smax > smin)) continue;
    const c = new Cobertura(s);
    const bh = s.y1 + 1 - s.y0, mmPx = H / bh;
    const cxImg = (s.x0 + s.x1 + 1) / 2, sc = (smin + smax) / 2;
    // tabela por faixas de s (meia célula) × linhas da grade
    const passo = v / 2, s0 = X(0) * rx + Math.min(Z(0) * rz, Z(gz - 1) * rz) - v;
    const ns = Math.ceil((X(gx - 1) * rx + Math.max(Z(0) * rz, Z(gz - 1) * rz) + v - s0) / passo) + 1;
    const tab = new Uint8Array(ns * gy);
    const meia = h * (Math.abs(rx) + Math.abs(rz));
    for (let j = 1; j < gy - 1; j++) {
      const py0 = s.y0 + vy(j + 0.5) * bh, py1 = s.y0 + vy(j - 0.5) * bh;
      for (let b = 0; b < ns; b++) {
        const sv = s0 + b * passo;
        const px0 = cxImg + (sv - meia - sc) / mmPx, px1 = cxImg + (sv + meia - sc) / mmPx;
        tab[j * ns + b] = Math.round(255 * c.media(px0, px1, py0, py1));
      }
    }
    for (let k = 1; k < gz - 1; k++)
      for (let i = 1; i < gx - 1; i++) {
        const b = Math.round((X(i) * rx + Z(k) * rz - s0) / passo);
        for (let j = 1; j < gy - 1; j++) {
          const p = (k * gy + j) * gx + i, a = tab[j * ns + b];
          if (a < f[p]) f[p] = a;
        }
      }
  }
  return { f, gx, gy, gz, v, o };
}

// ---------------------------------------------------------------------------------------------
// superfície: redes de superfície (um vértice por célula cortada, um quadrilátero por aresta)

export interface MalhaCasco {
  pos: Float32Array;
  tri: Uint32Array;
}

export function superficie(g: Grade, iso = 127.5): MalhaCasco {
  const { f, gx, gy, gz, v, o } = g;
  const cx = gx - 1, cy = gy - 1;
  let pos = new Float32Array(1 << 16), np = 0;
  let tri = new Uint32Array(1 << 17), nt = 0;
  let ant = new Int32Array(cx * cy).fill(-1), atu = new Int32Array(cx * cy).fill(-1);
  const P = (i: number, j: number, k: number) => f[(k * gy + j) * gx + i];
  const quad = (a: number, b: number, c: number, d: number, inverte: boolean) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    if (nt + 6 > tri.length) { const t = new Uint32Array(tri.length * 2); t.set(tri); tri = t; }
    if (inverte) { const x = b; b = d; d = x; }
    tri[nt++] = a; tri[nt++] = b; tri[nt++] = c;
    tri[nt++] = a; tri[nt++] = c; tri[nt++] = d;
  };
  // 12 arestas da célula: pares de cantos (índice do canto = i + 2j + 4k)
  const AR = [0, 1, 2, 3, 4, 5, 6, 7, 0, 2, 1, 3, 4, 6, 5, 7, 0, 4, 1, 5, 2, 6, 3, 7];
  const val = new Float64Array(8);
  for (let k = 0; k < gz - 1; k++) {
    const t = ant; ant = atu; atu = t;
    atu.fill(-1);
    for (let j = 0; j < gy - 1; j++)
      for (let i = 0; i < gx - 1; i++) {
        let mascara = 0;
        for (let c = 0; c < 8; c++) {
          val[c] = P(i + (c & 1), j + ((c >> 1) & 1), k + (c >> 2));
          if (val[c] > iso) mascara |= 1 << c;
        }
        if (mascara === 0 || mascara === 255) continue;
        let sx = 0, sy = 0, sz = 0, n = 0;
        for (let e = 0; e < 24; e += 2) {
          const a = AR[e], b = AR[e + 1];
          const da = val[a] > iso, db = val[b] > iso;
          if (da === db) continue;
          const tt = (iso - val[a]) / (val[b] - val[a]);
          sx += (a & 1) + ((b & 1) - (a & 1)) * tt;
          sy += ((a >> 1) & 1) + (((b >> 1) & 1) - ((a >> 1) & 1)) * tt;
          sz += (a >> 2) + ((b >> 2) - (a >> 2)) * tt;
          n++;
        }
        if (np + 3 > pos.length) { const p = new Float32Array(pos.length * 2); p.set(pos); pos = p; }
        atu[j * cx + i] = np / 3;
        pos[np++] = o[0] + (i + sx / n) * v;
        pos[np++] = o[1] + (j + sy / n) * v;
        pos[np++] = o[2] + (k + sz / n) * v;
      }
    // arestas em Z que saem do plano k (células i-1..i, j-1..j da camada k)
    for (let j = 1; j < gy - 1; j++)
      for (let i = 1; i < gx - 1; i++) {
        const a = P(i, j, k) > iso, b = P(i, j, k + 1) > iso;
        if (a === b) continue;
        quad(atu[(j - 1) * cx + i - 1], atu[(j - 1) * cx + i], atu[j * cx + i], atu[j * cx + i - 1], !a);
      }
    if (k === 0) continue;
    // arestas em X e em Y no plano k (células das camadas k-1 e k)
    for (let j = 1; j < gy - 1; j++)
      for (let i = 0; i < gx - 1; i++) {
        const a = P(i, j, k) > iso, b = P(i + 1, j, k) > iso;
        if (a === b) continue;
        quad(ant[(j - 1) * cx + i], ant[j * cx + i], atu[j * cx + i], atu[(j - 1) * cx + i], !a);
      }
    for (let j = 0; j < gy - 1; j++)
      for (let i = 1; i < gx - 1; i++) {
        const a = P(i, j, k) > iso, b = P(i, j + 1, k) > iso;
        if (a === b) continue;
        quad(ant[j * cx + i - 1], atu[j * cx + i - 1], atu[j * cx + i], ant[j * cx + i], !a);
      }
  }
  return { pos: pos.slice(0, np), tri: tri.slice(0, nt) };
}

/** Suavização de Taubin (encolhe/estica): tira o degrau da grade sem encolher a peça. */
export function suavizar(m: MalhaCasco, passadas = 2) {
  const nv = m.pos.length / 3;
  const soma = new Float32Array(nv * 3), cont = new Uint16Array(nv);
  const passo = (fator: number) => {
    soma.fill(0);
    cont.fill(0);
    const { tri, pos } = m;
    for (let t = 0; t < tri.length; t += 3)
      for (let e = 0; e < 3; e++) {
        const a = tri[t + e], b = tri[t + ((e + 1) % 3)];
        for (let c = 0; c < 3; c++) {
          soma[a * 3 + c] += pos[b * 3 + c];
          soma[b * 3 + c] += pos[a * 3 + c];
        }
        cont[a]++;
        cont[b]++;
      }
    for (let i = 0; i < nv; i++) {
      if (!cont[i]) continue;
      for (let c = 0; c < 3; c++) pos[i * 3 + c] += fator * (soma[i * 3 + c] / cont[i] - pos[i * 3 + c]);
    }
  };
  for (let p = 0; p < passadas; p++) {
    passo(0.5);
    passo(-0.53);
  }
}

/** STL binário da malha. */
export function stlBinario(m: MalhaCasco, nome = "WJCAD imagens para 3D"): Uint8Array {
  const nt = m.tri.length / 3;
  const out = new Uint8Array(84 + 50 * nt);
  const dv = new DataView(out.buffer);
  for (let i = 0; i < Math.min(80, nome.length); i++) out[i] = nome.charCodeAt(i) & 0x7f;
  dv.setUint32(80, nt, true);
  const { pos, tri } = m;
  for (let t = 0; t < nt; t++) {
    const a = tri[t * 3] * 3, b = tri[t * 3 + 1] * 3, c = tri[t * 3 + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    const o = 84 + t * 50;
    dv.setFloat32(o, nx, true);
    dv.setFloat32(o + 4, ny, true);
    dv.setFloat32(o + 8, nz, true);
    for (const [j, p] of [a, b, c].entries())
      for (let e = 0; e < 3; e++) dv.setFloat32(o + 12 + (j * 3 + e) * 4, pos[p + e], true);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// tudo junto, com a quantidade de faces pedida

export const FACES = [1_500_000, 1_000_000, 500_000, 50_000] as const;

export interface ResultadoCasco {
  malha: MalhaCasco;
  dim: { W: number; H: number; D: number };
  N: number;
}

/**
 * Esculpe e escolhe a resolução da grade para chegar perto de `alvo` triângulos (por cima: a
 * redução fina até o número pedido é feita depois, no STL). `aviso` recebe o andamento.
 */
export function gerarCasco(
  vistas: Partial<Record<NomeVista, Silhueta>>,
  medida: { eixo: Eixo; valor: number },
  alvo: number,
  aviso: (t: string) => void = () => {},
  maxPontos = 48e6,
): ResultadoCasco {
  const dim = medidas(vistas, medida.eixo, medida.valor);
  const Nmax = resolucaoMaxima(dim.W, dim.H, dim.D, maxPontos);
  const rodar = (N: number) => {
    aviso(`Esculpindo a grade ${N} …`);
    const g = esculpir(vistas, dim, N);
    aviso("Gerando a superfície…");
    return superficie(g);
  };
  let N = Math.min(64, Nmax);
  let m = rodar(N);
  for (let r = 0; r < 2; r++) {
    const n = m.tri.length / 3;
    if (!n) throw new Error("As silhuetas não se cruzam: confira se cada foto está na vista certa.");
    if (n >= alvo || N >= Nmax) break;
    const novo = Math.min(Nmax, Math.max(N + 1, Math.round(N * Math.sqrt((alvo * 1.06) / n))));
    if (novo === N) break;
    N = novo;
    m = rodar(N);
  }
  aviso("Suavizando…");
  suavizar(m);
  return { malha: m, dim, N };
}
