// Nomes persistentes das faces e arestas (como nos CADs profissionais). Cada face ganha o nome de quem
// a gerou na história: `<id do recurso>:<entidade>`, em que a entidade é o id da linha/arco/círculo do
// esboço que varreu a face lateral, ou `inicio` / `fim` / `fim2` para as tampas da extrusão (face no
// plano de partida, fim da direção 1, fim da direção 2 ou do outro lado do plano médio). Aresta = par
// de faces nomeadas. A cada reconstrução o registro guarda a superfície que cada nome gerou NAQUELA
// reconstrução (com as cotas novas); a face da peça que está sobre essa superfície é a face do nome.
// A assinatura geométrica (centro, área, comprimento…) fica só como reserva e para desempatar.

import type { Face, Shape3D } from "replicad";
import type { AssinaturaAresta, AssinaturaFace, FeatureEsboco, Vec3 } from "../model";
import type { Referencial } from "../esboco/referencial";
import { angulosArco, mapaPontos } from "../esboco/geometria";
import { assinaturaFace, listarTopo, type Topologia } from "./topologia";

type Caixa = { min: Vec3; max: Vec3 };

interface Entrada {
  nome: string;
  /** superfície gerada (assinatura da face da ferramenta nesta reconstrução) */
  ass: AssinaturaFace;
  caixa: Caixa | null;
}

const TOL = 1e-4;
const sub3 = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const esc3 = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cruz = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: Vec3): Vec3 => {
  const n = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / n, a[1] / n, a[2] / n];
};

/** Distância do ponto à reta (ponto `o`, direção unitária `d`). */
function distReta(p: Vec3, o: Vec3, d: Vec3): number {
  const v = sub3(p, o);
  return Math.hypot(...cruz(v, d));
}

/** A face `f` está sobre a superfície `e` (mesmo plano / mesmo cilindro), dentro da caixa dela? */
export function sobreSuperficie(e: Entrada, f: AssinaturaFace): boolean {
  if (e.ass.geom !== f.geom) return false;
  const s = e.ass;
  if (s.geom === "plano") {
    if (!s.normal || !f.normal || Math.abs(esc3(s.normal, f.normal)) < 0.9999) return false;
    if (Math.abs(esc3(sub3(f.centro, s.centro), s.normal)) > TOL) return false;
  } else if (s.geom === "cilindro") {
    if (!s.eixo || !f.eixo || !s.pontoEixo || !f.pontoEixo || s.raio === undefined || f.raio === undefined) return false;
    if (Math.abs(esc3(s.eixo, f.eixo)) < 0.9999 || Math.abs(s.raio - f.raio) > TOL) return false;
    if (distReta(f.pontoEixo, s.pontoEixo, unit(s.eixo)) > TOL) return false;
  } else return false;
  // a face da peça é um pedaço da face gerada (ou dela unida a outra no mesmo plano): o centro
  // dela cai dentro da caixa da face gerada
  const c = e.caixa, folga = 1e-3;
  return !c || [0, 1, 2].every((k) => f.centro[k] >= c.min[k] - folga && f.centro[k] <= c.max[k] + folga);
}

function caixaDe(f: Face): Caixa | null {
  try {
    const b = (f.boundingBox as unknown as { bounds: [Vec3, Vec3] }).bounds;
    return b && b[0].length === 3 ? { min: b[0], max: b[1] } : null;
  } catch {
    return null;
  }
}

/** Texto para o usuário: "a face de cima da Extrusão1" etc. */
function rotuloEntidade(ent: string): string {
  if (ent === "inicio") return "a face inicial (no plano do esboço)";
  if (ent === "fim") return "a face final";
  if (ent === "fim2") return "a face final da direção 2";
  return "uma face lateral";
}

export class RegistroNomes {
  readonly entradas: Entrada[] = [];
  /** nomes dos recursos (id → nome na árvore), para as mensagens */
  readonly recursos = new Map<string, string>();
  /**
   * Assinaturas das referências que esta reconstrução atualizou (nome novo ou geometria nova), com
   * o JSON de antes: a interface grava no documento só se o documento ainda tiver o valor antigo.
   */
  readonly alteradas = new Map<object, string>();
  /** esboços resolvidos de novo no kernel (as referências do modelo andaram): id → JSON de antes */
  readonly esbocos = new Map<string, { esb: FeatureEsboco; antes: string }>();
  private formas = new WeakSet<object>();
  private nomes = new Set<string>();
  private cacheNome = new WeakMap<AssinaturaFace, string | null>();

  /** A peça foi feita nesta reconstrução (só nela os nomes valem). */
  marcar(peca: Shape3D | null) {
    if (peca) this.formas.add(peca);
  }
  conhece(peca: Shape3D): boolean {
    return this.formas.has(peca);
  }

  registrar(nome: string, ass: AssinaturaFace, caixa: Caixa | null) {
    this.entradas.push({ nome, ass, caixa });
    this.nomes.add(nome);
  }
  temNome(nome: string): boolean {
    return this.nomes.has(nome);
  }

  /** Nome da face: o da primeira superfície gerada (na ordem da árvore) sobre a qual ela está. */
  nomeDaFace(f: AssinaturaFace): string | undefined {
    const c = this.cacheNome.get(f);
    if (c !== undefined) return c ?? undefined;
    const e = this.entradas.find((x) => sobreSuperficie(x, f));
    this.cacheNome.set(f, e?.nome ?? null);
    return e?.nome;
  }

  /** Índices das faces que estão sobre alguma superfície gerada com esse nome. */
  facesDoNome(nome: string, faces: AssinaturaFace[]): number[] {
    const es = this.entradas.filter((x) => x.nome === nome);
    const out: number[] = [];
    faces.forEach((f, i) => {
      if (es.some((e) => sobreSuperficie(e, f))) out.push(i);
    });
    return out;
  }

  /** Nome das arestas: o par (ordenado) dos nomes das duas faces que se encontram nela. */
  nomeDasArestas(topo: Topologia): ([string, string] | undefined)[] {
    const faces: number[][] = topo.arestas.map(() => []);
    topo.arestasDaFace?.forEach((l, fi) => l.forEach((ai) => faces[ai].push(fi)));
    return faces.map((l) => {
      if (l.length !== 2) return undefined;
      const a = this.nomeDaFace(topo.faces[l[0]]), b = this.nomeDaFace(topo.faces[l[1]]);
      if (!a || !b || a === b) return undefined;
      return a < b ? [a, b] : [b, a];
    });
  }

  /** Grava os nomes na topologia que vai para a interface (as seleções novas já nascem com nome). */
  nomearTopologia(topo: Topologia) {
    if (!this.entradas.length) return;
    for (const f of topo.faces) {
      const n = this.nomeDaFace(f);
      if (n) f.nome = n;
    }
    this.nomeDasArestas(topo).forEach((n, i) => {
      if (n) topo.arestas[i].nome = n;
    });
  }

  /** "a face final da Extrusão1". */
  descreverFace(nome: string): string {
    const [id, ent] = nome.split(":");
    return `${rotuloEntidade(ent ?? "")} da ${this.recursos.get(id) ?? "recurso excluído"}`;
  }

  /** Descrição de uma referência para o aviso: qual face/aresta não foi achada. */
  descrever(ass: AssinaturaFace | AssinaturaAresta, tipo: "face" | "aresta"): string {
    const nome = (ass as { nome?: string | [string, string] }).nome;
    if (tipo === "face") return typeof nome === "string" ? this.descreverFace(nome) : "uma face selecionada";
    if (Array.isArray(nome)) return `a aresta entre ${this.descreverFace(nome[0])} e ${this.descreverFace(nome[1])}`;
    return "uma aresta selecionada";
  }

  /** Guarda o valor de antes (uma vez) de uma assinatura que vai ser atualizada. */
  anotar(ass: object) {
    if (!this.alteradas.has(ass)) this.alteradas.set(ass, JSON.stringify(ass));
  }
}

let atual: RegistroNomes | null = null;

/** Registro da reconstrução em andamento (ou da última). */
export const registroAtual = () => atual;

export function novoRegistro(recursos: { id: string; nome: string }[]): RegistroNomes {
  atual = new RegistroNomes();
  for (const r of recursos) atual.recursos.set(r.id, r.nome);
  return atual;
}

type Geo2 = FeatureEsboco["geos"][number];

/**
 * Dá nome às faces da ferramenta de uma extrusão (antes da booleana): tampas pela posição ao longo
 * da normal do esboço e laterais pela entidade do esboço que as varreu (linha → plano que contém a
 * linha e a direção; arco/círculo → cilindro de mesmo centro e raio). Faces que não casam (spline,
 * inclinação, recurso fino) ficam sem nome: a referência usa a assinatura.
 */
export function nomearExtrusao(
  reg: RegistroNomes, id: string, tool: Shape3D, esb: FeatureEsboco | null, r: Referencial, s0: number, sentido: 1 | -1,
) {
  const faces = listarTopo(tool, "face");
  const tampas: { ass: AssinaturaFace; cx: Caixa | null; t: number }[] = [];
  const pts = esb ? mapaPontos(esb) : null;
  const geos = esb ? esb.geos.filter((g) => !g.construcao && !g.oculta && (g.tipo === "linha" || g.tipo === "arco" || g.tipo === "circulo")) : [];
  const mundo = (p: { x: number; y: number }): Vec3 => [
    r.origem[0] + r.x[0] * p.x + r.y[0] * p.y,
    r.origem[1] + r.x[1] * p.x + r.y[1] * p.y,
    r.origem[2] + r.x[2] * p.x + r.y[2] * p.y,
  ];
  for (const f of faces) {
    let ass: AssinaturaFace;
    try {
      ass = assinaturaFace(f);
    } catch {
      continue;
    }
    if (ass.geom === "plano" && ass.normal && Math.abs(esc3(ass.normal, r.normal)) > 0.9999) {
      tampas.push({ ass, cx: caixaDe(f), t: esc3(sub3(ass.centro, r.origem), r.normal) });
      continue;
    }
    const g = pts && geos.find((x) => geraLateral(x, ass, pts, r, mundo));
    if (g) reg.registrar(`${id}:${g.id}`, ass, caixaDe(f));
  }
  // tampas: a do plano de partida é "inicio"; a mais longe no sentido da extrusão, "fim"; a do
  // outro lado (direção 2, plano médio, passante nos dois sentidos), "fim2"
  for (const tp of tampas) {
    const nome = Math.abs(tp.t - s0) < TOL ? "inicio" : (tp.t - s0) * sentido > 0 ? "fim" : "fim2";
    reg.registrar(`${id}:${nome}`, tp.ass, tp.cx);
  }
}

function geraLateral(
  g: Geo2, ass: AssinaturaFace, pts: Map<string, { x: number; y: number }>, r: Referencial, mundo: (p: { x: number; y: number }) => Vec3,
): boolean {
  if (g.tipo === "linha") {
    if (ass.geom !== "plano" || !ass.normal) return false;
    const a = pts.get(g.p1), b = pts.get(g.p2);
    if (!a || !b) return false;
    const A = mundo(a), B = mundo(b);
    const dl = sub3(B, A), L = Math.hypot(...dl);
    if (L < 1e-9) return false;
    const u: Vec3 = [dl[0] / L, dl[1] / L, dl[2] / L];
    const m = unit(cruz(u, r.normal));
    if (Math.abs(esc3(m, ass.normal)) < 0.9999 || Math.abs(esc3(sub3(ass.centro, A), m)) > TOL) return false;
    // o centro da face lateral fica sobre o trecho da linha (linhas colineares não se confundem)
    const t = esc3(sub3(ass.centro, A), u);
    return t > -TOL && t < L + TOL;
  }
  if (g.tipo !== "arco" && g.tipo !== "circulo") return false;
  if (ass.geom !== "cilindro" || !ass.eixo || !ass.pontoEixo || ass.raio === undefined) return false;
  if (Math.abs(esc3(ass.eixo, r.normal)) < 0.9999 || Math.abs(ass.raio - g.r) > TOL) return false;
  const c = pts.get(g.c);
  if (!c) return false;
  const C = mundo(c);
  if (distReta(C, ass.pontoEixo, unit(ass.eixo)) > TOL) return false;
  if (g.tipo === "circulo") return true;
  // arco: o centro da face fica na direção do meio do arco
  const v = sub3(ass.centro, C);
  const ang = Math.atan2(esc3(v, r.y), esc3(v, r.x));
  const ini = pts.get(g.ini), fim = pts.get(g.fim);
  if (!ini || !fim) return false;
  const [a0, a1] = angulosArco(c, ini, fim);
  const norm = (x: number) => ((x % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  return norm(ang - a0) <= norm(a1 - a0) + 1e-6;
}
