// "Importar pasta…" e "Importar arquivos…" no WJPDM (15/11/2026, pedido do Johann): traz uma pasta do
// computador ou do tablet, com todas as subpastas, para o cofre, mantendo a estrutura. Cada arquivo
// entra publicado (versão 1, GO-IN); vídeo, foto e áudio entram como arquivo de mídia (sem a pasta
// "(versões)"). Ficam de fora: .wjpdm, pastas "(versões)" (cópias que o próprio cofre gera) e arquivos
// de sistema. Nome repetido na pasta do cofre: uma pergunta só (substituir / pular / manter os dois).
// Aqui só o plano, puro e testável em Node (scripts/teste-sincronia.ts); quem grava é o WJPDM.

import { bloqueioDoCheckout, extensao, nomeLivre, type Arquivo, type Pasta } from "./regras";

const RAIZ = "raiz";

/** Um arquivo escolhido: caminho relativo (pastas + nome) e tamanho. */
export interface EntradaImportar {
  caminho: string[];
  tamanho: number;
}

/** O que fazer com nome repetido na pasta do cofre (uma escolha para todos). */
export type Repetido = "substituir" | "pular" | "manter";

export interface ArquivoPlanejado {
  /** índice na lista de entradas */
  entrada: number;
  pasta: string;
  nome: string;
  /** novo: arquivo novo; substituir: versão seguinte (mídia: troca o conteúdo) do `existente` */
  acao: "novo" | "substituir";
  existente?: string;
  midia: boolean;
}

export interface PlanoImportar {
  /** pastas a criar no cofre (das mais rasas para as mais fundas) */
  pastasNovas: Pasta[];
  arquivos: ArquivoPlanejado[];
  /** caminhos ignorados (.wjpdm, "(versões)", arquivos de sistema) */
  ignorados: string[];
  /** quantos nomes já existiam na pasta do cofre (para a pergunta) */
  repetidos: number;
  /** arquivos pulados: escolha "pular" ou GO-OUT de outra pessoa (com o motivo) */
  pulados: string[];
}

const SISTEMA = new Set(["desktop.ini", ".ds_store", "thumbs.db"]);
const EXT_MIDIA = new Set([
  "mp4", "mov", "m4v", "webm", "mkv", "avi", "3gp", "wmv", "mpg", "mpeg",
  "jpg", "jpeg", "png", "gif", "webp", "heic", "heif", "bmp", "tif", "tiff",
  "mp3", "wav", "m4a", "aac", "ogg", "oga", "opus", "flac", "wma",
]);

/** Vídeo, foto ou áudio (entra como arquivo de mídia). */
export const ehMidia = (nome: string) => EXT_MIDIA.has(extensao(nome));

/** Fica de fora: pasta interna do cofre, pastas "(versões)" e arquivos de sistema. */
export function ignorarNaImportacao(caminho: string[]): boolean {
  const nome = caminho[caminho.length - 1] ?? "";
  if (caminho.slice(0, -1).some((p) => p === ".wjpdm" || / \(versões\)$/.test(p))) return true;
  const n = nome.toLowerCase();
  return !nome || nome === ".wjpdm" || SISTEMA.has(n) || nome.startsWith("~$") || nome.startsWith("._");
}

/**
 * Plano da importação para a pasta `destino` do cofre. As pastas que já existem (mesmo nome, sem
 * diferenciar maiúsculas) são reaproveitadas; as que faltam são criadas. `repetido` = null: só conta
 * os nomes repetidos (para perguntar); com a escolha, decide cada um.
 */
export function planejarImportacao(
  pastas: Pasta[], arquivos: Arquivo[], destino: string, entradas: EntradaImportar[], repetido: Repetido | null,
  usuario: string, novoId: () => string, agora: string,
): PlanoImportar {
  const plano: PlanoImportar = { pastasNovas: [], arquivos: [], ignorados: [], repetidos: 0, pulados: [] };
  const todas = [...pastas];
  const filha = (pai: string, nome: string) => {
    const p = pai === RAIZ ? null : pai;
    let x = todas.find((y) => (y.pai ?? null) === p && y.nome.toLowerCase() === nome.toLowerCase());
    if (!x) {
      x = { id: novoId(), nome, pai: p, mod: agora };
      todas.push(x);
      plano.pastasNovas.push(x);
    }
    return x.id;
  };
  const vivos = arquivos.filter((a) => !a.lixeira);
  // nomes ocupados em cada pasta (os do cofre e os que esta importação já pôs lá)
  const ocupados = new Map<string, string[]>();
  const nomesEm = (pasta: string) => {
    if (!ocupados.has(pasta)) ocupados.set(pasta, vivos.filter((a) => a.pasta === pasta).map((a) => a.nome));
    return ocupados.get(pasta)!;
  };
  entradas.forEach((e, k) => {
    if (ignorarNaImportacao(e.caminho)) return void plano.ignorados.push(e.caminho.join("/"));
    let pasta = destino;
    for (const n of e.caminho.slice(0, -1)) pasta = filha(pasta, n);
    const nome = e.caminho[e.caminho.length - 1];
    const midia = ehMidia(nome);
    const existente = vivos.find((a) => a.pasta === pasta && a.nome.toLowerCase() === nome.toLowerCase());
    if (!existente) {
      nomesEm(pasta).push(nome);
      return void plano.arquivos.push({ entrada: k, pasta, nome, acao: "novo", midia });
    }
    plano.repetidos++;
    if (!repetido) return;
    if (repetido === "pular") return void plano.pulados.push(`${e.caminho.join("/")} (já existe)`);
    if (repetido === "manter") {
      const livre = nomeLivre(nome, nomesEm(pasta));
      nomesEm(pasta).push(livre);
      return void plano.arquivos.push({ entrada: k, pasta, nome: livre, acao: "novo", midia });
    }
    const b = existente.checkout && existente.checkout.usuario !== usuario ? bloqueioDoCheckout(existente, usuario) : null;
    if (b) return void plano.pulados.push(`${e.caminho.join("/")} (${b})`);
    plano.arquivos.push({ entrada: k, pasta, nome: existente.nome, acao: "substituir", existente: existente.id, midia: midia || !!existente.midia });
  });
  return plano;
}

/** Resumo do fim: "N arquivos, N pastas, N ignorados" (e os pulados, se houver). */
export function resumoImportacao(plano: PlanoImportar, feitos = plano.arquivos.length): string {
  const n = (q: number, um: string, varios: string) => `${q} ${q === 1 ? um : varios}`;
  const partes = [n(feitos, "arquivo", "arquivos"), n(plano.pastasNovas.length, "pasta", "pastas"), n(plano.ignorados.length, "ignorado", "ignorados")];
  if (plano.pulados.length) partes.push(n(plano.pulados.length, "pulado", "pulados"));
  return partes.join(", ");
}

/**
 * Registro do arquivo importado: novo (versão 1 publicada) ou a versão seguinte do existente (mídia:
 * troca o conteúdo da última versão, sem guardar a anterior). Devolve o arquivo e o blob que saiu
 * (mídia substituída), para quem grava apagar.
 */
export function registroImportado(
  p: ArquivoPlanejado, existente: Arquivo | undefined, blob: string, tamanho: number, usuario: string, agora: string,
  estadoInicial: string, idNovo: string, projeto?: string,
): { arquivo: Arquivo; sobra?: string } {
  if (p.acao === "substituir" && existente) {
    const a: Arquivo = JSON.parse(JSON.stringify(existente));
    a.soLocal = undefined;
    a.mod = agora;
    if (a.midia && a.versoes.length) {
      const v = a.versoes[a.versoes.length - 1];
      const sobra = v.blob;
      Object.assign(v, { blob, tamanho, autor: usuario, data: agora, comentario: "Importado (substituiu o arquivo)" });
      a.historico.push({ data: agora, usuario, texto: "Importado de novo: substituiu o arquivo de mídia (sem guardar versões)" });
      const usado = a.versoes.some((x) => x.blob === sobra) || a.trabalho?.blob === sobra;
      return { arquivo: a, sobra: usado ? undefined : sobra };
    }
    const n = Math.max(0, ...a.versoes.map((v) => v.n)) + 1;
    a.versoes.push({ n, blob, tamanho, autor: usuario, data: agora, comentario: "Importado", revisao: a.revisao, estado: a.estado });
    a.historico.push({ data: agora, usuario, texto: `Importado de novo: versão ${n} publicada` });
    return { arquivo: a };
  }
  const base = p.nome.replace(/\.[^.]+$/, "");
  return {
    arquivo: {
      id: idNovo, nome: p.nome, pasta: p.pasta, revisao: "", estado: estadoInicial, mod: agora,
      cartao: { descricao: base, projetista: usuario, ...(projeto ? { projeto } : {}) },
      versoes: [{ n: 1, blob, tamanho, autor: usuario, data: agora, comentario: "Importado", revisao: "", estado: estadoInicial }],
      historico: [{ data: agora, usuario, texto: "Importado para o cofre: versão 1 publicada" }],
      ...(p.midia ? { midia: true } : {}),
    },
  };
}
