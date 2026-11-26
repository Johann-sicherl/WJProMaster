// WJSlicer3D: perfis do usuário num arquivo único do cofre (`Perfis do usuário.wjprf`, pasta "Impressão 3D"), igual em
// todos os aparelhos, como a Biblioteca de custos (`.wjcus`, `orcamentoUi.ts`). Cada perfil guarda só as diferenças sobre
// um perfil de sistema (`camadas.ts`). As funções puras (empacotar, ler, juntar) são testadas em Node; as de cofre só
// chamam `lerArquivoFixo`/`gravarArquivoFixo` (importados na hora de usar, para o teste em Node não carregar o navegador).
// A extensão `.wjprf` fica FORA de `EXT_DA_FACE`/`APPS` de propósito (como a `.wjcus`): abrir o arquivo como projeto
// ligaria o arquivo ao app e o próximo salvar de projeto o sobrescreveria.

import { limparDiferencas, PERFIL_PADRAO, PERFIS_SISTEMA, type PerfilUsuario } from "./camadas";

export const EXTENSAO_PERFIS = "wjprf";
export const NOME_PERFIS = "Perfis do usuário.wjprf";

export interface BibliotecaPerfis {
  formato: typeof EXTENSAO_PERFIS;
  versao: 1;
  perfis: PerfilUsuario[];
}

export const perfisVazios = (): BibliotecaPerfis => ({ formato: EXTENSAO_PERFIS, versao: 1, perfis: [] });

const agora = () => new Date().toISOString();

/** Perfil novo do usuário (sem diferenças ainda), herdando de um perfil de sistema. */
export function novoPerfil(nome: string, herdaDe: string = PERFIL_PADRAO, id = `u${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`): PerfilUsuario {
  return { id, nome: nome.trim() || "Meu perfil", herdaDe: PERFIS_SISTEMA.some((p) => p.id === herdaDe) ? herdaDe : PERFIL_PADRAO, diferencas: {}, modificado: agora() };
}

/** Grava (inclui ou troca) um perfil; marca como modificado agora. */
export function salvarPerfil(b: BibliotecaPerfis, p: PerfilUsuario): BibliotecaPerfis {
  const novo: PerfilUsuario = { ...p, excluido: undefined, modificado: agora() };
  return { ...b, perfis: b.perfis.some((x) => x.id === p.id) ? b.perfis.map((x) => (x.id === p.id ? novo : x)) : [...b.perfis, novo] };
}

/** Exclui: o perfil fica marcado (o cofre propaga a exclusão para os outros aparelhos). */
export const excluirPerfil = (b: BibliotecaPerfis, id: string): BibliotecaPerfis => ({
  ...b, perfis: b.perfis.map((x) => (x.id === id ? { ...x, excluido: true, modificado: agora() } : x)),
});

/** Perfis que o usuário vê (sem os excluídos), por nome. */
export const perfisAtivos = (b: BibliotecaPerfis) => b.perfis.filter((p) => !p.excluido).sort((a, c) => a.nome.localeCompare(c.nome, "pt-BR"));

export function empacotarPerfis(b: BibliotecaPerfis): string {
  return JSON.stringify(b);
}

/** Lê o texto de um arquivo `.wjprf` (perfil inválido é descartado; diferenças fora do esquema são limpas). */
export function lerPerfis(texto: string): BibliotecaPerfis {
  let j: Partial<BibliotecaPerfis>;
  try {
    j = JSON.parse(texto);
  } catch {
    throw new Error("O arquivo não é uma lista de perfis do WJSlicer3D.");
  }
  if (j.formato !== EXTENSAO_PERFIS || !Array.isArray(j.perfis)) throw new Error("O arquivo não é uma lista de perfis do WJSlicer3D.");
  const ids = new Set<string>();
  const perfis: PerfilUsuario[] = [];
  for (const x of j.perfis as Partial<PerfilUsuario>[]) {
    if (!x || typeof x.id !== "string" || !x.id || ids.has(x.id) || typeof x.nome !== "string" || !x.nome.trim()) continue;
    ids.add(x.id);
    perfis.push({
      id: x.id, nome: x.nome, herdaDe: PERFIS_SISTEMA.some((p) => p.id === x.herdaDe) ? x.herdaDe! : PERFIL_PADRAO,
      diferencas: limparDiferencas(x.diferencas), modificado: typeof x.modificado === "string" ? x.modificado : "", ...(x.excluido ? { excluido: true } : {}),
    });
  }
  return { formato: EXTENSAO_PERFIS, versao: 1, perfis };
}

/** Junta duas listas (dois aparelhos): perfil que só existe numa entra; nos dois, o mais recente vence (empate: o de `a`). */
export function juntarPerfis(a: BibliotecaPerfis, b: BibliotecaPerfis): BibliotecaPerfis {
  const mapa = new Map(a.perfis.map((p) => [p.id, p]));
  for (const p of b.perfis) {
    const q = mapa.get(p.id);
    if (!q || p.modificado > q.modificado) mapa.set(p.id, p);
  }
  return { ...a, perfis: [...mapa.values()] };
}

// ---------- cofre ----------

/** Lê o arquivo de perfis do cofre; null se ainda não existe. */
export async function lerPerfisDoCofre(): Promise<BibliotecaPerfis | null> {
  const { lerArquivoFixo } = await import("../comum/cofre");
  const r = await lerArquivoFixo("slicer", NOME_PERFIS);
  return r ? lerPerfis(r.texto) : null;
}

/** Grava o arquivo de perfis no cofre (publicado, sem GO-OUT, substitui sem versões). Devolve onde chegou. */
export async function gravarPerfisNoCofre(b: BibliotecaPerfis): Promise<string> {
  const { gravarArquivoFixo } = await import("../comum/cofre");
  const r = await gravarArquivoFixo("slicer", NOME_PERFIS, new Blob([empacotarPerfis(b)], { type: "application/json" }), { semVersoes: true });
  return r.mensagem;
}

/** Junta a lista local com a do cofre e grava de volta se algo mudou. Devolve a lista final. */
export async function sincronizarPerfis(local: BibliotecaPerfis): Promise<{ lista: BibliotecaPerfis; mensagem: string }> {
  const doCofre = await lerPerfisDoCofre();
  const lista = doCofre ? juntarPerfis(local, doCofre) : local;
  const mudou = !doCofre || empacotarPerfis(ordenar(lista)) !== empacotarPerfis(ordenar(doCofre));
  return { lista, mensagem: mudou && (lista.perfis.length || doCofre) ? await gravarPerfisNoCofre(lista) : "" };
}

const ordenar = (b: BibliotecaPerfis): BibliotecaPerfis => ({ ...b, perfis: [...b.perfis].sort((x, y) => x.id.localeCompare(y.id)) });
