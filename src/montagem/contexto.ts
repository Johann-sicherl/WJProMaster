// Editar peça em contexto: a peça de um componente é editada no ambiente de Peça com o resto da
// montagem em volta (transparente), no sistema de coordenadas da peça. Puro: testado em
// scripts/teste-montagem.ts. A Peça (src/main.ts) mostra e devolve; a Montagem abre e recebe.

import { validarDocumento, type AssinaturaFace, type Documento, type Referencia, type SuporteEsboco } from "../model";
import type { Topologia } from "../kernel/topologia";
import { acharNaTopologia, atualizarExternas } from "../esboco/externas";
import { eixoXParaNormal, referencial } from "../esboco/referencial";
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

/** Face da topologia mais parecida com a guardada (mesmo sentido da normal; perto e de área parecida). */
export function acharFaceParecida(ass: AssinaturaFace, topo: Topologia): AssinaturaFace | null {
  let melhor: AssinaturaFace | null = null, nota = Infinity;
  for (const f of topo.faces) {
    if (f.geom !== ass.geom) continue;
    if (ass.normal && (!f.normal || f.normal[0] * ass.normal[0] + f.normal[1] * ass.normal[1] + f.normal[2] * ass.normal[2] < 0.9999)) continue;
    const d = Math.hypot(f.centro[0] - ass.centro[0], f.centro[1] - ass.centro[1], f.centro[2] - ass.centro[2]);
    const n = d + Math.abs(f.area - ass.area) / Math.max(1, Math.sqrt(ass.area));
    if (n < nota) { nota = n; melhor = f; }
  }
  return melhor;
}

/**
 * Edição em contexto: as referências a outros componentes (plano de esboço numa face deles,
 * condições "até a superfície/vértice", início "De", geometria convertida no esboço) passam a
 * usar a geometria atual deles. `topoDe(comp)` = topologia do componente no sistema da peça
 * (null: componente não está nesta montagem → a referência fica com a última geometria).
 * Devolve se algo mudou e os esboços cujos pontos mudaram (resolver antes de reconstruir).
 */
export function atualizarRefsDeContexto(doc: Documento, topoDe: (comp: string) => Topologia | null): { mudou: boolean; esbocos: string[] } {
  let mudou = false;
  const esbocos = new Set<string>();
  // igualdade com tolerância (1e-6 mm): arredondamentos não contam como mudança
  const aprox = (x: unknown) => JSON.stringify(x, (_k, v) => (typeof v === "number" ? Math.round(v * 1e6) / 1e6 + 0 : v));
  const trocar = (alvo: Record<string, unknown>, novo: Record<string, unknown>) => {
    if (aprox(alvo) === aprox(novo)) return false;
    for (const k of Object.keys(alvo)) delete alvo[k];
    Object.assign(alvo, novo);
    return true;
  };
  // referências soltas nos recursos (condições, "De"...)
  const visitar = (o: unknown) => {
    if (!o || typeof o !== "object") return;
    if (Array.isArray(o)) return o.forEach(visitar);
    const r = o as Record<string, unknown>;
    const ctx = typeof r.ctx === "string" ? r.ctx : null;
    if (ctx && (r.tipo === "face" || r.tipo === "aresta" || r.tipo === "vertice")) {
      const topo = topoDe(ctx);
      if (!topo) return;
      const ref = r as unknown as Referencia;
      let nova: Referencia | null = null;
      if (ref.tipo === "face") {
        const f = acharFaceParecida(ref.ass, topo);
        nova = f ? { tipo: "face", ass: f, ctx } : null;
      } else {
        const a = acharNaTopologia(ref, topo);
        nova = a ? ({ ...a, ctx } as Referencia) : null;
      }
      if (nova && trocar(r, nova as unknown as Record<string, unknown>)) mudou = true;
      return;
    }
    for (const v of Object.values(r)) visitar(v);
  };
  for (const f of doc.features) {
    if (f.tipo !== "esboco") {
      visitar(f);
      continue;
    }
    // plano do esboço numa face de outro componente
    const s = f.suporte;
    if (s.tipo === "face" && s.ctx && s.face) {
      const topo = topoDe(s.ctx);
      const face = topo && acharFaceParecida(s.face, topo);
      if (face?.normal) {
        const n = face.normal;
        const d = face.centro[0] * n[0] + face.centro[1] * n[1] + face.centro[2] * n[2];
        const perp = Math.abs(s.eixoX[0] * n[0] + s.eixoX[1] * n[1] + s.eixoX[2] * n[2]) < 1e-6;
        const novo: SuporteEsboco = { tipo: "face", origem: [n[0] * d, n[1] * d, n[2] * d], normal: n, eixoX: perp ? s.eixoX : eixoXParaNormal(n), face, ctx: s.ctx };
        if (aprox(novo) !== aprox(s)) {
          f.suporte = novo;
          mudou = true;
          esbocos.add(f.id);
        }
      }
    }
    // geometria convertida de outros componentes (no plano atual do esboço)
    const comps = new Set(f.geos.flatMap((g) => (g.externa && "ctx" in g.externa && g.externa.ctx ? [g.externa.ctx] : [])));
    for (const comp of comps) {
      const topo = topoDe(comp);
      if (!topo) continue;
      let ref;
      try {
        ref = referencial(f.suporte);
      } catch {
        continue;
      }
      if (atualizarExternas(f, topo, ref, comp).mudaram) {
        mudou = true;
        esbocos.add(f.id);
      }
    }
  }
  return { mudou, esbocos: [...esbocos] };
}
