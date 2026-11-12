// Sincronia entre as cópias do cofre do WJPDM (banco do aparelho, pendrive, pasta do tablet,
// Google Drive). Regras definidas pelo Johann (28/10/2026):
// - o que falta numa cópia é copiado; registro alterado nas duas: a alteração MAIS RECENTE vence;
// - a versão que perdeu um conflito não some: vai para a lixeira do cofre (30 dias);
// - exclusões se propagam pela lixeira; a lixeira se esvazia sozinha após 30 dias.
// Tudo puro e testável em Node (scripts/teste-sincronia.ts); quem lê e grava cada cópia é um
// Repositorio.

import type { Arquivo, Fluxo, Item, Pasta, ReferenciaArquivo } from "./regras";
import { extensao, nomeLivre } from "./regras";
import { analisarEspelho, decisaoVazia, type DecisaoEspelho, type EspelhoVisto, type OpcoesEspelho, type RelatoFora } from "./espelho";

export interface MetaCofre {
  id: "meta";
  nome: string;
  usuario: string;
  mascara: string;
  /** fluxo de trabalho editável (ausente: o de fábrica) */
  fluxo?: Fluxo;
  mod?: string;
}

/** Registro destruído (saiu da lixeira): some de todas as cópias. */
export interface Exclusao {
  id: string;
  tipo: "arquivo" | "pasta" | "item" | "referencia";
  data: string;
}

/** Índice do cofre: tudo menos o conteúdo dos arquivos (blobs). */
export interface Indice {
  formato: "wjpdm-indice";
  versao: 1;
  meta: MetaCofre | null;
  pastas: Pasta[];
  arquivos: Arquivo[];
  itens: Item[];
  /** tabela de referências entre arquivos (montagem → peças, desenho → modelo) */
  referencias: ReferenciaArquivo[];
  exclusoes: Exclusao[];
}

export const indiceVazio = (): Indice => ({ formato: "wjpdm-indice", versao: 1, meta: null, pastas: [], arquivos: [], itens: [], referencias: [], exclusoes: [] });

/** Uma cópia do cofre (banco do aparelho, pasta do pendrive/tablet, Drive). */
export interface Repositorio {
  nome: string;
  /**
   * Cópia de publicação (pendrive, Drive): os arquivos VISÍVEIS (pastas legíveis e "(versões)")
   * mostram só o que passou por GO-IN. O índice interno (.wjpdm) e os conteúdos recebem tudo,
   * inclusive a cópia de trabalho e o que nunca foi publicado (06/11/2026): o que se salva num
   * aparelho abre em qualquer outro.
   */
  publicado?: boolean;
  lerIndice(): Promise<Indice | null>;
  gravarIndice(i: Indice): Promise<void>;
  listarBlobs(): Promise<Set<string>>;
  lerBlob(id: string): Promise<Blob | undefined>;
  gravarBlob(id: string, b: Blob): Promise<void>;
  apagarBlob?(id: string): Promise<void>;
  /**
   * Onde estão de fato os arquivos e pastas que o app gravou no espelho legível (mudanças feitas
   * fora do app, src/pdm/espelho.ts). Lido antes de gravar os visíveis.
   */
  lerEspelho?(i: Indice): Promise<EspelhoVisto>;
  /**
   * Arquivos visíveis (pastas com nomes legíveis), para abrir o cofre em qualquer computador.
   * `espelho`: o que fica onde está (pasta criada à mão no Drive), onde cada item está agora e o que
   * foi editado fora do app (regravar com o conteúdo do cofre).
   */
  gravarVisiveis?(i: Indice, lerBlob: (id: string) => Promise<Blob | undefined>, espelho?: DecisaoEspelho): Promise<void>;
}

const DIA = 86400000;
export const DIAS_LIXEIRA = 30;
const mod = (x: { mod?: string }) => x.mod ?? "";

/** Blobs que o arquivo usa (versões e cópia de trabalho). */
export const blobsDoArquivo = (a: Arquivo) => [...a.versoes.map((v) => v.blob), ...(a.trabalho ? [a.trabalho.blob] : [])];

/** Conteúdo atual do arquivo: a cópia de trabalho ou a última versão. */
export const blobAtual = (a: Arquivo) => a.trabalho?.blob ?? a.versoes[a.versoes.length - 1]?.blob;

/**
 * O perdedor tem uma versão publicada que o vencedor não tem (seria perdida)? A cópia de trabalho e
 * o rascunho de um arquivo nunca publicado (soLocal) são substituídos a cada salvar: a cópia mais
 * antiga deles é só um salvar anterior, não um conflito.
 */
function perderiaConteudo(vencedor: Arquivo, perdedor: Arquivo): boolean {
  if (perdedor.soLocal) return false;
  const tem = new Set(blobsDoArquivo(vencedor));
  return perdedor.versoes.some((v) => !tem.has(v.blob));
}

/** Cópia do perdedor na lixeira, com id fixo (todas as cópias do cofre geram a mesma). */
function copiaDeConflito(p: Arquivo): Arquivo {
  const ext = extensao(p.nome);
  const base = ext ? p.nome.slice(0, -(ext.length + 1)) : p.nome;
  const dia = mod(p).slice(0, 10) || "sem data";
  return {
    ...JSON.parse(JSON.stringify(p)),
    id: `${p.id}~${mod(p)}`,
    nome: `${base} (conflito ${dia})${ext ? `.${ext}` : ""}`,
    checkout: undefined,
    lixeira: true,
    lixeiraData: mod(p),
    historico: [...p.historico, { data: mod(p), usuario: "WJPDM", texto: "Versão mais antiga de um conflito entre cópias do cofre (guardada na lixeira)" }],
  };
}

/**
 * Junta os índices de todas as cópias. Por registro (id): fica o de alteração mais recente;
 * exclusão mais nova que o registro o remove. Arquivos em conflito (o perdedor tinha conteúdo
 * que o vencedor não tem) geram uma cópia na lixeira. Lixeira com mais de 30 dias vira exclusão.
 */
export function mesclar(indices: Indice[], agora: string): { indice: Indice; conflitos: string[] } {
  const r = indiceVazio();
  const conflitos: string[] = [];
  // exclusões: a mais recente de cada id
  const exc = new Map<string, Exclusao>();
  for (const i of indices) for (const e of i.exclusoes ?? []) if (!exc.has(e.id) || exc.get(e.id)!.data < e.data) exc.set(e.id, e);
  // meta: a mais recente
  for (const i of indices) if (i.meta && (!r.meta || mod(i.meta) > mod(r.meta))) r.meta = i.meta;

  const juntar = <T extends { id: string; mod?: string }>(lista: (i: Indice) => T[], aoEscolher?: (v: T, outros: T[]) => void): T[] => {
    const grupos = new Map<string, T[]>();
    for (const i of indices) for (const x of lista(i) ?? []) grupos.set(x.id, [...(grupos.get(x.id) ?? []), x]);
    const out: T[] = [];
    for (const [id, g] of grupos) {
      const v = g.reduce((a, b) => (mod(b) > mod(a) ? b : a));
      const e = exc.get(id);
      if (e && e.data >= mod(v)) continue; // destruído depois da última alteração
      if (e) exc.delete(id); // recriado/alterado depois da exclusão: vale o registro
      aoEscolher?.(v, g.filter((x) => x !== v));
      out.push(v);
    }
    return out;
  };

  r.pastas = juntar((i) => i.pastas);
  r.itens = juntar((i) => i.itens);
  r.referencias = juntar((i) => i.referencias ?? []);
  const extras: Arquivo[] = [];
  r.arquivos = juntar(
    (i) => i.arquivos,
    (v, outros) => {
      for (const o of outros) {
        if (mod(o) === mod(v) || !perderiaConteudo(v, o)) continue;
        const c = copiaDeConflito(o);
        if (!extras.some((x) => x.id === c.id)) {
          extras.push(c);
          conflitos.push(v.nome);
        }
      }
    },
  );
  for (const c of extras) {
    const e = exc.get(c.id);
    if (!(e && e.data >= mod(c)) && !r.arquivos.some((x) => x.id === c.id)) r.arquivos.push(c);
  }
  // lixeira vencida (30 dias): vira exclusão em todas as cópias
  const limite = new Date(Date.parse(agora) - DIAS_LIXEIRA * DIA).toISOString();
  r.arquivos = r.arquivos.filter((a) => {
    if (a.lixeira && a.lixeiraData && a.lixeiraData < limite) {
      exc.set(a.id, { id: a.id, tipo: "arquivo", data: agora });
      return false;
    }
    return true;
  });
  r.exclusoes = [...exc.values()];
  return { indice: r, conflitos };
}

/** O que uma cópia de publicação recebe: só versões que passaram por GO-IN. */
export function vistaPublicada(i: Indice): Indice {
  const soLocal = new Set(i.arquivos.filter((a) => a.soLocal).map((a) => a.id));
  return {
    ...i,
    arquivos: i.arquivos.filter((a) => !a.soLocal).map((a) => (a.trabalho ? { ...a, trabalho: undefined } : a)),
    // referências de arquivos nunca publicados ficam no dispositivo
    referencias: (i.referencias ?? []).filter((r) => !soLocal.has(r.pai)),
  };
}

/** Todos os blobs que o índice usa. */
export function blobsDoIndice(i: Indice): Set<string> {
  return new Set(i.arquivos.flatMap(blobsDoArquivo));
}

/** Caminho legível do arquivo no cofre (nomes das pastas + nome do arquivo). */
export function caminhoDoArquivo(i: Indice, a: Arquivo): string[] {
  const nomes: string[] = [];
  const porId = new Map(i.pastas.map((p) => [p.id, p]));
  let p = porId.get(a.pasta);
  const vistos = new Set<string>();
  while (p && !vistos.has(p.id)) {
    vistos.add(p.id);
    nomes.unshift(p.nome);
    p = p.pai ? porId.get(p.pai) : undefined;
  }
  return [...nomes, a.nome];
}

/** Arquivo legível numa cópia do cofre: o atual e, ao lado, a pasta com uma cópia de cada versão. */
export interface Visivel {
  /** id do arquivo, ou `${id}#v${n}` para a versão n */
  chave: string;
  caminho: string[];
  blob: string;
  versao?: boolean;
}

/**
 * Tudo o que a cópia em disco/Drive mostra: `CAD/Suporte.wjcad` (atual: a cópia de trabalho ou
 * a última versão) e `CAD/Suporte (versões)/Suporte v1.wjcad`, `v2`… (uma por GO-IN, com a
 * revisão quando houver). O app mostra só os arquivos; as pastas de versões são para quem abre o
 * pendrive, o Drive ou a pasta do dispositivo.
 */
export function visiveisDoIndice(i: Indice): Visivel[] {
  const out: Visivel[] = [];
  for (const a of i.arquivos) {
    const blob = blobAtual(a);
    if (a.lixeira || !blob) continue;
    const caminho = caminhoDoArquivo(i, a);
    out.push({ chave: a.id, caminho, blob });
    const nome = caminho[caminho.length - 1];
    const ponto = nome.lastIndexOf(".");
    const base = ponto > 0 ? nome.slice(0, ponto) : nome, ext = ponto > 0 ? nome.slice(ponto) : "";
    for (const v of a.versoes) {
      if (!v.blob) continue;
      out.push({ chave: `${a.id}#v${v.n}`, caminho: [...caminho.slice(0, -1), `${base} (versões)`, `${base} v${v.n}${v.revisao ? ` rev ${v.revisao}` : ""}${ext}`], blob: v.blob, versao: true });
    }
  }
  return out;
}

/** Caminho legível de cada pasta do cofre (inclusive as vazias), para criar/apagar no disco. */
export function caminhosDasPastas(i: Indice): string[][] {
  return i.pastas.map((p) => caminhoDoArquivo(i, { pasta: p.id, nome: "" } as Arquivo).slice(0, -1));
}

/** Pasta onde a sincronia recolhe os arquivos cuja pasta não existe mais (id fixo: todas as cópias geram a mesma). */
export const PASTA_RECUPERADOS = { id: "recuperados", nome: "Recuperados" } as const;

/**
 * Arquivos órfãos (12/11/2026, caso real do cofre do Johann): a pasta foi excluída numa cópia enquanto
 * o arquivo entrava nela em outra (ou por versão antiga do app), e a exclusão da pasta venceu na mescla
 * sem levar o arquivo. Ficava com `pasta` apontando para o nada: o WJPDM não o mostrava e o Drive o
 * publicava solto na raiz. Aqui ele vai para a pasta "Recuperados" (a que já existir na raiz com esse
 * nome, senão uma nova), com nome livre e histórico. Os da lixeira ficam como estão (restaurar já os
 * leva para a raiz).
 */
export function recuperarOrfaos(i: Indice, agora: string): { indice: Indice; recuperados: string[] } {
  const existe = new Set(i.pastas.map((p) => p.id));
  const orfaos = i.arquivos.filter((a) => !a.lixeira && a.pasta !== "raiz" && !existe.has(a.pasta));
  if (!orfaos.length) return { indice: i, recuperados: [] };
  const nomeRec = PASTA_RECUPERADOS.nome.toLowerCase();
  let pasta = i.pastas.find((p) => p.id === PASTA_RECUPERADOS.id) ?? i.pastas.find((p) => !p.pai && p.nome.toLowerCase() === nomeRec);
  const pastas = [...i.pastas];
  let exclusoes = i.exclusoes;
  if (!pasta) {
    pasta = { id: PASTA_RECUPERADOS.id, nome: PASTA_RECUPERADOS.nome, pai: null, mod: agora };
    pastas.push(pasta);
    exclusoes = exclusoes.filter((e) => e.id !== pasta!.id); // recriada depois de excluída
  }
  const destino = pasta.id;
  const nomes = i.arquivos.filter((a) => !a.lixeira && a.pasta === destino).map((a) => a.nome);
  const recuperados: string[] = [];
  const porId = new Map<string, Arquivo>();
  for (const a of orfaos) {
    const nome = nomeLivre(a.nome, nomes);
    nomes.push(nome);
    recuperados.push(nome);
    const texto = `Pasta original não encontrada (excluída em outra cópia do cofre): levado para "${pasta.nome}"${nome !== a.nome ? ` como ${nome}` : ""}`;
    porId.set(a.id, { ...a, nome, pasta: destino, mod: agora, historico: [...a.historico, { data: agora, usuario: "WJPDM", texto }] });
  }
  return { indice: { ...i, pastas, exclusoes, arquivos: i.arquivos.map((a) => porId.get(a.id) ?? a) }, recuperados };
}

export interface ResultadoSincronia {
  indice: Indice;
  conflitos: string[];
  /** arquivos cuja pasta não existia mais, levados para "Recuperados" (nomes) */
  recuperados: string[];
  /** blobs copiados entre as cópias */
  copiados: number;
  /** blobs que nenhuma cópia tem (arquivo incompleto) */
  faltando: string[];
  /** cópias que falharam (desconectadas no meio) */
  falhas: { repo: string; erro: string }[];
  /** mudanças feitas fora do app nos espelhos (Drive, pendrive, pasta), já aplicadas no cofre ou desfeitas */
  foraDoApp: RelatoFora[];
}

/**
 * Iguala as cópias: junta os índices, copia os blobs que faltam em cada uma, grava os arquivos
 * visíveis e o índice comum. Uma cópia que falhar (pendrive arrancado) não impede as outras.
 */
export async function sincronizar(repos: Repositorio[], agora: string, opcoes: OpcoesEspelho = {}): Promise<ResultadoSincronia> {
  const falhas: { repo: string; erro: string }[] = [];
  const vivos: Repositorio[] = [], indices: Indice[] = [];
  for (const r of repos) {
    try {
      indices.push((await r.lerIndice()) ?? indiceVazio());
      vivos.push(r);
    } catch (e) {
      falhas.push({ repo: r.nome, erro: (e as Error).message ?? String(e) });
    }
  }
  const mescla = mesclar(indices, agora);
  let indice = mescla.indice;
  const conflitos = mescla.conflitos;
  // mudanças feitas fora do app em cada espelho (antes de gravar nele): aplicadas no índice que
  // todas as cópias recebem (decisão do Johann, 12/11/2026); as exceções são desfeitas na cópia
  const espelhos = new Map<Repositorio, DecisaoEspelho>();
  const foraDoApp: RelatoFora[] = [];
  for (const r of [...vivos]) {
    if (!r.lerEspelho) continue;
    try {
      const a = analisarEspelho(indice, await r.lerEspelho(indice), agora, opcoes);
      indice = a.indice;
      conflitos.push(...a.conflitos);
      foraDoApp.push(...a.relatos);
      espelhos.set(r, a);
    } catch (e) {
      // sem saber o que mudou lá, não grava (poderia desfazer o que o Johann fez)
      falhas.push({ repo: r.nome, erro: (e as Error).message ?? String(e) });
      vivos.splice(vivos.indexOf(r), 1);
    }
  }
  // nenhum arquivo sai desta sincronia sem pasta (a exclusão de uma pasta pode vencer o arquivo
  // posto nela em outra cópia): os órfãos vão para "Recuperados" em todas as cópias
  const rec = recuperarOrfaos(indice, agora);
  indice = rec.indice;
  // todas as cópias guardam o índice inteiro (salvar em um aparelho abre no outro); as de
  // publicação só MOSTRAM o publicado nos arquivos visíveis
  const visiveis = (r: Repositorio) => (r.publicado ? vistaPublicada(indice) : indice);
  const precisaDe = new Map(repos.map((r) => [r, blobsDoIndice(indice)]));
  const tem = new Map<Repositorio, Set<string>>();
  for (const r of [...vivos]) {
    try {
      tem.set(r, await r.listarBlobs());
    } catch (e) {
      falhas.push({ repo: r.nome, erro: (e as Error).message ?? String(e) });
      vivos.splice(vivos.indexOf(r), 1);
    }
  }
  let copiados = 0;
  const faltando: string[] = [];
  const todos = new Set(vivos.flatMap((r) => [...precisaDe.get(r)!]));
  for (const id of todos) {
    const sem = vivos.filter((r) => precisaDe.get(r)!.has(id) && !tem.get(r)!.has(id));
    if (!sem.length) continue;
    const fonte = vivos.find((r) => tem.get(r)!.has(id));
    const b = fonte && (await fonte.lerBlob(id).catch(() => undefined));
    if (!b) {
      faltando.push(id);
      continue;
    }
    for (const r of sem) {
      try {
        await r.gravarBlob(id, b);
        tem.get(r)!.add(id);
        copiados++;
      } catch (e) {
        if (!falhas.some((f) => f.repo === r.nome)) falhas.push({ repo: r.nome, erro: (e as Error).message ?? String(e) });
      }
    }
  }
  for (const r of vivos) {
    if (falhas.some((f) => f.repo === r.nome)) continue;
    try {
      await r.gravarVisiveis?.(visiveis(r), (id) => r.lerBlob(id), espelhos.get(r) ?? decisaoVazia());
      await r.gravarIndice(indice);
      // blobs que nenhum arquivo usa mais (destruídos): liberam espaço
      const precisa = precisaDe.get(r)!;
      if (r.apagarBlob) for (const id of tem.get(r)!) if (!precisa.has(id)) await r.apagarBlob(id).catch(() => {});
    } catch (e) {
      falhas.push({ repo: r.nome, erro: (e as Error).message ?? String(e) });
    }
  }
  return { indice, conflitos, recuperados: rec.recuperados, copiados, faltando, falhas, foraDoApp };
}
