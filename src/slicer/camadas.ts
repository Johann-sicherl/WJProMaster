// WJSlicer3D: perfis em camadas e só diferenças (L0 do novo layout, docs/global/wjslicer3d-layout.md §4).
// sistema (de fábrica, só leitura) → usuário (nome, "herda de", só as diferenças) → projeto → objeto → modificador/faixa de Z.
// `resolver()` é pura e devolve o `Processo` final (mais o que fica fora dele: suporte ligado, borda, saia, observações).
// O selo ↺ de "alterado" é `diferencas()`; `aplicarDiferencas()` é o caminho de volta. Puro: testado em scripts/teste-esquema.ts.
//
// Perfis de sistema (9 processos de camada) de cada impressora. O "0,20 mm Padrão" é EXATAMENTE o `Processo` de fábrica
// de `perfis.ts`. Os outros derivam dele só no que a altura de camada pede (regra em `planoDeSistema`), sem inventar
// velocidades, acelerações nem fluxos: os "Alta qualidade" ficam iguais ao normal da mesma altura até o Johann mandar os
// valores de referência (pendência 5 de wjslicer3d-layout.md §7).

import { achatar, camposDoProcesso, campoDe, desachatar, valorValido, type Plano, type Valor } from "./esquema";
import type { Ajustes } from "./caminhos";
import { maquinaPorId, type Processo, type TipoSuporte } from "./perfis";

// ---------- perfis de sistema ----------

export interface PerfilSistema {
  id: string;
  nome: string;
  /** altura de camada (mm) */
  altura: number;
  altaQualidade: boolean;
}

export const PERFIL_PADRAO = "0.20-padrao";

export const PERFIS_SISTEMA: readonly PerfilSistema[] = [
  { id: "0.08", nome: "0,08 mm", altura: 0.08, altaQualidade: false },
  { id: "0.12-aq", nome: "0,12 mm Alta qualidade", altura: 0.12, altaQualidade: true },
  { id: "0.12", nome: "0,12 mm", altura: 0.12, altaQualidade: false },
  { id: "0.16-aq", nome: "0,16 mm Alta qualidade", altura: 0.16, altaQualidade: true },
  { id: "0.16", nome: "0,16 mm", altura: 0.16, altaQualidade: false },
  { id: "0.20-aq", nome: "0,20 mm Alta qualidade", altura: 0.2, altaQualidade: true },
  { id: PERFIL_PADRAO, nome: "0,20 mm Padrão", altura: 0.2, altaQualidade: false },
  { id: "0.24", nome: "0,24 mm", altura: 0.24, altaQualidade: false },
  { id: "0.28", nome: "0,28 mm", altura: 0.28, altaQualidade: false },
];

export const perfilSistema = (id: string) => PERFIS_SISTEMA.find((p) => p.id === id) ?? PERFIS_SISTEMA.find((p) => p.id === PERFIL_PADRAO)!;

// ---------- valores de fábrica ----------

const cacheBase = new Map<string, Plano>();

/**
 * Todos os valores do processo de uma impressora no "0,20 mm Padrão": o `Processo` achatado + os campos de projeto
 * (sem suporte, sem borda, sem saia) + os valores neutros dos campos ainda não aplicados (🔶) e ocultos.
 */
export function planoBase(maquinaId: string): Plano {
  let b = cacheBase.get(maquinaId);
  if (!b) {
    b = achatar(maquinaPorId(maquinaId).processo);
    for (const c of camposDoProcesso()) if (c.padrao !== undefined && !(c.id in b)) b[c.id] = c.padrao;
    cacheBase.set(maquinaId, b);
  }
  return { ...b };
}

/**
 * Valores completos de um perfil de sistema. Regra de derivação a partir do "0,20 mm Padrão":
 * - `altura` = a do perfil; `alturaPrimeira` fica em 0,20 mm (a 1ª camada não acompanha a altura: boa aderência e
 *   dentro do limite do bico de 0,4 mm);
 * - camadas de topo e de fundo sobem o necessário para manter a MESMA espessura em mm do padrão
 *   (topo = max(5, ⌈espessura ÷ altura⌉); o motor já usava o maior entre camadas e milímetros, então o resultado não muda);
 * - todo o resto (larguras, velocidades, acelerações, fluxos, suporte) fica como no padrão.
 */
export function planoDeSistema(maquinaId: string, perfilId: string = PERFIL_PADRAO): Plano {
  const p = planoBase(maquinaId);
  if (perfilId === PERFIL_PADRAO) return p;
  const h = perfilSistema(perfilId).altura;
  const eTopo = Math.max((p.topo as number) * (p.altura as number), p.topoMm as number);
  const eFundo = Math.max((p.fundo as number) * (p.altura as number), p.fundoMm as number);
  p.altura = h;
  p.topo = Math.max(p.topo as number, Math.ceil(eTopo / h - 1e-6));
  p.fundo = Math.max(p.fundo as number, Math.ceil(eFundo / h - 1e-6));
  return p;
}

// ---------- diferenças ----------

/** Só o que difere de `base` (o selo ↺ de alterado). Ids ausentes em `atual` não entram. */
export function diferencas(base: Plano, atual: Plano): Plano {
  const d: Plano = {};
  for (const [k, v] of Object.entries(atual)) if (base[k] !== v) d[k] = v;
  return d;
}

/** Inverso de `diferencas`: `base` com as diferenças por cima (ids novos entram; `base` não é alterado). */
export const aplicarDiferencas = (base: Plano, dif: Plano | undefined): Plano => ({ ...base, ...dif });

/** Diferenças que o esquema aceita: id conhecido e valor do tipo e dentro dos limites (o resto é descartado). */
export function limparDiferencas(dif: unknown): Plano {
  const saida: Plano = {};
  if (!dif || typeof dif !== "object") return saida;
  for (const [k, v] of Object.entries(dif as Record<string, unknown>)) {
    const c = campoDe(k);
    if (c && valorValido(c, v)) saida[k] = v as Valor;
  }
  return saida;
}

// ---------- camadas e resolução ----------

export interface PerfilUsuario {
  id: string;
  nome: string;
  /** id do perfil de sistema de que herda */
  herdaDe: string;
  /** só as diferenças sobre o perfil de sistema */
  diferencas: Plano;
  /** ISO 8601; a mais recente vence ao juntar aparelhos */
  modificado: string;
  /** apagado (fica na lista para a exclusão chegar aos outros aparelhos) */
  excluido?: boolean;
}

/** Ajustes só de uma faixa de altura (mm): estrutura da fatia O2; o motor ainda não usa. */
export interface Modificador {
  nome?: string;
  zMin: number;
  zMax: number;
  diferencas: Plano;
}

export interface Camadas {
  maquina: string;
  /** perfil de sistema (padrão: "0,20 mm Padrão") */
  sistema?: string;
  usuario?: PerfilUsuario | null;
  projeto?: Plano;
  objeto?: Plano;
  modificadores?: Modificador[];
}

export interface Resolvido {
  /** todos os valores finais (id → valor) */
  valores: Plano;
  /** o `Processo` que o motor recebe */
  processo: Processo;
  suporte: TipoSuporte;
  borda: boolean;
  saia: boolean;
  /** cada faixa de Z com os valores já resolvidos sobre o objeto (só estrutura; o motor ainda não usa) */
  faixas: { nome?: string; zMin: number; zMax: number; valores: Plano }[];
}

/** O perfil final: sistema → usuário → projeto → objeto (cada camada só com diferenças); as faixas de Z vão à parte. */
export function resolver(c: Camadas): Resolvido {
  let v = planoDeSistema(c.maquina, c.sistema ?? c.usuario?.herdaDe ?? PERFIL_PADRAO);
  if (c.usuario && !c.usuario.excluido) v = aplicarDiferencas(v, limparDiferencas(c.usuario.diferencas));
  v = aplicarDiferencas(v, limparDiferencas(c.projeto));
  v = aplicarDiferencas(v, limparDiferencas(c.objeto));
  const faixas = (c.modificadores ?? []).map((m) => ({ nome: m.nome, zMin: m.zMin, zMax: m.zMax, valores: aplicarDiferencas(v, limparDiferencas(m.diferencas)) }));
  return {
    valores: v, processo: desachatar(v, maquinaPorId(c.maquina).processo),
    suporte: v.suporte as TipoSuporte, borda: !!v.borda, saia: !!v.saia, faixas,
  };
}

// ---------- ponte com o motor e com as preferências de hoje ----------

/** O que o motor lê por camada (altura, paredes, cascas, preenchimento) mais suporte, borda e saia. */
export const ajustesDe = (r: Resolvido): Ajustes => ({
  altura: r.processo.altura, paredes: r.processo.paredes, topo: r.processo.topo, fundo: r.processo.fundo,
  preenchimento: r.processo.preenchimento, padrao: r.processo.padrao, suporte: r.suporte, borda: r.borda, saia: r.saia,
});

const CHAVES_AJUSTES: (keyof Ajustes)[] = ["altura", "paredes", "topo", "fundo", "preenchimento", "padrao", "suporte", "borda", "saia"];

/**
 * Migração: os `ajustes` de hoje (preferências do navegador e `.wjslc` antigo) viram o perfil do projeto, isto é, as
 * diferenças sobre o "0,20 mm Padrão" da impressora. Suporte antigo sim/não vira o tipo do perfil. O que faltar fica no padrão.
 */
export function diferencasDeAjustes(maquinaId: string, aj: Partial<Record<keyof Ajustes, unknown>> | null | undefined): Plano {
  const base = planoBase(maquinaId);
  const atual: Plano = {};
  for (const k of CHAVES_AJUSTES) {
    let x = aj?.[k];
    if (k === "suporte" && typeof x === "boolean") x = x ? base.suporteTipo : "nenhum";
    if (x !== undefined) atual[k] = x as Valor;
  }
  return diferencas(base, limparDiferencas(atual));
}
