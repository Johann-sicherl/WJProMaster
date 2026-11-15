// WJSlicer3D: geometria 2D de cada camada numa grade (código próprio).
// A seção da camada vira um campo de distância com sinal (positivo dentro do material). Daí saem,
// sem operações booleanas de polígonos (que quebram fácil em malhas reais):
// - os contornos deslocados para dentro (paredes) e para fora (borda), como curvas de nível do campo;
// - o recorte de linhas e curvas de preenchimento pela região (amostrando o campo ao longo da linha);
// - os mapas por célula (dentro/fora, tipo de preenchimento, suporte) e as ilhas da camada.
// Puro (sem DOM): roda no worker e em Node (scripts/teste-slicer.ts).

/** Grade da peça: célula (i, j) com centro em (x0 + (i + ½)c, y0 + (j + ½)c); índice j·cols + i. */
export interface Grade {
  x0: number;
  y0: number;
  c: number;
  cols: number;
  lins: number;
}

/** Índice da célula que contém (x, y), ou -1 fora da grade. */
export function celula(g: Grade, x: number, y: number): number {
  const i = Math.floor((x - g.x0) / g.c), j = Math.floor((y - g.y0) / g.c);
  return i < 0 || j < 0 || i >= g.cols || j >= g.lins ? -1 : j * g.cols + i;
}

/**
 * Mapa dentro/fora da seção pela varredura par/ímpar nos centros das linhas da grade.
 * `seg`: segmentos do corte (x1, y1, x2, y2 …), `ns` segmentos.
 */
export function rasterizar(seg: Float64Array, ns: number, g: Grade, saida?: Uint8Array): Uint8Array {
  const { cols, lins, c, x0, y0 } = g;
  const m = saida ?? new Uint8Array(cols * lins);
  m.fill(0);
  const cont = new Int32Array(lins + 1);
  const faixa = (s: number): [number, number] => {
    const a = seg[s * 4 + 1], b = seg[s * 4 + 3];
    const lo = Math.min(a, b), hi = Math.max(a, b);
    return [Math.max(0, Math.ceil((lo - y0) / c - 0.5)), Math.min(lins - 1, Math.ceil((hi - y0) / c - 0.5) - 1)];
  };
  for (let s = 0; s < ns; s++) {
    const [r0, r1] = faixa(s);
    for (let r = r0; r <= r1; r++) cont[r + 1]++;
  }
  for (let r = 0; r < lins; r++) cont[r + 1] += cont[r];
  const xs = new Float64Array(cont[lins]);
  const enc = cont.slice(0, lins);
  for (let s = 0; s < ns; s++) {
    const [r0, r1] = faixa(s);
    const ax = seg[s * 4], ay = seg[s * 4 + 1], bx = seg[s * 4 + 2], by = seg[s * 4 + 3];
    for (let r = r0; r <= r1; r++) {
      const yc = y0 + (r + 0.5) * c;
      xs[enc[r]++] = ax + ((yc - ay) * (bx - ax)) / (by - ay);
    }
  }
  for (let r = 0; r < lins; r++) {
    const fila = xs.subarray(cont[r], cont[r + 1]).sort();
    for (let k = 0; k + 1 < fila.length; k += 2) {
      const c0 = Math.max(0, Math.ceil((fila[k] - x0) / c - 0.5)), c1 = Math.min(cols - 1, Math.ceil((fila[k + 1] - x0) / c - 0.5) - 1);
      if (c1 >= c0) m.fill(1, r * cols + c0, r * cols + c1 + 1);
    }
  }
  return m;
}

/** Mapa de bytes ↔ mapa de bits (guardar todas as camadas sem estourar a memória do tablet). */
export function compactar(m: Uint8Array): Uint32Array {
  const b = new Uint32Array((m.length + 31) >>> 5);
  for (let k = 0; k < m.length; k++) if (m[k]) b[k >>> 5] |= 1 << (k & 31);
  return b;
}
export function expandir(b: Uint32Array, n: number, saida?: Uint8Array): Uint8Array {
  const m = saida ?? new Uint8Array(n);
  for (let k = 0; k < n; k++) m[k] = (b[k >>> 5] >>> (k & 31)) & 1;
  return m;
}

/** Distância de (px, py) ao segmento (ax, ay)–(bx, by): devolve o ponto mais próximo em `pt`. */
function maisProximo(px: number, py: number, ax: number, ay: number, bx: number, by: number, pt: number[]) {
  const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
  let t = L2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / L2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  pt[0] = ax + t * dx;
  pt[1] = ay + t * dy;
}

/**
 * Campo de distância com sinal até o contorno da seção (positivo dentro). Células junto aos
 * segmentos recebem a distância exata ao segmento; o resto, por propagação do ponto mais próximo
 * em duas varreduras da grade (distância euclidiana, erro de fração de célula).
 */
export function campoDistancia(seg: Float64Array, ns: number, dentro: Uint8Array, g: Grade, saida?: Float32Array, banda = Infinity): Float32Array {
  const { cols, lins, c } = g;
  const n = cols * lins;
  // só a caixa dos segmentos mais `banda` mm precisa de distância (fora dela tudo é "fora, longe")
  let sx0 = Infinity, sy0 = Infinity, sx1 = -Infinity, sy1 = -Infinity;
  for (let k = 0; k < ns * 4; k += 2) {
    if (seg[k] < sx0) sx0 = seg[k];
    if (seg[k] > sx1) sx1 = seg[k];
    if (seg[k + 1] < sy0) sy0 = seg[k + 1];
    if (seg[k + 1] > sy1) sy1 = seg[k + 1];
  }
  const ci0 = Math.max(0, Math.floor((sx0 - banda - g.x0) / c) - 1), ci1 = Math.min(cols - 1, Math.ceil((sx1 + banda - g.x0) / c) + 1);
  const cj0 = Math.max(0, Math.floor((sy0 - banda - g.y0) / c) - 1), cj1 = Math.min(lins - 1, Math.ceil((sy1 + banda - g.y0) / c) + 1);
  // ponto "muito longe" nas células ainda sem informação (a propagação não precisa testar)
  const px = new Float32Array(n).fill(1e9), py = new Float32Array(n).fill(1e9), d2 = new Float32Array(n).fill(Infinity);
  const pt = [0, 0];
  for (let s = 0; s < ns; s++) {
    const ax = seg[s * 4], ay = seg[s * 4 + 1], bx = seg[s * 4 + 2], by = seg[s * 4 + 3];
    const L = Math.hypot(bx - ax, by - ay);
    const passos = Math.max(1, Math.ceil(L / (0.5 * c)));
    let ultimo = -1;
    for (let k = 0; k <= passos; k++) {
      const x = ax + ((bx - ax) * k) / passos, y = ay + ((by - ay) * k) / passos;
      const i = Math.floor((x - g.x0) / c), j = Math.floor((y - g.y0) / c);
      const id = j * cols + i;
      if (id === ultimo) continue;
      ultimo = id;
      for (let jj = j - 1; jj <= j + 1; jj++) {
        if (jj < 0 || jj >= lins) continue;
        for (let ii = i - 1; ii <= i + 1; ii++) {
          if (ii < 0 || ii >= cols) continue;
          const cx = g.x0 + (ii + 0.5) * c, cy = g.y0 + (jj + 0.5) * c;
          maisProximo(cx, cy, ax, ay, bx, by, pt);
          const dd = (pt[0] - cx) ** 2 + (pt[1] - cy) ** 2;
          const q = jj * cols + ii;
          if (dd < d2[q]) {
            d2[q] = dd;
            px[q] = pt[0];
            py[q] = pt[1];
          }
        }
      }
    }
  }
  // propagação: cada célula testa o ponto mais próximo dos vizinhos já visitados (duas varreduras;
  // sem funções internas: este laço é o mais quente do fatiamento)
  const x0 = g.x0 + 0.5 * c, y0 = g.y0 + 0.5 * c;
  for (let j = cj0; j <= cj1; j++) {
    const cy = y0 + j * c, o = j * cols;
    for (let i = ci0; i <= ci1; i++) {
      const q = o + i, cx = x0 + i * c;
      let best = d2[q], bx = px[q], by = py[q];
      if (i > ci0) {
        {
          const v = q - 1;
          const ex = px[v] - cx, ey = py[v] - cy, dd = ex * ex + ey * ey;
          if (dd < best) { best = dd; bx = px[v]; by = py[v]; }
        }
      }
      if (j > cj0) {
        {
          const v = q - cols;
          const ex = px[v] - cx, ey = py[v] - cy, dd = ex * ex + ey * ey;
          if (dd < best) { best = dd; bx = px[v]; by = py[v]; }
        }
        if (i > ci0) {
        {
          const v = q - cols - 1;
          const ex = px[v] - cx, ey = py[v] - cy, dd = ex * ex + ey * ey;
          if (dd < best) { best = dd; bx = px[v]; by = py[v]; }
        }
        }
        if (i < ci1) {
        {
          const v = q - cols + 1;
          const ex = px[v] - cx, ey = py[v] - cy, dd = ex * ex + ey * ey;
          if (dd < best) { best = dd; bx = px[v]; by = py[v]; }
        }
        }
      }
        if (best < d2[q]) { d2[q] = best; px[q] = bx; py[q] = by; }
    }
    for (let i = ci1 - 1; i >= ci0; i--) {
      const q = o + i, cx = x0 + i * c;
      let best = d2[q], bx = px[q], by = py[q];
        {
          const v = q + 1;
          const ex = px[v] - cx, ey = py[v] - cy, dd = ex * ex + ey * ey;
          if (dd < best) { best = dd; bx = px[v]; by = py[v]; }
        }
        if (best < d2[q]) { d2[q] = best; px[q] = bx; py[q] = by; }
    }
  }
  for (let j = cj1; j >= cj0; j--) {
    const cy = y0 + j * c, o = j * cols;
    for (let i = ci1; i >= ci0; i--) {
      const q = o + i, cx = x0 + i * c;
      let best = d2[q], bx = px[q], by = py[q];
      if (i < ci1) {
        {
          const v = q + 1;
          const ex = px[v] - cx, ey = py[v] - cy, dd = ex * ex + ey * ey;
          if (dd < best) { best = dd; bx = px[v]; by = py[v]; }
        }
      }
      if (j < cj1) {
        {
          const v = q + cols;
          const ex = px[v] - cx, ey = py[v] - cy, dd = ex * ex + ey * ey;
          if (dd < best) { best = dd; bx = px[v]; by = py[v]; }
        }
        if (i < ci1) {
        {
          const v = q + cols + 1;
          const ex = px[v] - cx, ey = py[v] - cy, dd = ex * ex + ey * ey;
          if (dd < best) { best = dd; bx = px[v]; by = py[v]; }
        }
        }
        if (i > ci0) {
        {
          const v = q + cols - 1;
          const ex = px[v] - cx, ey = py[v] - cy, dd = ex * ex + ey * ey;
          if (dd < best) { best = dd; bx = px[v]; by = py[v]; }
        }
        }
      }
        if (best < d2[q]) { d2[q] = best; px[q] = bx; py[q] = by; }
    }
    for (let i = ci0 + 1; i <= ci1; i++) {
      const q = o + i, cx = x0 + i * c;
      let best = d2[q], bx = px[q], by = py[q];
        {
          const v = q - 1;
          const ex = px[v] - cx, ey = py[v] - cy, dd = ex * ex + ey * ey;
          if (dd < best) { best = dd; bx = px[v]; by = py[v]; }
        }
        if (best < d2[q]) { d2[q] = best; px[q] = bx; py[q] = by; }
    }
  }
  const f = saida ?? new Float32Array(n);
  const longe = (cols + lins) * c;
  for (let q = 0; q < n; q++) {
    const d = Math.min(longe, Math.sqrt(d2[q]));
    f[q] = dentro[q] ? d : -d;
  }
  return f;
}

/**
 * Campo de distância de um mapa de células (suporte, galhos): o contorno fica no meio do caminho
 * entre célula cheia e vazia. Mesmo método do campo da seção.
 */
export function campoDoMapa(m: Uint8Array, g: Grade, saida?: Float32Array): Float32Array {
  const { cols, lins, c } = g;
  // bordas entre células cheias e vazias viram segmentos (lados das células)
  const seg: number[] = [];
  for (let j = 0; j < lins; j++)
    for (let i = 0; i < cols; i++) {
      const q = j * cols + i;
      if (!m[q]) continue;
      const x = g.x0 + i * c, y = g.y0 + j * c;
      if (i === 0 || !m[q - 1]) seg.push(x, y, x, y + c);
      if (i + 1 === cols || !m[q + 1]) seg.push(x + c, y, x + c, y + c);
      if (j === 0 || !m[q - cols]) seg.push(x, y, x + c, y);
      if (j + 1 === lins || !m[q + cols]) seg.push(x, y + c, x + c, y + c);
    }
  return campoDistancia(Float64Array.from(seg), seg.length / 4, m, g, saida);
}

/** Valor do campo em (x, y) por interpolação bilinear dos centros das células. */
export function amostrar(f: Float32Array, g: Grade, x: number, y: number): number {
  let u = (x - g.x0) / g.c - 0.5, v = (y - g.y0) / g.c - 0.5;
  if (u < 0) u = 0;
  else if (u > g.cols - 1.0001) u = g.cols - 1.0001;
  if (v < 0) v = 0;
  else if (v > g.lins - 1.0001) v = g.lins - 1.0001;
  const i = Math.floor(u), j = Math.floor(v), fu = u - i, fv = v - j;
  const q = j * g.cols + i;
  const a = f[q], b = f[q + 1], cc = f[q + g.cols], d = f[q + g.cols + 1];
  return a + (b - a) * fu + (cc - a) * fv + (a - b - cc + d) * fu * fv;
}

/** Laço: pontos (x, y …), se é fechado e área com sinal (positiva = contorno externo, negativa = furo). */
export interface Laco {
  pts: Float64Array;
  area: number;
  fechado: boolean;
}

export function areaLaco(p: ArrayLike<number>): number {
  let a = 0;
  const n = p.length / 2;
  for (let k = 0, m = n - 1; k < n; m = k++) a += p[m * 2] * p[k * 2 + 1] - p[k * 2] * p[m * 2 + 1];
  return a / 2;
}

export function comprimento(p: ArrayLike<number>, fechado: boolean): number {
  let L = 0;
  const n = p.length / 2;
  for (let k = 1; k < n; k++) L += Math.hypot(p[k * 2] - p[k * 2 - 2], p[k * 2 + 1] - p[k * 2 - 1]);
  if (fechado && n > 1) L += Math.hypot(p[0] - p[n * 2 - 2], p[1] - p[n * 2 - 1]);
  return L;
}

let bufArestas = new Int32Array(0);

/**
 * Curvas de nível `nivel` do campo (marcha dos quadrados), já encadeadas em laços fechados com o
 * material à esquerda (externo anti-horário, furo horário) e simplificadas com tolerância `tol`.
 * `abertos`: devolve também as curvas que saem da grade (padrões de preenchimento).
 */
export function contornos(f: Float32Array, g: Grade, nivel: number, tol = 0.0125, abertos = false): Laco[] {
  const { cols, lins, c } = g;
  const nA = 2 * cols * lins;
  if (bufArestas.length < nA) bufArestas = new Int32Array(nA).fill(-1);
  const inicioDe = bufArestas;
  const sIni: number[] = [], sFim: number[] = [], sx: number[] = [], sy: number[] = [];
  const pontoNa = (aresta: number, out: number[]) => {
    const q = aresta >> 1, i = q % cols, j = (q / cols) | 0;
    const va = f[q] - nivel;
    if ((aresta & 1) === 0) {
      const vb = f[q + 1] - nivel, t = va / (va - vb);
      out[0] = g.x0 + (i + 0.5 + t) * c;
      out[1] = g.y0 + (j + 0.5) * c;
    } else {
      const vb = f[q + cols] - nivel, t = va / (va - vb);
      out[0] = g.x0 + (i + 0.5) * c;
      out[1] = g.y0 + (j + 0.5 + t) * c;
    }
  };
  const p = [0, 0], q2 = [0, 0];
  // cantos: 0 = (i, j), 1 = (i+1, j), 2 = (i+1, j+1), 3 = (i, j+1); arestas: 0 baixo, 1 direita, 2 cima, 3 esquerda
  const arestasDoCanto = [[3, 0], [0, 1], [1, 2], [2, 3]];
  const ids = [0, 0, 0, 0], v = [0, 0, 0, 0], cx = [0, 0, 0, 0], cy = [0, 0, 0, 0];
  const segmento = (ea: number, eb: number, canto: number, cantoDentro: boolean) => {
    pontoNa(ids[ea], p);
    pontoNa(ids[eb], q2);
    let a = ea, b = eb;
    const cr = (q2[0] - p[0]) * (cy[canto] - p[1]) - (q2[1] - p[1]) * (cx[canto] - p[0]);
    if (cr > 0 !== cantoDentro) {
      a = eb;
      b = ea;
    }
    if (inicioDe[ids[a]] >= 0) return; // degenerado (não deve ocorrer)
    inicioDe[ids[a]] = sIni.length;
    sIni.push(ids[a]);
    sFim.push(ids[b]);
    pontoNa(ids[a], p);
    sx.push(p[0]);
    sy.push(p[1]);
  };
  for (let j = 0; j + 1 < lins; j++) {
    for (let i = 0; i + 1 < cols; i++) {
      const q = j * cols + i;
      v[0] = f[q] - nivel;
      v[1] = f[q + 1] - nivel;
      v[2] = f[q + cols + 1] - nivel;
      v[3] = f[q + cols] - nivel;
      const caso = (v[0] > 0 ? 1 : 0) | (v[1] > 0 ? 2 : 0) | (v[2] > 0 ? 4 : 0) | (v[3] > 0 ? 8 : 0);
      if (caso === 0 || caso === 15) continue;
      ids[0] = 2 * q;
      ids[1] = 2 * (q + 1) + 1;
      ids[2] = 2 * (q + cols);
      ids[3] = 2 * q + 1;
      const x = g.x0 + (i + 0.5) * c, y = g.y0 + (j + 0.5) * c;
      cx[0] = x; cy[0] = y; cx[1] = x + c; cy[1] = y; cx[2] = x + c; cy[2] = y + c; cx[3] = x; cy[3] = y + c;
      if (caso === 5 || caso === 10) {
        // sela: o centro decide se os cantos de dentro se ligam
        const centro = (v[0] + v[1] + v[2] + v[3]) / 4 > 0;
        for (let k = 0; k < 4; k++) {
          const dentroK = v[k] > 0;
          if (dentroK === centro) continue;
          segmento(arestasDoCanto[k][0], arestasDoCanto[k][1], k, dentroK);
        }
      } else {
        const cruz: number[] = [];
        for (let e = 0; e < 4; e++) {
          const a = e, b = (e + 1) % 4; // arestas: 0 = cantos 0–1, 1 = 1–2, 2 = 3–2, 3 = 0–3
          const ca = e === 2 ? 3 : e === 3 ? 0 : a, cb = e === 2 ? 2 : e === 3 ? 3 : b;
          if (v[ca] > 0 !== v[cb] > 0) cruz.push(e);
        }
        let canto = 0;
        while (!(v[canto] > 0)) canto++;
        segmento(cruz[0], cruz[1], canto, true);
      }
    }
  }
  // encadeia (curvas abertas começam pelas pontas: segmento sem anterior)
  const ns = sIni.length;
  const visto = new Uint8Array(ns);
  const temAnterior = new Uint8Array(ns);
  for (let s = 0; s < ns; s++) {
    const prox = inicioDe[sFim[s]];
    if (prox >= 0) temAnterior[prox] = 1;
  }
  const lacos: Laco[] = [];
  const pts: number[] = [];
  const percorrer = (s0: number) => {
    pts.length = 0;
    let s = s0, fechado = false;
    while (!visto[s]) {
      visto[s] = 1;
      pts.push(sx[s], sy[s]);
      const prox = inicioDe[sFim[s]];
      if (prox < 0) {
        // ponta solta: o último ponto fica na aresta de saída
        pontoNa(sFim[s], p);
        pts.push(p[0], p[1]);
        break;
      }
      if (prox === s0) fechado = true;
      s = prox;
    }
    if (fechado ? pts.length < 6 : !abertos || pts.length < 4) return;
    const simp = simplificar(pts, tol, fechado);
    if (simp.length < (fechado ? 6 : 4)) return;
    lacos.push({ pts: simp, area: fechado ? areaLaco(simp) : 0, fechado });
  };
  for (let s0 = 0; s0 < ns; s0++) if (!visto[s0] && !temAnterior[s0]) percorrer(s0);
  for (let s0 = 0; s0 < ns; s0++) if (!visto[s0]) percorrer(s0);
  for (let s = 0; s < ns; s++) inicioDe[sIni[s]] = -1;
  return lacos;
}

/** Simplificação de polilinha (Douglas–Peucker); laço fechado: corta entre o 1º ponto e o mais distante. */
export function simplificar(p: ArrayLike<number>, tol: number, fechado: boolean): Float64Array {
  const n = p.length / 2;
  if (n <= 2) return Float64Array.from(p as ArrayLike<number>);
  const manter = new Uint8Array(n);
  const tol2 = tol * tol;
  const dp = (a: number, b: number) => {
    const pilha = [a, b];
    while (pilha.length) {
      const fim = pilha.pop()!, ini = pilha.pop()!;
      if (fim - ini < 2) continue;
      const ax = p[ini * 2], ay = p[ini * 2 + 1], bx = p[(fim % n) * 2], by = p[(fim % n) * 2 + 1];
      const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
      let maior = -1, idx = -1;
      for (let k = ini + 1; k < fim; k++) {
        const x = p[k * 2] - ax, y = p[k * 2 + 1] - ay;
        let d: number;
        if (L2 > 1e-18) {
          const cr = x * dy - y * dx;
          d = (cr * cr) / L2;
        } else d = x * x + y * y;
        if (d > maior) {
          maior = d;
          idx = k;
        }
      }
      if (maior > tol2) {
        manter[idx] = 1;
        pilha.push(ini, idx, idx, fim);
      }
    }
  };
  manter[0] = 1;
  if (fechado) {
    let longe = 0, dmax = -1;
    for (let k = 1; k < n; k++) {
      const d = (p[k * 2] - p[0]) ** 2 + (p[k * 2 + 1] - p[1]) ** 2;
      if (d > dmax) {
        dmax = d;
        longe = k;
      }
    }
    manter[longe] = 1;
    dp(0, longe);
    dp(longe, n);
  } else {
    manter[n - 1] = 1;
    dp(0, n - 1);
  }
  let m = 0;
  for (let k = 0; k < n; k++) m += manter[k];
  const out = new Float64Array(m * 2);
  let o = 0;
  for (let k = 0; k < n; k++)
    if (manter[k]) {
      out[o++] = p[k * 2];
      out[o++] = p[k * 2 + 1];
    }
  return out;
}

/**
 * Recorta uma polilinha pela região: campo `f` ≥ `nivel` (se houver campo) e, se houver mapa de
 * classes, célula com classe `alvo`. Devolve os trechos de dentro (polilinhas abertas). A borda do
 * campo é achada por interpolação entre amostras; a do mapa, no meio das amostras (resolução de célula).
 */
export function recortar(
  p: ArrayLike<number>, g: Grade, f: Float32Array | null, nivel: number, classe: Uint8Array | null, alvo: number, saida: number[][],
) {
  const n = p.length / 2;
  if (n < 2) return;
  const passo = g.c * 0.5;
  let atual: number[] | null = null;
  let ux = p[0], uy = p[1];
  let ufv = f ? amostrar(f, g, ux, uy) - nivel : 1;
  const classeOk = (x: number, y: number) => {
    if (!classe) return true;
    const q = celula(g, x, y);
    return q >= 0 && classe[q] === alvo;
  };
  let uDentro = ufv >= 0 && classeOk(ux, uy);
  if (uDentro) atual = [ux, uy];
  for (let k = 1; k < n; k++) {
    const bx = p[k * 2], by = p[k * 2 + 1];
    const ax = p[k * 2 - 2], ay = p[k * 2 - 1];
    const L = Math.hypot(bx - ax, by - ay);
    const m = Math.max(1, Math.ceil(L / passo));
    for (let s = 1; s <= m; s++) {
      const x = ax + ((bx - ax) * s) / m, y = ay + ((by - ay) * s) / m;
      const fv = f ? amostrar(f, g, x, y) - nivel : 1;
      const dentro = fv >= 0 && classeOk(x, y);
      if (dentro !== uDentro) {
        // ponto de troca: pelo campo (interpolado) ou, se o campo não mudou de sinal, no meio
        let t = 0.5;
        if ((fv >= 0) !== (ufv >= 0)) t = ufv / (ufv - fv);
        const tx = ux + (x - ux) * t, ty = uy + (y - uy) * t;
        if (dentro) atual = [tx, ty];
        else if (atual) {
          atual.push(tx, ty);
          saida.push(atual);
          atual = null;
        }
      }
      if (dentro && atual && s === m) atual.push(x, y);
      ux = x;
      uy = y;
      ufv = fv;
      uDentro = dentro;
    }
  }
  if (atual && atual.length >= 4) saida.push(atual);
}

/** Ilhas (componentes ligados em cruz) do mapa: rótulo por célula (0 = vazio) e quantas. */
export function rotular(m: Uint8Array, g: Grade, saida?: Int32Array): { rot: Int32Array; n: number; celulas: number[] } {
  const { cols, lins } = g;
  const N = cols * lins;
  const rot = saida ?? new Int32Array(N);
  rot.fill(0);
  if (pilhaRot.length < N) pilhaRot = new Int32Array(N);
  const pilha = pilhaRot;
  const celulas: number[] = [0];
  let n = 0;
  for (let q0 = 0; q0 < N; q0++) {
    if (!m[q0] || rot[q0]) continue;
    n++;
    let conta = 0, topo = 0;
    rot[q0] = n;
    pilha[topo++] = q0;
    while (topo) {
      const q = pilha[--topo];
      conta++;
      const i = q % cols;
      if (i > 0 && m[q - 1] && !rot[q - 1]) { rot[q - 1] = n; pilha[topo++] = q - 1; }
      if (i + 1 < cols && m[q + 1] && !rot[q + 1]) { rot[q + 1] = n; pilha[topo++] = q + 1; }
      if (q >= cols && m[q - cols] && !rot[q - cols]) { rot[q - cols] = n; pilha[topo++] = q - cols; }
      if (q + cols < N && m[q + cols] && !rot[q + cols]) { rot[q + cols] = n; pilha[topo++] = q + cols; }
    }
    celulas.push(conta);
  }
  return { rot, n, celulas };
}
let pilhaRot = new Int32Array(0);
