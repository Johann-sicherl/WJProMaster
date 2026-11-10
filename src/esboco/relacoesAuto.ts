// Relações automáticas do esboço ("magnetismo", como nos CADs profissionais). Módulo puro (testado em
// Node por `scripts/teste-relacoes-auto.ts`): o editor pergunta aqui qual relação a linha que está
// sendo desenhada ou o ponto que está sendo arrastado vai ganhar (para mostrar o símbolo antes de
// soltar) e, ao soltar, grava só a que o solver aceitar sem redundância nem conflito.
//
// Linha nova: Colinear › Horizontal/Vertical › Paralela › Perpendicular (só com linha ligada a ela),
// uma relação só (todas tiram o mesmo grau de liberdade: a direção), com tolerância de ±1°.
// Ponto arrastado e solto: Coincidente com outro ponto (ou a origem), senão "sobre a curva".

import type { FeatureEsboco, GeoEsboco } from "../model";
import { dist, distanciaGeo, mapaPontos, ORIGEM, pontosDaGeo, projetarNaGeo, sub, type P2 } from "./geometria";
import { grupoCoincidente, restringir, type NovaRestricao } from "./operacoes";
import type { SolverEsboco } from "./solver";

/** Tolerância de ângulo das relações automáticas (graus). */
export const TOL_ANGULO_AUTO = 1;

export interface CandidatoAuto {
  /** Relação a criar; `LINHA_NOVA` no lugar do id da linha que ainda não existe (prévia). */
  r: NovaRestricao;
  simbolo: string;
  rotulo: string;
  /** Entidade de referência (linha paralela, ponto alvo…), para destacar na prévia. */
  ref?: string;
  /** Posição encaixada do ponto arrastado. */
  p?: P2;
}

/** Marca o id da linha ainda não criada nas relações candidatas. */
export const LINHA_NOVA = "__linhaNova__";

type Linha = Extract<GeoEsboco, { tipo: "linha" }>;

/** Ângulo entre direções, sem sentido (0…90°). */
function anguloEntre(u: P2, v: P2): number {
  const c = Math.abs(u.x * v.x + u.y * v.y) / (Math.hypot(u.x, u.y) * Math.hypot(v.x, v.y) || 1);
  return (Math.acos(Math.min(1, c)) * 180) / Math.PI;
}

function distReta(p: P2, a: P2, b: P2): number {
  const d = sub(b, a);
  const l = Math.hypot(d.x, d.y) || 1;
  return Math.abs((p.x - a.x) * d.y - (p.y - a.y) * d.x) / l;
}

/**
 * Relações candidatas para a linha a→b, na ordem de preferência. `pontas` são os ids dos pontos das
 * pontas (os que já existem), para saber quais linhas estão ligadas a ela; `ignorar` é o id da própria
 * linha (quando já criada). `tol` é o raio de encaixe (mm) usado para a colinearidade.
 */
export function candidatosLinha(esb: FeatureEsboco, a: P2, b: P2, o: { pontas?: (string | undefined)[]; ignorar?: string; tol: number; tolAng?: number }): CandidatoAuto[] {
  const tolAng = o.tolAng ?? TOL_ANGULO_AUTO;
  const d = sub(b, a);
  if (Math.hypot(d.x, d.y) < 1e-9) return [];
  const id = o.ignorar ?? LINHA_NOVA;
  const pts = mapaPontos(esb);
  const ligados = new Set<string>();
  for (const p of o.pontas ?? []) if (p) for (const q of grupoCoincidente(esb, p)) ligados.add(q);
  const linhas = esb.geos.filter((g): g is Linha => g.tipo === "linha" && !g.oculta && g.id !== o.ignorar && pts.has(g.p1) && pts.has(g.p2));
  const out: CandidatoAuto[] = [];

  // 1) colinear: mesma direção e as duas pontas sobre a reta da outra (linha não ligada a esta: ligada,
  //    a paralela já a deixa na mesma reta e a colinear seria redundante)
  let melhor: { l: Linha; dd: number } | null = null;
  for (const l of linhas) {
    if (ligados.has(l.p1) || ligados.has(l.p2)) continue;
    const p1 = pts.get(l.p1)!, p2 = pts.get(l.p2)!;
    if (anguloEntre(d, sub(p2, p1)) > tolAng) continue;
    const dd = Math.max(distReta(a, p1, p2), distReta(b, p1, p2));
    if (dd <= o.tol && (!melhor || dd < melhor.dd)) melhor = { l, dd };
  }
  if (melhor) out.push({ r: { tipo: "colinear", a: melhor.l.id, b: id }, simbolo: "⫽", rotulo: "Colinear", ref: melhor.l.id });

  // 2) horizontal / vertical
  if (anguloEntre(d, { x: 1, y: 0 }) <= tolAng) out.push({ r: { tipo: "horizontal", a: id }, simbolo: "H", rotulo: "Horizontal" });
  else if (anguloEntre(d, { x: 0, y: 1 }) <= tolAng) out.push({ r: { tipo: "vertical", a: id }, simbolo: "V", rotulo: "Vertical" });

  // 3) paralela (a mais alinhada; empate: a mais perto) e 4) perpendicular a uma linha ligada
  const meio = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const ordenar = (alvo: number) => linhas
    .map((l) => {
      const p1 = pts.get(l.p1)!, p2 = pts.get(l.p2)!;
      const ang = anguloEntre(d, sub(p2, p1));
      return { l, erro: Math.abs(ang - alvo), perto: distReta(meio, p1, p2), ligada: ligados.has(l.p1) || ligados.has(l.p2) };
    })
    .filter((x) => x.erro <= tolAng)
    .sort((x, y) => x.erro - y.erro || x.perto - y.perto);
  // linha horizontal/vertical: paralela/perpendicular a outra H/V nada acrescenta à H/V
  const hv = out.some((c) => c.r.tipo === "horizontal" || c.r.tipo === "vertical");
  for (const x of hv ? [] : ordenar(0).slice(0, 2))
    out.push({ r: { tipo: "paralelo", a: id, b: x.l.id }, simbolo: "∥", rotulo: "Paralela", ref: x.l.id });
  for (const x of hv ? [] : ordenar(90).filter((x) => x.ligada).slice(0, 2))
    out.push({ r: { tipo: "perpendicular", a: id, b: x.l.id }, simbolo: "⊥", rotulo: "Perpendicular", ref: x.l.id });
  return out;
}

/** Troca o marcador da linha nova pelo id dela. */
export function comLinha(r: NovaRestricao, linhaId: string): NovaRestricao {
  const o = { ...r } as Record<string, unknown>;
  for (const k of ["a", "b"]) if (o[k] === LINHA_NOVA) o[k] = linhaId;
  return o as unknown as NovaRestricao;
}

/**
 * Grava a relação só se ela tirar grau de liberdade sem criar conflito nem redundância (senão desfaz,
 * inclusive as posições que o solver mexeu). Devolve o id criado ou null.
 */
export function tentarRelacao(esb: FeatureEsboco, solver: Pick<SolverEsboco, "resolver">, r: NovaRestricao): string | null {
  const base = solver.resolver(esb);
  if (!base.ok || base.conflitantes.length) return null; // esboço já em conflito: não mexe
  const pontos = JSON.stringify(esb.pontos);
  const raios = esb.geos.map((g) => ("r" in g ? g.r : 0));
  const id = restringir(esb, r);
  const res = solver.resolver(esb);
  const aceita = res.ok && !res.conflitantes.length && res.gl < base.gl && res.redundantes.length <= base.redundantes.length;
  if (aceita) return id;
  esb.restricoes = esb.restricoes.filter((x) => x.id !== id);
  esb.pontos = JSON.parse(pontos);
  esb.geos.forEach((g, i) => { if ("r" in g) (g as { r: number }).r = raios[i]; });
  return null;
}

/** Relação automática da linha recém-criada: a primeira candidata aceita pelo solver (ou nenhuma). */
export function aplicarAutoLinha(esb: FeatureEsboco, solver: Pick<SolverEsboco, "resolver">, linhaId: string, tol: number, tolAng = TOL_ANGULO_AUTO): CandidatoAuto | null {
  const l = esb.geos.find((g): g is Linha => g.id === linhaId && g.tipo === "linha");
  if (!l) return null;
  const pts = mapaPontos(esb);
  const cands = candidatosLinha(esb, pts.get(l.p1)!, pts.get(l.p2)!, { pontas: [l.p1, l.p2], ignorar: l.id, tol, tolAng });
  for (const c of cands) if (tentarRelacao(esb, solver, c.r)) return c;
  return null;
}

/**
 * Alvo de um ponto arrastado: ponto (ou a origem) sob o cursor → Coincidente; senão curva sob o
 * cursor → "sobre a curva". Ficam de fora o próprio ponto, os pontos já coincidentes com ele e as
 * curvas (e pontas) das quais ele faz parte. Os eixos não contam (arrastar perto deles é comum).
 */
export function alvoDoArraste(esb: FeatureEsboco, arrastado: string, p: P2, tol: number): CandidatoAuto | null {
  const pts = mapaPontos(esb);
  const proprias = esb.geos.filter((g) => pontosDaGeo(g).includes(arrastado));
  const fora = new Set([...grupoCoincidente(esb, arrastado), ...proprias.flatMap(pontosDaGeo)]);
  // pontos de texto e de referências só de cota (ocultas) não recebem relação automática
  const doTexto = new Set(esb.geos.filter((g) => g.tipo === "texto" || g.oculta).flatMap(pontosDaGeo));
  let melhor: CandidatoAuto | null = null, dm = tol;
  for (const [id, q] of pts) {
    if (fora.has(id) || doTexto.has(id)) continue;
    const d = dist(p, q);
    if (d < dm) {
      dm = d;
      melhor = { r: { tipo: "coincidente", a: arrastado, b: id }, simbolo: "◉", rotulo: id === ORIGEM ? "Coincidente com a origem" : "Coincidente", ref: id, p: { x: q.x, y: q.y } };
    }
  }
  if (melhor) return melhor;
  dm = tol;
  const ids = new Set(proprias.map((g) => g.id));
  for (const g of esb.geos) {
    if (ids.has(g.id) || g.oculta || g.tipo === "ponto" || g.tipo === "texto") continue;
    const d = distanciaGeo(g, pts, p);
    if (d < dm) {
      dm = d;
      melhor = { r: { tipo: "coincidente", a: arrastado, b: g.id }, simbolo: "◉", rotulo: "Sobre a curva", ref: g.id, p: projetarNaGeo(g, pts, p) };
    }
  }
  return melhor;
}
