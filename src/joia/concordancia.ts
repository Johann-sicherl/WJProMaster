// WJGoldDiamond: concordância (transição suave) entre aro, fios, folhas, garras e cabeça (J9b), na malha
// unida pelo manifold-3d. Só perto das junções (arestas onde peças diferentes se encontram): refina os
// triângulos até ~0,4·raio e suaviza deixando os vértices só irem para fora (como um filete: enche os
// cantos côncavos, nunca afina o metal). Assentos das gemas e cortes ficam vivos (vértices presos). Depois
// confere a espessura (raios para dentro). Também: normais para a vista com quebra nas arestas vivas.
// Puro: worker e testes em Node.

import type { Malha } from "./escultura";

/** Origem de cada triângulo: peça unida (com o raio de concordância) ou corte (assento, gravação, ocar). */
export interface Origem { corte: boolean; raio: number }

export interface ResultadoConcordancia { malha: Malha; origem: Int32Array; suavizados: number; refinados: number; deslocMax: number; /** vértices suavizados */ ativos: number[]; /** mesma malha refinada antes de suavizar (para comparar) */ antes?: Malha; /** conferência: vértices conferidos, quantos afinaram abaixo do mínimo e a menor espessura medida */ conferidos: number; finas: number; menorDepois: number }

const chaveAresta = (a: number, b: number) => (a < b ? a * 4294967296 + b : b * 4294967296 + a);

/** Grade uniforme de pontos (com alcance) para "existe ponto da junção a menos do alcance?". */
class GradePontos {
  private cel = new Map<number, number[]>();
  private pts: number[] = [];
  constructor(pts: number[], private tam: number) {
    // pontos muito juntos (menos de 1/4 do alcance) contam como um só: a consulta fica leve
    const vistos = new Set<number>();
    for (let i = 0; i < pts.length; i += 4) {
      const q = this.tam / 4, kk = this.chave(Math.floor(pts[i] / q), Math.floor(pts[i + 1] / q), Math.floor(pts[i + 2] / q));
      if (vistos.has(kk)) continue;
      vistos.add(kk);
      const o = this.pts.length;
      this.pts.push(pts[i], pts[i + 1], pts[i + 2], pts[i + 3]);
      // o ponto entra nas 27 células em volta: a consulta olha uma célula só
      const cx = Math.floor(pts[i] / tam), cy = Math.floor(pts[i + 1] / tam), cz = Math.floor(pts[i + 2] / tam);
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) {
        const k = this.chave(cx + a, cy + b, cz + c);
        let l = this.cel.get(k);
        if (!l) this.cel.set(k, (l = []));
        l.push(o);
      }
    }
  }
  private chave(x: number, y: number, z: number) { return ((x + 4096) * 8192 + (y + 4096)) * 8192 + (z + 4096); }
  /** Menor (distância / alcance do ponto), < 1 dentro de algum alcance; o alcance vem junto. */
  perto(x: number, y: number, z: number): { t: number; raio: number } {
    let melhor = Infinity, raio = 0;
    const l = this.cel.get(this.chave(Math.floor(x / this.tam), Math.floor(y / this.tam), Math.floor(z / this.tam)));
    if (l)
      for (const o of l) {
        const r = this.pts[o + 3], t = Math.hypot(x - this.pts[o], y - this.pts[o + 1], z - this.pts[o + 2]) / r;
        if (t < melhor) { melhor = t; raio = r; }
      }
    return { t: melhor, raio };
  }
}

/** Alcance da região suavizada em volta da junção e tamanho das arestas nela, em raios de concordância. */
const ALCANCE = 2;
const ALVO = 0.5;
/** Perda de metal tolerada na conferência (mm): abaixo da resolução da impressão de resina (~25 µm). */
const TOL_PERDA = 0.01;

/**
 * Concordância nas junções. `origem[t]` = índice em `origens` de cada triângulo. Vértices tocados por
 * triângulos de cortes ficam presos; vértices de junção = tocados por duas peças diferentes.
 */
export function concordar(m: Malha, origemTri: Int32Array, origens: Origem[], opcoes: { maxTriangulos?: number; minimo?: number; amostra?: number } = {}): ResultadoConcordancia {
  let pos = Array.from(m.pos), tri = Array.from(m.tri), org = Array.from(origemTri);
  const maxTri = opcoes.maxTriangulos ?? 1_200_000;
  const juncoes = () => {
    const nv = pos.length / 3;
    const fonte = new Int32Array(nv).fill(-1), multi = new Uint8Array(nv), preso = new Uint8Array(nv), raio = new Float32Array(nv);
    for (let t = 0; t < tri.length / 3; t++) {
      const o = origens[org[t]];
      for (let c = 0; c < 3; c++) {
        const v = tri[3 * t + c];
        if (o.corte) { preso[v] = 1; continue; }
        if (fonte[v] === -1) fonte[v] = org[t];
        else if (fonte[v] !== org[t]) multi[v] = 1;
        raio[v] = Math.max(raio[v], o.raio);
      }
    }
    const pts: number[] = [];
    for (let v = 0; v < nv; v++) if (multi[v] && !preso[v] && raio[v] > 0) pts.push(pos[3 * v], pos[3 * v + 1], pos[3 * v + 2], raio[v] * ALCANCE);
    return { pts, preso, raio };
  };
  const dep = (globalThis as any).DEPURAR_JOIA ? (t: string) => console.log(`   concordância: ${t} ${(performance.now() - T0).toFixed(0)} ms`) : () => {};
  const T0 = performance.now();
  let J = juncoes();
  if (!J.pts.length) return { malha: m, origem: origemTri, suavizados: 0, refinados: 0, deslocMax: 0, ativos: [], conferidos: 0, finas: 0, menorDepois: Infinity };
  const rMax = Math.max(...J.pts.filter((_, i) => i % 4 === 3)) / ALCANCE;
  let grade = new GradePontos(J.pts, rMax * ALCANCE);
  const nTri0 = tri.length / 3;

  const longe = new Set<number>();
  // refino: arestas que passam perto da junção maiores que 0,5·raio são divididas (vermelho-verde, malha conforme)
  for (let passe = 0; passe < 7 && tri.length / 3 < maxTri; passe++) {
    const meio = new Map<number, number>();
    const marcar = (a: number, b: number) => {
      const k = chaveAresta(a, b);
      if (meio.has(k) || longe.has(k)) return;
      const ax = pos[3 * a], ay = pos[3 * a + 1], az = pos[3 * a + 2], bx = pos[3 * b], by = pos[3 * b + 1], bz = pos[3 * b + 2];
      const L = Math.hypot(bx - ax, by - ay, bz - az);
      // a aresta passa pela região? (amostras ao longo dela a cada ~meio alcance)
      const n = Math.max(1, Math.ceil(L / (0.5 * rMax * ALCANCE)));
      let raio = 0;
      for (let i = 0; i <= n && !raio; i++) {
        const t = i / n, q = grade.perto(ax + (bx - ax) * t, ay + (by - ay) * t, az + (bz - az) * t);
        if (q.t < 1) raio = q.raio / ALCANCE;
      }
      if (!raio || L <= ALVO * raio) { longe.add(k); return; }
      meio.set(k, -1);
    };
    for (let t = 0; t < tri.length; t += 3) { marcar(tri[t], tri[t + 1]); marcar(tri[t + 1], tri[t + 2]); marcar(tri[t + 2], tri[t]); }
    if (!meio.size) break;
    for (const k of meio.keys()) {
      const a = Math.floor(k / 4294967296), b = k % 4294967296;
      meio.set(k, pos.length / 3);
      pos.push((pos[3 * a] + pos[3 * b]) / 2, (pos[3 * a + 1] + pos[3 * b + 1]) / 2, (pos[3 * a + 2] + pos[3 * b + 2]) / 2);
    }
    const nt: number[] = [], no: number[] = [];
    for (let t = 0; t < tri.length / 3; t++) {
      const v = [tri[3 * t], tri[3 * t + 1], tri[3 * t + 2]], o = org[t];
      const mids = [meio.get(chaveAresta(v[0], v[1])), meio.get(chaveAresta(v[1], v[2])), meio.get(chaveAresta(v[2], v[0]))];
      const n = mids.filter((x) => x !== undefined).length;
      const add = (a: number, b: number, c: number) => { nt.push(a, b, c); no.push(o); };
      if (n === 0) add(v[0], v[1], v[2]);
      else if (n === 3) {
        const [ab, bc, ca] = mids as number[];
        add(v[0], ab, ca); add(ab, v[1], bc); add(ca, bc, v[2]); add(ab, bc, ca);
      } else if (n === 1) {
        const i = mids.findIndex((x) => x !== undefined), mid = mids[i]!;
        const a = v[i], b = v[(i + 1) % 3], c = v[(i + 2) % 3];
        add(a, mid, c); add(mid, b, c);
      } else {
        // duas arestas: a que falta fica inteira
        const i = mids.findIndex((x) => x === undefined);
        const a = v[(i + 2) % 3], b = v[i], c = v[(i + 1) % 3]; // aresta sem divisão: b–c
        const m_ab = meio.get(chaveAresta(a, b))!, m_ca = meio.get(chaveAresta(c, a))!;
        add(a, m_ab, m_ca); add(m_ab, b, c); add(m_ab, c, m_ca);
      }
    }
    tri = nt;
    org = no;
    dep(`passe ${passe}: ${meio.size} arestas, ${tri.length / 3} triângulos`);
  }
  const refinados = tri.length / 3 - nTri0;
  dep(`refino +${refinados} triângulos`);
  J = juncoes();
  grade = new GradePontos(J.pts, rMax * ALCANCE);

  // vizinhos e região (peso cai de 1 na junção até 0 no alcance)
  const nv = pos.length / 3;
  const viz: number[][] = Array.from({ length: nv }, () => []);
  for (let t = 0; t < tri.length; t += 3)
    for (let c = 0; c < 3; c++) {
      const a = tri[t + c], b = tri[t + ((c + 1) % 3)];
      if (!viz[a].includes(b)) viz[a].push(b);
      if (!viz[b].includes(a)) viz[b].push(a);
    }
  const peso = new Float32Array(nv), lim = new Float32Array(nv);
  const ativos: number[] = [];
  for (let v = 0; v < nv; v++) {
    if (J.preso[v]) continue;
    const p = grade.perto(pos[3 * v], pos[3 * v + 1], pos[3 * v + 2]);
    if (p.t >= 1) continue;
    const r = p.raio / ALCANCE;
    peso[v] = 0.5 * (1 + Math.cos(Math.PI * p.t));
    lim[v] = 0.6 * r;
    ativos.push(v);
  }
  dep(`região ${ativos.length} vértices`);
  // vértice preso ao lado de corte: os vizinhos imediatos também (a borda do assento fica viva)
  for (const v of ativos) if (viz[v].some((u) => J.preso[u])) peso[v] = 0;
  const original = Float32Array.from(pos);
  const normal = new Float32Array(3 * nv);
  const calcNormais = () => {
    normal.fill(0);
    for (let t = 0; t < tri.length; t += 3) {
      const a = 3 * tri[t], b = 3 * tri[t + 1], c = 3 * tri[t + 2];
      const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
      const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      for (const k of [a, b, c]) { normal[k] += nx; normal[k + 1] += ny; normal[k + 2] += nz; }
    }
    for (let i = 0; i < normal.length; i += 3) { const L = Math.hypot(normal[i], normal[i + 1], normal[i + 2]) || 1; normal[i] /= L; normal[i + 1] /= L; normal[i + 2] /= L; }
  };
  // espaço livre para fora de cada vértice (raio pela normal): duas superfícies frente a frente andam no
  // máximo 40 % do vão cada uma e nunca se cruzam
  calcNormais();
  const n0 = Float32Array.from(normal);
  const raiosAntes = new Raios({ pos: original, tri: new Uint32Array(tri) });
  for (const v of ativos) {
    if (!(peso[v] > 0)) continue;
    const o: [number, number, number] = [pos[3 * v], pos[3 * v + 1], pos[3 * v + 2]], d: [number, number, number] = [n0[3 * v], n0[3 * v + 1], n0[3 * v + 2]];
    const livre = raiosAntes.lancar([o[0] + d[0] * 1e-4, o[1] + d[1] * 1e-4, o[2] + d[2] * 1e-4], d, 3 * lim[v]);
    if (Number.isFinite(livre)) lim[v] = Math.min(lim[v], 0.4 * livre);
  }
  dep("espaço livre");
  // passos: o bastante para a difusão alcançar ~1 raio com arestas de ~0,5 raio
  const iter = 18;
  let deslocMax = 0;
  for (let it = 0; it < iter; it++) {
    calcNormais();
    const novo = new Float32Array(ativos.length * 3);
    ativos.forEach((v, i) => {
      const w = peso[v];
      if (!(w > 0)) { novo[3 * i] = pos[3 * v]; novo[3 * i + 1] = pos[3 * v + 1]; novo[3 * i + 2] = pos[3 * v + 2]; return; }
      let mx = 0, my = 0, mz = 0, emin = Infinity;
      for (const u of viz[v]) {
        mx += pos[3 * u]; my += pos[3 * u + 1]; mz += pos[3 * u + 2];
        emin = Math.min(emin, Math.hypot(pos[3 * u] - pos[3 * v], pos[3 * u + 1] - pos[3 * v + 1], pos[3 * u + 2] - pos[3 * v + 2]));
      }
      const k = viz[v].length || 1;
      const nx = normal[3 * v], ny = normal[3 * v + 1], nz = normal[3 * v + 2];
      // só na direção da normal e só para fora (enche o canto côncavo; onde é convexo o vértice fica):
      // sem deslize tangencial, os triângulos não dobram
      let dn = ((mx / k - pos[3 * v]) * nx + (my / k - pos[3 * v + 1]) * ny + (mz / k - pos[3 * v + 2]) * nz) * 0.5 * w;
      if (dn <= 0) { novo[3 * i] = pos[3 * v]; novo[3 * i + 1] = pos[3 * v + 1]; novo[3 * i + 2] = pos[3 * v + 2]; return; }
      dn = Math.min(dn, 0.25 * emin);
      let x = pos[3 * v] + dn * nx, y = pos[3 * v + 1] + dn * ny, z = pos[3 * v + 2] + dn * nz;
      // deslocamento total limitado (0,6·raio e o espaço livre) e nunca para dentro do plano tangente original
      const ox = original[3 * v], oy = original[3 * v + 1], oz = original[3 * v + 2];
      let ex = x - ox, ey = y - oy, ez = z - oz;
      const en = ex * n0[3 * v] + ey * n0[3 * v + 1] + ez * n0[3 * v + 2];
      if (en < 0) { ex -= en * n0[3 * v]; ey -= en * n0[3 * v + 1]; ez -= en * n0[3 * v + 2]; }
      const L = Math.hypot(ex, ey, ez);
      if (L > lim[v]) { ex *= lim[v] / L; ey *= lim[v] / L; ez *= lim[v] / L; }
      x = ox + ex; y = oy + ey; z = oz + ez;
      novo[3 * i] = x; novo[3 * i + 1] = y; novo[3 * i + 2] = z;
    });
    ativos.forEach((v, i) => { pos[3 * v] = novo[3 * i]; pos[3 * v + 1] = novo[3 * i + 1]; pos[3 * v + 2] = novo[3 * i + 2]; });
  }
  // triângulos que viraram (dobra da malha): os vértices deles voltam ao lugar original
  const triOrig = (t: number, P: ArrayLike<number>) => {
    const a = 3 * tri[t], b = 3 * tri[t + 1], c = 3 * tri[t + 2];
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    return [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
  };
  let voltaram = 0;
  for (let rep = 0; rep < 4; rep++) {
    let n = 0;
    for (let t = 0; t < tri.length; t += 3) {
      const [a, b, c] = [tri[t], tri[t + 1], tri[t + 2]];
      if (!(peso[a] > 0 || peso[b] > 0 || peso[c] > 0)) continue;
      const n1 = triOrig(t, pos), n2 = triOrig(t, original);
      const L1 = Math.hypot(n1[0], n1[1], n1[2]), L2 = Math.hypot(n2[0], n2[1], n2[2]);
      if (n1[0] * n2[0] + n1[1] * n2[1] + n1[2] * n2[2] >= -0.05 * L1 * L2) continue;
      for (const v of [a, b, c]) if (peso[v] > 0) { pos[3 * v] = original[3 * v]; pos[3 * v + 1] = original[3 * v + 1]; pos[3 * v + 2] = original[3 * v + 2]; peso[v] = 0; n++; }
    }
    voltaram += n;
    if (!n) break;
  }
  dep(`suavização (${voltaram} vértices voltaram por dobra)`);
  // conferência: o metal só ganha material (nenhum ponto fica mais fino). Para uma amostra dos vértices que
  // se moveram, o ponto original tem de continuar dentro do sólido novo: o primeiro triângulo acertado saindo
  // pela normal original é uma face de saída (normal no mesmo sentido do raio).
  const movidos = ativos.filter((v) => Math.hypot(pos[3 * v] - original[3 * v], pos[3 * v + 1] - original[3 * v + 1], pos[3 * v + 2] - original[3 * v + 2]) > 1e-4);
  const passo = Math.max(1, Math.ceil(movidos.length / (opcoes.amostra ?? 3000)));
  const novaPos = Float32Array.from(pos);
  const raiosDepois = new Raios({ pos: novaPos, tri: new Uint32Array(tri) });
  let finas = 0, conferidos = 0;
  /** o ponto o está dentro do sólido novo? (raio na direção d: primeiro acerto é face de saída) */
  const dentro = (o: [number, number, number], d: [number, number, number]): boolean | null => {
    const dist = raiosDepois.lancar([o[0] - d[0] * 1e-4, o[1] - d[1] * 1e-4, o[2] - d[2] * 1e-4], d, 2);
    if (!Number.isFinite(dist)) return null;
    const t = raiosDepois.tri, a = 3 * tri[t], b = 3 * tri[t + 1], c = 3 * tri[t + 2];
    const ux = novaPos[b] - novaPos[a], uy = novaPos[b + 1] - novaPos[a + 1], uz = novaPos[b + 2] - novaPos[a + 2];
    const vx = novaPos[c] - novaPos[a], vy = novaPos[c + 1] - novaPos[a + 1], vz = novaPos[c + 2] - novaPos[a + 2];
    const saida = (uy * vz - uz * vy) * d[0] + (uz * vx - ux * vz) * d[1] + (ux * vy - uy * vx) * d[2];
    return saida > 0 || dist <= TOL_PERDA;
  };
  for (let i = 0; i < movidos.length; i += passo) {
    const v = movidos[i], o: [number, number, number] = [original[3 * v], original[3 * v + 1], original[3 * v + 2]];
    conferidos++;
    // três direções perto da normal original (um raio pode passar exatamente numa aresta)
    let sim = 0, nao = 0;
    for (const [jx, jy, jz] of [[0, 0, 0], [0.13, 0.07, -0.05], [-0.06, 0.11, 0.12]]) {
      const d0: [number, number, number] = [n0[3 * v] + jx, n0[3 * v + 1] + jy, n0[3 * v + 2] + jz], L = Math.hypot(...d0);
      const r = dentro(o, [d0[0] / L, d0[1] / L, d0[2] / L]);
      if (r === true) sim++;
      else if (r === false) nao++;
    }
    if (!sim && nao) { finas++; if ((globalThis as any).DEPURAR_JOIA) { const dd = raiosDepois.lancar([o[0] - n0[3 * v] * 1e-4, o[1] - n0[3 * v + 1] * 1e-4, o[2] - n0[3 * v + 2] * 1e-4], [n0[3 * v], n0[3 * v + 1], n0[3 * v + 2]], 2); console.log('     perdeu', v, dd.toFixed(4), 'desloc', Math.hypot(pos[3 * v] - o[0], pos[3 * v + 1] - o[1], pos[3 * v + 2] - o[2]).toFixed(4), 'lim', lim[v].toFixed(3), 'peso', peso[v].toFixed(2), o.map((x) => x.toFixed(2)).join(',')); } }
  }
  const menorDepois = 0;
  dep(`conferência (${conferidos} vértices, ${finas} perderam metal)`);
  for (const v of ativos) deslocMax = Math.max(deslocMax, Math.hypot(pos[3 * v] - original[3 * v], pos[3 * v + 1] - original[3 * v + 1], pos[3 * v + 2] - original[3 * v + 2]));
  return { malha: { pos: new Float32Array(pos), tri: new Uint32Array(tri) }, origem: Int32Array.from(org), suavizados: ativos.length, refinados, deslocMax, ativos: ativos.filter((v) => peso[v] > 0), antes: { pos: original, tri: new Uint32Array(tri) }, conferidos, finas, menorDepois };
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
