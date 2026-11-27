// Cotas de diâmetro da engrenagem mostradas sobre o modelo (caixas "Diâmetro externo", "Diâmetro primitivo"
// e, na interna, "Diâmetro interno" da Toolbox de Engrenagens). Módulo puro (sem DOM nem three): devolve,
// no referencial da peça (eixo Y), a linha de cota de cada diâmetro e o texto; o desenho fica em
// `desenhoCotasEngrenagem.ts`. Os valores vêm das mesmas grandezas do painel (`geometria`), então marcar ou
// desmarcar a caixa só mostra/esconde: o sólido não é regenerado.

import type { ParamEngrenagem, TipoEngrenagem, Vec3 } from "../model";
import { geometria, paramCompleto, raioNaFaceConica } from "./engrenagens";

export type TipoCotaEng = "externo" | "primitivo" | "interno";

export const ROTULO_COTA: Record<TipoCotaEng, string> = {
  externo: "Diâmetro externo",
  primitivo: "Diâmetro primitivo",
  interno: "Diâmetro interno",
};

/** Caixas que fazem sentido para o tipo (cremalheira não tem diâmetros; "interno" só na engrenagem interna). */
export function cotasDisponiveis(tipo: TipoEngrenagem): TipoCotaEng[] {
  if (tipo === "cremalheira") return [];
  if (tipo === "interna") return ["externo", "primitivo", "interno"];
  return ["externo", "primitivo"];
}

export interface CotaDiametro {
  tipo: TipoCotaEng;
  rotulo: string;
  /** diâmetro em mm */
  valor: number;
  /** "Ø62", como as cotas de diâmetro do esboço */
  texto: string;
  /** centro da circunferência (no eixo Y da peça) */
  centro: Vec3;
  /** direção da linha de cota (unitária, no plano da circunferência) */
  dir: Vec3;
  /** raio medido */
  raio: number;
  /** pontas da linha de cota (sobre a circunferência) */
  a: Vec3;
  b: Vec3;
  /** onde fica o valor (na linha, entre o centro e a ponta a) */
  pos: Vec3;
  /** primitivo é circunferência de referência: linha tracejada */
  tracejada: boolean;
}

const ANGULO: Record<TipoCotaEng, number> = { externo: 0, primitivo: Math.PI / 2, interno: Math.PI / 4 };

export function textoDiametro(valor: number): string {
  return `Ø${Number(valor.toFixed(3)).toLocaleString("pt-BR", { maximumFractionDigits: 3 })}`;
}

/** Diâmetros do tipo, em mm (só os que existem). Erro de entrada → {} (o painel já mostra o erro). */
export function diametrosDaEngrenagem(p0: Partial<ParamEngrenagem>): { valores: Partial<Record<TipoCotaEng, number>>; y: number } {
  const p = paramCompleto(p0);
  let g;
  try {
    g = geometria(p);
  } catch {
    return { valores: {}, y: 0 };
  }
  if (g.tipo === "cremalheira") return { valores: {}, y: 0 };
  if (g.tipo === "interna") {
    // ponta (interna) = da; o "externo" é o do aro
    return { valores: { externo: 2 * g.raio_aro!, primitivo: 2 * g.r, interno: 2 * g.ra }, y: p.largura };
  }
  if (g.tipo === "conica") {
    // a face maior plana (y = 0) é onde o modelo tem a ponta; o Ø externo é o dela (o teórico fica no painel)
    const ra = raioNaFaceConica(g, g.r / Math.cos(g.delta!) + g.mn * (1 + g.x));
    return { valores: { externo: 2 * ra, primitivo: 2 * g.r }, y: 0 };
  }
  return { valores: { externo: 2 * g.ra, primitivo: 2 * g.r }, y: p.largura };
}

/** Linhas de cota das caixas marcadas (`quais`), no referencial da peça. */
export function cotasDiametro(p: Partial<ParamEngrenagem>, quais: Iterable<TipoCotaEng>): CotaDiametro[] {
  const { valores, y } = diametrosDaEngrenagem(p);
  const saida: CotaDiametro[] = [];
  for (const tipo of new Set(quais)) {
    const d = valores[tipo];
    if (d === undefined) continue;
    const raio = d / 2;
    const ang = ANGULO[tipo];
    const dir: Vec3 = [Math.cos(ang), 0, Math.sin(ang)];
    const centro: Vec3 = [0, y, 0];
    const em = (s: number): Vec3 => [centro[0] + dir[0] * s, y, centro[2] + dir[2] * s];
    saida.push({ tipo, rotulo: ROTULO_COTA[tipo], valor: d, texto: textoDiametro(d), centro, dir, raio, a: em(raio), b: em(-raio), pos: em(raio / 2), tracejada: tipo === "primitivo" });
  }
  return saida;
}
