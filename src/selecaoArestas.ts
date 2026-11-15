// Seleção rápida de arestas do Filete/Chanfro (como no CAD de referência): a partir de uma aresta
// tocada, oferece todas as arestas de uma face vizinha, as arestas do recurso que a criou e todas as
// côncavas / convexas do corpo. Funções puras sobre a malha e a topologia que a vista já tem (sem
// kernel nem DOM): a escolha roda na hora do toque, sem reconstruir. Teste: scripts/teste-selecao-arestas.ts.

import type { MalhaPeca } from "./kernel/regenerar";
import type { Topologia } from "./kernel/topologia";

export type Convexidade = "convexa" | "concava" | "tangente" | "indefinida";

type V = [number, number, number];
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cruz = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norma = (a: V) => Math.hypot(a[0], a[1], a[2]);
const unit = (a: V): V => {
  const n = norma(a) || 1;
  return [a[0] / n, a[1] / n, a[2] / n];
};

/** Faces vizinhas de cada aresta (pela lista de arestas de cada face da topologia). */
export function facesDasArestas(topo: Topologia): number[][] {
  const out: number[][] = topo.arestas.map(() => []);
  (topo.arestasDaFace ?? []).forEach((lista, f) => {
    for (const a of lista) if (out[a] && !out[a].includes(f)) out[a].push(f);
  });
  return out;
}

/** Faces do mesmo corpo que a face dada (vizinhas por aresta, até fechar). */
export function facesDoCorpo(topo: Topologia, face: number, vizinhas = facesDasArestas(topo)): Set<number> {
  const visto = new Set<number>([face]);
  const fila = [face];
  while (fila.length) {
    const f = fila.pop()!;
    for (const a of topo.arestasDaFace?.[f] ?? [])
      for (const g of vizinhas[a]) if (!visto.has(g)) {
        visto.add(g);
        fila.push(g);
      }
  }
  return visto;
}

/** Ponto da malha. */
const ponto = (arr: Float32Array, i: number): V => [arr[i * 3], arr[i * 3 + 1], arr[i * 3 + 2]];

/** Distância do ponto ao triângulo (ponto mais próximo, Ericson). */
function distTriangulo(p: V, a: V, b: V, c: V): number {
  const ab = sub(b, a), ac = sub(c, a), ap = sub(p, a);
  const d1 = dot(ab, ap), d2 = dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return norma(ap);
  const bp = sub(p, b), d3 = dot(ab, bp), d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return norma(bp);
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    return norma(sub(p, [a[0] + ab[0] * v, a[1] + ab[1] * v, a[2] + ab[2] * v]));
  }
  const cp = sub(p, c), d5 = dot(ab, cp), d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return norma(cp);
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    return norma(sub(p, [a[0] + ac[0] * w, a[1] + ac[1] * w, a[2] + ac[2] * w]));
  }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
    const bc = sub(c, b);
    return norma(sub(p, [b[0] + bc[0] * w, b[1] + bc[1] * w, b[2] + bc[2] * w]));
  }
  const den = 1 / (va + vb + vc);
  const v = vb * den, w = vc * den;
  return norma(sub(p, [a[0] + ab[0] * v + ac[0] * w, a[1] + ab[1] * v + ac[1] * w, a[2] + ab[2] * v + ac[2] * w]));
}

/**
 * Lado da face junto ao ponto m da aresta: a normal da superfície ali (normais dos vértices do
 * triângulo mais próximo que estão sobre a aresta — exatas, vindas da superfície) e um ponto de dentro
 * da face (centro desse triângulo).
 */
function ladoDaFace(malha: MalhaPeca, face: number, m: V, t: V): { n: V; dentro: V } | null {
  const ini = malha.faces[face * 3], qtd = malha.faces[face * 3 + 1];
  if (qtd === undefined || !qtd) return null;
  let melhor = -1, dmin = Infinity;
  for (let k = ini; k < ini + qtd; k += 3) {
    const d = distTriangulo(m, ponto(malha.vertices, malha.triangulos[k]), ponto(malha.vertices, malha.triangulos[k + 1]), ponto(malha.vertices, malha.triangulos[k + 2]));
    if (d < dmin) {
      dmin = d;
      melhor = k;
    }
  }
  if (melhor < 0) return null;
  const ids = [malha.triangulos[melhor], malha.triangulos[melhor + 1], malha.triangulos[melhor + 2]];
  const ps = ids.map((i) => ponto(malha.vertices, i));
  const dentro: V = [(ps[0][0] + ps[1][0] + ps[2][0]) / 3, (ps[0][1] + ps[1][1] + ps[2][1]) / 3, (ps[0][2] + ps[1][2] + ps[2][2]) / 3];
  const geom = unit(cruz(sub(ps[1], ps[0]), sub(ps[2], ps[0])));
  // vértices sobre a reta da aresta (distância pequena perto do tamanho do triângulo)
  const escala = Math.max(norma(sub(ps[1], ps[0])), norma(sub(ps[2], ps[0])), 1e-9);
  let soma: V = [0, 0, 0], nSobre = 0, somaTodas: V = [0, 0, 0];
  ids.forEach((i, j) => {
    const nv = ponto(malha.normais, i);
    somaTodas = [somaTodas[0] + nv[0], somaTodas[1] + nv[1], somaTodas[2] + nv[2]];
    const r = sub(ps[j], m);
    const fora = norma(sub(r, [t[0] * dot(r, t), t[1] * dot(r, t), t[2] * dot(r, t)]));
    if (fora < 1e-3 * escala + 1e-6) {
      soma = [soma[0] + nv[0], soma[1] + nv[1], soma[2] + nv[2]];
      nSobre++;
    }
  });
  // sem vértice sobre a aresta: normal do triângulo, virada para o lado das normais da malha
  const n = nSobre ? unit(soma) : dot(geom, somaTodas) < 0 ? ([-geom[0], -geom[1], -geom[2]] as V) : geom;
  return { n, dentro };
}

/** Tangente abaixo de ~5° entre as normais das duas faces. */
const COS_TANGENTE = Math.cos((5 * Math.PI) / 180);

/**
 * Côncava ou convexa: num ponto do meio da aresta, a face 1 fica atrás do plano tangente da face 2
 * (e vice-versa) quando a aresta é convexa (canto vivo de fora), na frente quando é côncava (canto de
 * dentro). Faces quase tangentes (ex.: a borda de um filete) não são nem uma nem outra.
 */
export function convexidade(malha: MalhaPeca, topo: Topologia, aresta: number, vizinhas = facesDasArestas(topo)): Convexidade {
  const fs = vizinhas[aresta];
  if (!fs || fs.length !== 2) return "indefinida";
  const ini = malha.gruposArestas[aresta * 2], qtd = malha.gruposArestas[aresta * 2 + 1];
  if (!qtd || qtd < 2) return "indefinida";
  const seg = Math.floor(qtd / 4) * 2; // segmento do meio (pares de pontos)
  const p = ponto(malha.arestas, ini + seg), q = ponto(malha.arestas, ini + seg + 1);
  const m: V = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2];
  const t = unit(sub(q, p));
  const l1 = ladoDaFace(malha, fs[0], m, t), l2 = ladoDaFace(malha, fs[1], m, t);
  if (!l1 || !l2) return "indefinida";
  if (dot(l1.n, l2.n) > COS_TANGENTE) return "tangente";
  const d1 = sub(l1.dentro, m), d2 = sub(l2.dentro, m);
  const s = dot(d1, l2.n) / (norma(d1) || 1) + dot(d2, l1.n) / (norma(d2) || 1);
  if (s < -0.02) return "convexa";
  if (s > 0.02) return "concava";
  return "indefinida";
}

/** Convexidade já calculada de cada aresta, por malha (a malha muda a cada reconstrução). */
const CACHE = new WeakMap<MalhaPeca, Map<number, Convexidade>>();

export interface OpcaoSelecaoRapida {
  id: string;
  rotulo: string;
  /** Índices (em `topologia.arestas`) das arestas que a opção junta. */
  arestas: number[];
}

export interface EntradaSelecaoRapida {
  malha: MalhaPeca;
  topo: Topologia;
  /** Aresta tocada (índice em `topologia.arestas`). */
  aresta: number;
  /** Faces criadas por cada recurso (índices de faces), na ordem do documento. */
  facesPorRecurso: [id: string, nome: string, faces: number[]][];
  /** Faces que não entram (as do recurso em edição, que só existem na prévia). */
  facesExcluidas?: Set<number>;
  /** Rótulo de cada face vizinha (ex.: "face plana"). */
  rotuloFace?: (face: number) => string;
}

/**
 * Opções da barra de seleção rápida para a aresta tocada: arestas de cada face vizinha, do recurso
 * que criou a aresta (o mais recente entre as faces dela) e todas as côncavas / convexas do corpo.
 * Arestas que tocam uma face excluída (a prévia do próprio filete) ficam de fora: não existem antes dele.
 * Opções sem arestas não aparecem.
 */
export function opcoesSelecaoRapida(e: EntradaSelecaoRapida): OpcaoSelecaoRapida[] {
  const { topo, malha, aresta } = e;
  const viz = facesDasArestas(topo);
  const fora = e.facesExcluidas ?? new Set<number>();
  const valida = (a: number) => viz[a].length === 2 && viz[a].every((f) => !fora.has(f));
  const das = (faces: Iterable<number>) => {
    const s = new Set<number>();
    for (const f of faces) for (const a of topo.arestasDaFace?.[f] ?? []) if (valida(a)) s.add(a);
    return [...s].sort((x, y) => x - y);
  };
  const out: OpcaoSelecaoRapida[] = [];
  const fs = viz[aresta] ?? [];
  const rot = e.rotuloFace ?? ((f: number) => `face ${f + 1}`);
  const nomes = fs.map(rot);
  fs.forEach((f, i) => {
    if (fora.has(f)) return;
    const dup = nomes.filter((n) => n === nomes[i]).length > 1;
    out.push({ id: `face:${f}`, rotulo: `Arestas da ${nomes[i]}${dup ? ` ${i + 1}` : ""}`, arestas: das([f]) });
  });
  // recurso da aresta: o mais recente que criou uma das faces dela
  let rec: [string, string, number[]] | undefined;
  for (const r of e.facesPorRecurso) if (r[2].some((f) => fs.includes(f) && !fora.has(f))) rec = r;
  if (rec) out.push({ id: `recurso:${rec[0]}`, rotulo: `Arestas do ${rec[1]}`, arestas: das(rec[2].filter((f) => !fora.has(f))) });
  if (fs.length) {
    const corpo = facesDoCorpo(topo, fs[0], viz);
    const doCorpo = das(corpo);
    let memo = CACHE.get(malha);
    if (!memo) CACHE.set(malha, (memo = new Map()));
    const conv = doCorpo.map((a) => {
      let c = memo!.get(a);
      if (!c) memo!.set(a, (c = convexidade(malha, topo, a, viz)));
      return [a, c] as const;
    });
    out.push(
      { id: "concavas", rotulo: "Todas as côncavas", arestas: conv.filter((x) => x[1] === "concava").map((x) => x[0]) },
      { id: "convexas", rotulo: "Todas as convexas", arestas: conv.filter((x) => x[1] === "convexa").map((x) => x[0]) },
    );
  }
  return out.filter((o) => o.arestas.length);
}
