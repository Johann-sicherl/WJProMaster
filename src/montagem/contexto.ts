// Editar peça em contexto: a peça de um componente é editada no ambiente de Peça com o resto da
// montagem em volta (transparente), no sistema de coordenadas da peça. Puro: testado em
// scripts/teste-montagem.ts. A Peça (src/main.ts) mostra e devolve; a Montagem abre e recebe.

import { validarDocumento, type Documento } from "../model";
import { capturarAtiva } from "../configuracoes";
import { compor, inverter, marcaDaPeca, type DocumentoMontagem, type PecaEmbutida, type Transformacao } from "./modelo";

/** O que a Peça recebe da Montagem (pelo IndexedDB, chave "contexto"). */
export interface PedidoContexto {
  montagem: DocumentoMontagem;
  /** componente cuja peça é editada (a posição dele define o sistema da peça) */
  comp: string;
}

/** O que a Peça devolve à Montagem (chave "contexto-volta"). */
export interface VoltaContexto {
  montagem: DocumentoMontagem;
  comp: string;
  /** a peça mudou (fica "alterada" na montagem) */
  alterada: boolean;
  /** 💾 na Peça em contexto: a montagem salva ao voltar (com a pergunta das peças) */
  salvar: boolean;
}

export interface ItemContexto {
  comp: string;
  peca: PecaEmbutida;
  /** posição do componente vista do sistema da peça editada */
  t: Transformacao;
  /** é outra instância da própria peça editada (acompanha a edição ao vivo) */
  mesmaPeca: boolean;
}

/** Componentes em volta (visíveis e ativos), já no sistema da peça do componente editado. */
export function itensDoContexto(m: DocumentoMontagem, compId: string): { peca: PecaEmbutida; itens: ItemContexto[] } | null {
  const c = m.componentes.find((x) => x.id === compId);
  const peca = c && m.pecas.find((p) => p.id === c.peca);
  if (!c || !peca) return null;
  const daPeca = inverter(c.t);
  const itens: ItemContexto[] = [];
  for (const o of m.componentes) {
    if (o.id === c.id || o.suprimido || o.oculto) continue;
    const p = m.pecas.find((x) => x.id === o.peca);
    if (!p) continue;
    itens.push({ comp: o.id, peca: p, t: compor(daPeca, o.t), mesmaPeca: o.peca === c.peca });
  }
  return { peca, itens };
}

/** Conteúdo que importa para a peça (o mesmo arquivo pode ter sido só reaberto, sem alteração). */
function conteudo(d: Documento): string {
  const x = validarDocumento(JSON.parse(JSON.stringify(d)));
  capturarAtiva(x);
  return JSON.stringify([x.features, x.material ?? null, x.variaveis ?? null, x.equacoes ?? null, x.configuracoes ?? null, x.parametrosConfigurados ?? null, x.retrocesso ?? null]);
}

/**
 * Devolve a peça editada à montagem: se o conteúdo mudou, a cópia embutida é trocada (todas as
 * instâncias), ganha marca nova e fica "alterada" até ser salva. Devolve se mudou.
 */
export function devolverPeca(m: DocumentoMontagem, compId: string, editado: Documento): boolean {
  const c = m.componentes.find((x) => x.id === compId);
  const p = c && m.pecas.find((x) => x.id === c.peca);
  if (!p) return false;
  if (conteudo(p.doc) === conteudo(editado)) return false;
  const novo = JSON.parse(JSON.stringify(editado)) as Documento;
  capturarAtiva(novo);
  p.doc = novo;
  p.marca = marcaDaPeca(novo);
  p.modificada = true;
  return true;
}
