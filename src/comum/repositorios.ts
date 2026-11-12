// Cópias do cofre do WJPDM no navegador: o banco do aparelho (IndexedDB, cópia de trabalho de
// todos os apps) e pastas de disco (pendrive, pasta padrão do tablet). O Google Drive entra com a
// mesma interface (Repositorio) quando o acesso ao Google estiver configurado.
//
// Pasta de disco:  <raiz>/WJPDM/<pastas>/<arquivo>   ← arquivo atual, abre em qualquer computador
//                  <raiz>/WJPDM/<pastas>/<nome> (versões)/<nome> v<n>.<ext>   ← cópia de cada GO-IN
//                  <raiz>/WJPDM/.wjpdm/indice.json   ← pastas, cartões, estados, versões, histórico
//                  <raiz>/WJPDM/.wjpdm/blobs/<id>    ← conteúdo de cada versão (nunca muda)
//                  <raiz>/WJPDM/.wjpdm/visiveis.json e pastas.json ← o que o app pôs em <pastas>
//
// Mudanças feitas à mão no pendrive ou na pasta do dispositivo (12/11/2026): arquivo que saiu do
// lugar é achado pelo conteúdo (blob); pasta renomeada/movida, pelos arquivos de dentro.

import { Armazem } from "./armazem";
import { indiceVazio, visiveisDoIndice, type Indice, type MetaCofre, type Repositorio } from "../pdm/sincronia";
import { aplicarTrocas, caminhoDaPasta, decisaoVazia, type DecisaoEspelho, type EspelhoVisto, type ItemVisto } from "../pdm/espelho";
import type { Arquivo, Item, Pasta, ReferenciaArquivo } from "../pdm/regras";

// ---------- banco do aparelho ----------

export class RepositorioAparelho implements Repositorio {
  nome = "aparelho";
  constructor(private db: Armazem) {}
  async lerIndice(): Promise<Indice> {
    return {
      ...indiceVazio(),
      meta: (await this.db.ler<MetaCofre>("meta", "meta")) ?? null,
      pastas: await this.db.todos<Pasta>("pastas"),
      arquivos: await this.db.todos<Arquivo>("arquivos"),
      itens: await this.db.todos<Item>("itens"),
      referencias: await this.db.todos<ReferenciaArquivo>("referencias"),
      exclusoes: await this.db.todos("exclusoes"),
    };
  }
  async gravarIndice(i: Indice) {
    const iguala = async <T extends { id: string }>(loja: string, lista: T[]) => {
      const novos = new Set(lista.map((x) => x.id));
      for (const id of await this.db.chaves(loja)) if (!novos.has(id)) await this.db.apagar(loja, id);
      for (const x of lista) await this.db.por(loja, x);
    };
    if (i.meta) await this.db.por("meta", i.meta);
    await iguala("pastas", i.pastas);
    await iguala("arquivos", i.arquivos);
    await iguala("itens", i.itens);
    await iguala("referencias", i.referencias ?? []);
    await iguala("exclusoes", i.exclusoes);
  }
  async listarBlobs() {
    return new Set(await this.db.chaves("blobs"));
  }
  lerBlob(id: string) {
    return this.db.blob(id);
  }
  gravarBlob(id: string, b: Blob) {
    return this.db.porBlob(id, b);
  }
  apagarBlob(id: string) {
    return this.db.apagar("blobs", id);
  }
}

// ---------- pasta de disco (pendrive, tablet) ----------

type Permissao = "granted" | "denied" | "prompt";
export interface PastaDisco extends FileSystemDirectoryHandle {
  queryPermission?(o: { mode: "readwrite" }): Promise<Permissao>;
  requestPermission?(o: { mode: "readwrite" }): Promise<Permissao>;
}

/** Permissão de escrita; `pedir` mostra o "Permitir" do navegador (precisa de um toque recente). */
export async function permissao(p: PastaDisco, pedir: boolean): Promise<boolean> {
  if (typeof p.queryPermission !== "function") return true; // pasta interna do navegador
  if ((await p.queryPermission({ mode: "readwrite" })) === "granted") return true;
  return pedir && (await p.requestPermission?.({ mode: "readwrite" })) === "granted";
}

const nomeSeguro = (n: string) => n.replace(/[\\/:*?"<>|]/g, "_").replace(/^\.+/, "_") || "_";
const semAcentos = (n: string) => n.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\x20-\x7e]/g, "_");

/** Pasta/arquivo pelo nome; se o sistema recusar acentos, usa o nome sem acento. */
async function subpasta(d: FileSystemDirectoryHandle, nome: string, criar = true) {
  try {
    return await d.getDirectoryHandle(nomeSeguro(nome), { create: criar });
  } catch (e) {
    if ((e as Error).name === "NotFoundError" && !criar) throw e;
    return d.getDirectoryHandle(semAcentos(nomeSeguro(nome)), { create: criar });
  }
}
async function arquivoEm(d: FileSystemDirectoryHandle, nome: string, criar = true) {
  try {
    return await d.getFileHandle(nomeSeguro(nome), { create: criar });
  } catch (e) {
    if ((e as Error).name === "NotFoundError" && !criar) throw e;
    return d.getFileHandle(semAcentos(nomeSeguro(nome)), { create: criar });
  }
}
async function escrever(d: FileSystemDirectoryHandle, nome: string, dados: Blob | string) {
  const s = await (await arquivoEm(d, nome)).createWritable();
  await s.write(dados);
  await s.close();
}
async function lerTexto(d: FileSystemDirectoryHandle, nome: string): Promise<string | null> {
  try {
    return await (await (await d.getFileHandle(nome)).getFile()).text();
  } catch (e) {
    if ((e as Error).name === "NotFoundError") return null;
    throw e;
  }
}

/** Arquivo visível gravado: caminho no disco, conteúdo e a pasta do cofre onde estava. */
type Visiveis = Record<string, { caminho: string[]; blob: string; pasta?: string }>;
/** Pasta do cofre → caminho dela no disco (e a pasta-mãe no cofre). */
type PastasGravadas = Record<string, { caminho: string[]; pai?: string | null }>;

/** Chave de comparação de um caminho no disco (o sistema pode ter trocado acentos e caracteres). */
const chaveDisco = (c: string[]) => c.map((n) => semAcentos(nomeSeguro(n))).join("/");
const igualDisco = (a: string[], b: string[]) => a.length === b.length && chaveDisco(a) === chaveDisco(b);

async function mesmoConteudo(a: Blob, b: Blob): Promise<boolean> {
  if (a.size !== b.size) return false;
  const [x, y] = await Promise.all([a.arrayBuffer(), b.arrayBuffer()]).then(([p, q]) => [new Uint8Array(p), new Uint8Array(q)]);
  for (let k = 0; k < x.length; k++) if (x[k] !== y[k]) return false;
  return true;
}

export class RepositorioPasta implements Repositorio {
  private dirs?: Promise<{ cofre: FileSystemDirectoryHandle; sis: FileSystemDirectoryHandle; blobs: FileSystemDirectoryHandle }>;
  /** `publicado`: pendrive (só o que passou por GO-IN); a pasta do dispositivo recebe tudo. */
  constructor(public nome: string, private raiz: PastaDisco, public publicado = false) {}

  private pastas() {
    return (this.dirs ??= (async () => {
      const cofre = await this.raiz.getDirectoryHandle("WJPDM", { create: true });
      const sis = await cofre.getDirectoryHandle(".wjpdm", { create: true });
      const blobs = await sis.getDirectoryHandle("blobs", { create: true });
      return { cofre, sis, blobs };
    })());
  }
  async lerIndice(): Promise<Indice | null> {
    const t = await lerTexto((await this.pastas()).sis, "indice.json");
    if (!t) return null;
    const i = JSON.parse(t) as Indice;
    if (i.formato !== "wjpdm-indice") throw new Error("índice do cofre inválido");
    return i;
  }
  async gravarIndice(i: Indice) {
    await escrever((await this.pastas()).sis, "indice.json", JSON.stringify(i));
  }
  async listarBlobs() {
    const r = new Set<string>();
    for await (const k of (await this.pastas()).blobs.keys()) r.add(k);
    return r;
  }
  async lerBlob(id: string) {
    try {
      return await (await (await this.pastas()).blobs.getFileHandle(id)).getFile();
    } catch {
      return undefined;
    }
  }
  async gravarBlob(id: string, b: Blob) {
    await escrever((await this.pastas()).blobs, id, b);
  }
  async apagarBlob(id: string) {
    await (await this.pastas()).blobs.removeEntry(id);
  }

  private estado?: Promise<{ vis: Visiveis; pastas: PastasGravadas }>;
  /** pastas que existem no disco (lidas em lerEspelho) */
  private dirsNoDisco?: Set<string>;

  /** visiveis.json e pastas.json (o antigo, só com caminhos, ganha o id de cada pasta do cofre). */
  private carregar(i: Indice) {
    return (this.estado ??= (async () => {
      const { sis } = await this.pastas();
      const vis: Visiveis = JSON.parse((await lerTexto(sis, "visiveis.json")) ?? "{}");
      const bruto: unknown = JSON.parse((await lerTexto(sis, "pastas.json")) ?? '{"pastas":{}}');
      let pastas: PastasGravadas = {};
      if (Array.isArray(bruto)) {
        const antigos = new Set((bruto as string[][]).map((c) => JSON.stringify(c)));
        for (const p of i.pastas) {
          const c = caminhoDaPasta(i, p.id);
          if (antigos.has(JSON.stringify(c))) pastas[p.id] = { caminho: c };
        }
      } else pastas = (bruto as { pastas?: PastasGravadas }).pastas ?? {};
      return { vis, pastas };
    })());
  }

  /** Onde estão de fato os arquivos e pastas que o app pôs no disco (arquivo que saiu do lugar: pelo conteúdo). */
  async lerEspelho(i: Indice): Promise<EspelhoVisto> {
    const { vis, pastas } = await this.carregar(i);
    const { cofre } = await this.pastas();
    const dirs = new Set<string>();
    const arqs = new Map<string, { caminho: string[]; h: FileSystemFileHandle }>();
    const andar = async (d: FileSystemDirectoryHandle, c: string[]) => {
      for await (const h of (d as unknown as { values(): AsyncIterable<FileSystemHandle> }).values()) {
        if (!c.length && h.name === ".wjpdm") continue;
        const k = [...c, h.name];
        if (h.kind === "directory") {
          dirs.add(chaveDisco(k));
          await andar(h as FileSystemDirectoryHandle, k);
        } else arqs.set(chaveDisco(k), { caminho: k, h: h as FileSystemFileHandle });
      }
    };
    await andar(cofre, []);
    this.dirsNoDisco = dirs;
    const doApp = new Set(Object.values(vis).map((v) => chaveDisco(v.caminho)));
    const soltos = [...arqs.entries()].filter(([k]) => !doApp.has(k)).map(([, x]) => x);
    const achados = new Set<string>();
    const arquivos: ItemVisto[] = [];
    for (const [k, v] of Object.entries(vis)) {
      if (k.includes("#")) continue;
      const pai = v.pasta !== undefined ? { pai: v.pasta } : {};
      if (arqs.has(chaveDisco(v.caminho))) {
        arquivos.push({ id: k, gravado: v.caminho, visto: v.caminho, ...pai });
        continue;
      }
      // saiu do lugar: o mesmo conteúdo entre os arquivos que o app não pôs lá
      const b = await this.lerBlob(v.blob);
      let visto: string[] | undefined;
      // prefere o mesmo nome e fora das pastas "(versões)" (a v1 tem o mesmo conteúdo do atual)
      const nome = v.caminho[v.caminho.length - 1];
      const ordem = (x: { caminho: string[] }) => (x.caminho[x.caminho.length - 1] === nome ? 0 : 2) + (x.caminho.some((n) => n.endsWith(" (versões)")) ? 1 : 0);
      if (b)
        for (const s of [...soltos].sort((x, y) => ordem(x) - ordem(y))) {
          const k2 = chaveDisco(s.caminho);
          if (achados.has(k2)) continue;
          const f = await s.h.getFile().catch(() => null);
          if (!f || !(await mesmoConteudo(f, b))) continue;
          achados.add(k2);
          visto = s.caminho;
          break;
        }
      arquivos.push({ id: k, gravado: v.caminho, visto, ...pai });
    }
    const pastasVistas = Object.entries(pastas).map(([id, { caminho: c, pai }]) => ({ id, gravado: c, visto: dirs.has(chaveDisco(c)) ? c : undefined, ...(pai !== undefined ? { pai } : {}) }));
    return { copia: this.nome, arquivos, pastas: pastasVistas };
  }

  /**
   * Arquivos legíveis iguais ao cofre: grava o que mudou e tira do lugar antigo o que mudou de lugar;
   * pastas iguais às do cofre. O que está à espera da escolha do Johann (`espelho`) fica onde ele pôs
   * (o conteúdo novo entra no lugar). Pastas só saem do disco vazias (o que alguém pôs lá fica).
   */
  async gravarVisiveis(i: Indice, lerBlob: (id: string) => Promise<Blob | undefined>, espelho: DecisaoEspelho = decisaoVazia()) {
    const { cofre, sis } = await this.pastas();
    const { vis: antes, pastas: pastasAntes } = await this.carregar(i);
    const dirs = this.dirsNoDisco;
    const alvo = (c: string[]) => aplicarTrocas(c, espelho.trocas);
    const naPasta = async (c: string[], criar = true) => {
      let d: FileSystemDirectoryHandle = cofre;
      for (const n of c) d = await subpasta(d, n, criar);
      return d;
    };
    const remover = async (c: string[]) => {
      try {
        const d = await naPasta(c.slice(0, -1), false);
        const n = c[c.length - 1];
        await d.removeEntry(nomeSeguro(n)).catch(() => d.removeEntry(semAcentos(nomeSeguro(n))));
      } catch {
        /* já não existia, ou pasta com arquivos (o que alguém pôs lá à mão fica) */
      }
    };
    // onde está agora o que estava num caminho gravado (pastas do app renomeadas/movidas)
    const trocasVistas: [string[], string[]][] = Object.entries(pastasAntes).flatMap(([id, { caminho: c }]) => {
      const o = espelho.onde.get(`pasta:${id}`);
      return o ? [[c, o] as [string[], string[]]] : [];
    });
    const ondeAgora = (k: string, c: string[]) => espelho.onde.get(k) ?? aplicarTrocas(c, trocasVistas);
    // 1. pastas do cofre (também as vazias): cria as que faltam
    const pastasAgora: PastasGravadas = {};
    for (const p of i.pastas) {
      const k = `pasta:${p.id}`;
      if (pastasAntes[p.id] && (espelho.manter.has(k) || espelho.presos.has(k))) {
        pastasAgora[p.id] = pastasAntes[p.id];
        continue;
      }
      const c = alvo(caminhoDaPasta(i, p.id));
      pastasAgora[p.id] = { caminho: c, pai: p.pai ?? null };
      const existe = dirs ? dirs.has(chaveDisco(c)) : !!pastasAntes[p.id] && igualDisco(pastasAntes[p.id].caminho, c);
      if (!existe) await naPasta(c);
    }
    // 2. arquivos
    const agora: Visiveis = {};
    const pastaDoArquivo = new Map(i.arquivos.map((a) => [a.id, a.pasta]));
    for (const { chave: k, caminho, blob } of visiveisDoIndice(i)) {
      const v = antes[k];
      const base = k.split("#")[0];
      if (espelho.manter.has(base) || espelho.presos.has(base)) {
        // à espera da escolha: fica onde está; o conteúdo novo do arquivo atual entra no lugar
        if (!v) continue;
        agora[k] = v;
        const onde = espelho.onde.get(k);
        if (!k.includes("#") && onde && v.blob !== blob) {
          const dados = await lerBlob(blob);
          if (dados && (await naPasta(onde.slice(0, -1), false).then((d) => escrever(d, onde[onde.length - 1], dados)).then(() => true, () => false))) agora[k] = { ...v, blob };
        }
        continue;
      }
      const c = alvo(caminho);
      const atual = v ? ondeAgora(k, v.caminho) : undefined;
      agora[k] = { caminho: c, blob, pasta: pastaDoArquivo.get(base) };
      if (v && v.blob === blob && atual && igualDisco(atual, c)) continue;
      const dados = await lerBlob(blob);
      if (!dados) continue;
      await escrever(await naPasta(c.slice(0, -1)), c[c.length - 1], dados);
      if (atual && !igualDisco(atual, c)) await remover(atual);
    }
    // 3. o que saiu do cofre (lixeira, destruído)
    for (const [k, v] of Object.entries(antes)) if (!agora[k]) await remover(ondeAgora(k, v.caminho));
    // 4. pastas que ficaram vazias: as do app que saíram do cofre ou mudaram de lugar e as de versões.
    //    Sem "recursive": pasta com arquivos (de fora do cofre) não é apagada.
    const emUso = new Set<string>();
    const usar = (c: string[]) => {
      for (let n = 1; n <= c.length; n++) emUso.add(chaveDisco(c.slice(0, n)));
    };
    for (const x of Object.values(agora)) usar(x.caminho.slice(0, -1));
    for (const { caminho: c } of Object.values(pastasAgora)) usar(c);
    const candidatas = new Map<string, string[]>();
    const candidata = (c: string[]) => {
      for (let n = 1; n <= c.length; n++) candidatas.set(chaveDisco(c.slice(0, n)), c.slice(0, n));
    };
    for (const [k, v] of Object.entries(antes)) if (k.includes("#")) candidata(aplicarTrocas(v.caminho.slice(0, -1), trocasVistas));
    for (const { caminho: c } of Object.values(pastasAntes)) candidata(aplicarTrocas(c, trocasVistas)), candidata(c);
    for (const c of [...candidatas.entries()].filter(([k]) => !emUso.has(k)).map(([, c]) => c).sort((a, b) => b.length - a.length)) await remover(c);
    await escrever(sis, "visiveis.json", JSON.stringify(agora));
    await escrever(sis, "pastas.json", JSON.stringify({ formato: 2, pastas: pastasAgora }));
    this.estado = undefined;
  }
}
