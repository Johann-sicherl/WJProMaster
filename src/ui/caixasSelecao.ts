// Caixa de seleção ativa (rosa) dos comandos, como no CAD de referência: ao abrir, a primeira caixa
// vazia já recebe os toques; com pré-seleção, a geometria entra na caixa certa e a próxima vazia fica
// ativa; ao encher uma caixa de um item só, a vez passa para a próxima vazia. Puro (sem DOM): só lê o
// esquema do painel e o recurso. Teste: scripts/teste-selecao-arestas.ts.

import { ler, type Esquema, type TipoSel } from "./formulario";

export interface CampoSelecao {
  cam: string;
  aceita: TipoSel[];
  multiplo: boolean;
}

/**
 * Caixas de seleção visíveis, na ordem do painel: pula a aba que não está aberta, as caixas
 * escondidas e as opcionais desmarcadas (ex.: Direção 2 desligada).
 */
export function camposDeSelecao<F>(esq: Esquema<F>, f: F, aba?: string): CampoSelecao[] {
  const abaAtual = aba ?? esq.abas?.[0];
  const out: CampoSelecao[] = [];
  for (const cx of esq.caixas) {
    if (cx.aba && cx.aba !== abaAtual) continue;
    if (cx.vis && !cx.vis(f)) continue;
    if (cx.opcional && !ler(f, cx.opcional)) continue;
    for (const c of cx.campos) {
      if (c.t !== "refs" || (c.vis && !c.vis(f))) continue;
      if (out.some((o) => o.cam === c.cam)) continue;
      out.push({ cam: c.cam, aceita: c.aceita, multiplo: c.multiplo });
    }
  }
  return out;
}

export const campoVazio = (f: unknown, cam: string) => {
  const v = ler(f, cam);
  return !v || (Array.isArray(v) && !v.length);
};

/**
 * Caixa ativa ao abrir o comando: a primeira vazia. Sem nenhuma vazia, a primeira caixa de um item só
 * que ficou com o valor de fábrica (`comPadrao`, ex.: plano Superior do Plano, plano Direito do
 * Espelhar, sem pré-seleção): o primeiro toque troca o padrão pela geometria tocada, sem precisar
 * tocar a caixa antes.
 */
export function campoInicial(campos: CampoSelecao[], f: unknown, comPadrao: readonly string[] = []): CampoSelecao | null {
  return campos.find((c) => campoVazio(f, c.cam)) ?? campos.find((c) => !c.multiplo && comPadrao.includes(c.cam)) ?? null;
}

/**
 * Próxima caixa depois que a caixa `atual` (de um item só) foi preenchida: a próxima vazia depois
 * dela; se não houver, a primeira vazia antes dela; nenhuma vazia = nenhuma ativa.
 */
export function proximoCampo(campos: CampoSelecao[], f: unknown, atual: string): CampoSelecao | null {
  const i = campos.findIndex((c) => c.cam === atual);
  const ordem = i < 0 ? campos : [...campos.slice(i + 1), ...campos.slice(0, i)];
  return ordem.find((c) => campoVazio(f, c.cam)) ?? null;
}

/**
 * A cada desenho do painel: a caixa ativa que sumiu (opção mudou) dá a vez à primeira vazia; sem caixa
 * ativa, uma caixa vazia que acabou de aparecer (ex.: Plano médio mostra a 2ª referência) ou de esvaziar
 * (item tirado com ×) fica ativa. `vaziasAntes` = as vazias do desenho anterior (undefined no primeiro).
 * Caixa que o usuário desativou (tocando nela) não volta sozinha.
 */
export function ajustarCampo(campos: CampoSelecao[], f: unknown, atual: CampoSelecao | null, vaziasAntes?: readonly string[]): { campo: CampoSelecao | null; vazias: string[] } {
  const vazias = campos.filter((c) => campoVazio(f, c.cam)).map((c) => c.cam);
  let campo = atual && campos.some((c) => c.cam === atual.cam) ? atual : atual ? campoInicial(campos, f) : null;
  if (!campo && vaziasAntes) campo = campos.find((c) => vazias.includes(c.cam) && !vaziasAntes.includes(c.cam)) ?? null;
  return { campo, vazias };
}
