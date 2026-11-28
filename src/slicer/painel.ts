// WJSlicer3D: lógica PURA do painel de processo gerado do esquema (fatia L1b, docs/global/wjslicer3d-layout.md §4).
// A tela (painelUi.ts) só desenha o que sai daqui: grupos de cada aba por nível (Simples/Avançado/Especialista), busca sem acento,
// texto ↔ valor de cada tipo de campo, o plano de diferenças do projeto e o selo ↺ contra o perfil. Testada em Node (scripts/teste-painel.ts).
// Campos ocultos (⚪/⛔) nunca saem daqui; ⚙ de Impressora e Filamento (origem maquina/material) são da fatia L3.

import { ABAS_PROCESSO, ESQUEMA, NOMES_ABAS, campoDe, camposDoProcesso, valorValido, visivelAgora, type Aba, type Campo, type Estado, type Nivel, type Plano, type Valor } from "./esquema";
import { diferencas, planoDeSistema, resolver } from "./camadas";

export { visivelAgora };

export const NIVEIS: readonly Nivel[] = ["simples", "avancado", "especialista"];
export const NOMES_NIVEIS: Record<Nivel, string> = { simples: "Simples", avancado: "Avançado", especialista: "Especialista" };

/** Selo de estado de cada campo: o que o motor faz com ele (nada finge funcionar). */
export const SELOS: Record<Exclude<Estado, "oculto">, { glifo: string; titulo: string }> = {
  motor: { glifo: "✅", titulo: "Aplicado: muda o resultado da fatia" },
  parcial: { glifo: "🟡", titulo: "Aplicado em parte" },
  naoAplicado: { glifo: "🔶", titulo: "Ainda não aplicado: fica guardado no perfil, mas não muda o resultado" },
};

/** Campos do projeto (não do perfil): não entram no ↺ nem nos perfis salvos. */
export const FORA_DO_PERFIL: ReadonlySet<string> = new Set(["suporte", "borda", "saia"]);

/** O campo aparece neste nível? (Simples ⊂ Avançado ⊂ Especialista.) */
export const noNivel = (c: Campo, nivel: Nivel) => NIVEIS.indexOf(c.nivel) <= NIVEIS.indexOf(nivel);

/** Todo campo da tela do processo: as seis abas, sem os ocultos (⚪/⛔) e sem os de Impressora/Filamento. */
export const camposDoPainel = (): Campo[] => ESQUEMA.filter((c) => c.estado !== "oculto" && (ABAS_PROCESSO as readonly Aba[]).includes(c.aba));

export interface GrupoPainel {
  aba: Aba;
  nome: string;
  campos: Campo[];
}

function agrupar(campos: Campo[]): GrupoPainel[] {
  const mapa = new Map<string, GrupoPainel>();
  for (const c of campos) {
    const k = `${c.aba}/${c.grupo}`;
    let g = mapa.get(k);
    if (!g) mapa.set(k, (g = { aba: c.aba, nome: c.grupo, campos: [] }));
    g.campos.push(c);
  }
  return [...mapa.values()];
}

/** Grupos de uma aba no nível escolhido (ordem do esquema; grupo sem campo no nível não aparece). */
export const gruposDoPainel = (aba: Aba, nivel: Nivel): GrupoPainel[] => agrupar(camposDoPainel().filter((c) => c.aba === aba && noNivel(c, nivel)));

/** Grupo começa aberto quando tem algum campo Simples (os de nível maior começam recolhidos). */
export const grupoComecaAberto = (g: GrupoPainel) => g.campos.some((c) => c.nivel === "simples");

// ---------- busca ----------

export const semAcento = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/** Busca de parâmetro (sem acento, todas as palavras): acha em todas as abas e em todos os níveis, nunca os ocultos. */
export function buscarCampos(consulta: string): GrupoPainel[] {
  const palavras = semAcento(consulta).split(/\s+/).filter(Boolean);
  if (!palavras.length) return [];
  const ok = camposDoPainel().filter((c) => {
    const palheiro = semAcento(`${c.rotulo} ${c.grupo} ${NOMES_ABAS[c.aba]} ${c.id} ${c.nota ?? ""} ${(c.opcoes ?? []).map((o) => o[1]).join(" ")}`);
    return palavras.every((p) => palheiro.includes(p));
  });
  return agrupar(ok);
}

// ---------- texto ↔ valor ----------

const arredondar = (n: number) => String(Math.round(n * 1e4) / 1e4);

/** Valor do campo como aparece na caixa (percentual em %, com vírgula só na tela de quem digita). */
export function valorParaTexto(c: Campo, v: Valor | undefined): string {
  if (v === undefined) return "";
  if (c.tipo === "percentual") return arredondar(Number(v) * 100);
  if (typeof v === "number") return arredondar(v);
  return String(v);
}

/** Limites do campo na unidade da caixa (percentual em %). */
export const limitesDaCaixa = (c: Campo): { min?: number; max?: number } => {
  const f = c.tipo === "percentual" ? 100 : 1;
  return { min: c.min === undefined ? undefined : c.min * f, max: c.max === undefined ? undefined : c.max * f };
};

/** Texto digitado → valor do campo (aceita vírgula; inteiro arredonda; fora dos limites vira o limite); inválido → undefined. */
export function textoParaValor(c: Campo, texto: string): Valor | undefined {
  if (c.tipo === "texto") return texto;
  if (c.tipo !== "numero" && c.tipo !== "inteiro" && c.tipo !== "percentual") return undefined;
  const t = texto.trim().replace(",", ".");
  if (!t) return undefined;
  let n = Number(t);
  if (!Number.isFinite(n)) return undefined;
  if (c.tipo === "percentual") n /= 100;
  if (c.tipo === "inteiro") n = Math.round(n);
  if (c.min !== undefined) n = Math.max(c.min, n);
  if (c.max !== undefined) n = Math.min(c.max, n);
  return c.tipo === "percentual" ? Math.round(n * 1e6) / 1e6 : n;
}

// ---------- plano do projeto (diferenças sobre o 0,20 mm Padrão) ----------

/** Todos os valores de agora (perfil de fábrica + diferenças do projeto). */
export const valoresDoPlano = (maquina: string, plano: Plano): Plano => resolver({ maquina, projeto: plano }).valores;

/** Muda um campo; devolve o novo plano (só diferenças). Valor inválido: o plano continua o mesmo. */
export function definirValor(maquina: string, plano: Plano, id: string, v: Valor): Plano {
  const c = campoDe(id);
  if (!c || !valorValido(c, v)) return plano;
  return diferencas(planoDeSistema(maquina), { ...valoresDoPlano(maquina, plano), [id]: v });
}

/** Ids que o selo ↺ confere: campos do processo e do perfil (não os do projeto nem os ocultos), com valor diferente do perfil. */
export function alterados(perfil: Plano, atual: Plano): string[] {
  const ids: string[] = [];
  for (const c of camposDoProcesso()) if (c.estado !== "oculto" && !FORA_DO_PERFIL.has(c.id) && perfil[c.id] !== atual[c.id]) ids.push(c.id);
  return ids;
}

/** Volta os campos ao valor do perfil. */
export function voltarCampos(maquina: string, plano: Plano, perfil: Plano, ids: readonly string[]): Plano {
  const novo = valoresDoPlano(maquina, plano);
  for (const id of ids) if (id in perfil) novo[id] = perfil[id];
  return diferencas(planoDeSistema(maquina), novo);
}

/** Troca de perfil: todos os valores viram os dele; suporte, borda e saia (do projeto) ficam como estavam. */
export function aplicarValoresDoPerfil(maquina: string, plano: Plano, perfil: Plano): Plano {
  const atual = valoresDoPlano(maquina, plano);
  const novo = { ...perfil };
  for (const k of FORA_DO_PERFIL) novo[k] = atual[k];
  return diferencas(planoDeSistema(maquina), novo);
}

/** O que um perfil do usuário guarda: só as diferenças dos campos do perfil sobre o perfil de sistema de que herda. */
export function diferencasParaPerfil(sistema: Plano, atual: Plano): Plano {
  const d: Plano = {};
  for (const c of camposDoProcesso()) if (!FORA_DO_PERFIL.has(c.id) && c.id in atual && sistema[c.id] !== atual[c.id]) d[c.id] = atual[c.id];
  return d;
}
