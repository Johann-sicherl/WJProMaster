// Teste da sincronia entre cópias do cofre do WJPDM (src/pdm/sincronia.ts), com cópias em memória:
// arquivo novo, versão nova, conflito (mais recente vence, o outro vai para a lixeira), exclusão,
// lixeira vencida, cópia que falha no meio e repetição sem efeito.
import { visiveisDoIndice, caminhoDoArquivo, escolherIdentidade, indiceVazio, indiceZerado, recuperarOrfaos, sincronizar, type Indice, type Repositorio } from "../src/pdm/sincronia";
import type { Arquivo, Pasta } from "../src/pdm/regras";
import { ignorarNaImportacao, planejarImportacao, registroImportado, resumoImportacao, type Repetido } from "../src/pdm/importar";
import { RepositorioPasta, type PastaDisco } from "../src/comum/repositorios";

let falhas = 0;
function igual(nome: string, obtido: unknown, esperado: unknown) {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "ok  " : "FALHA"} ${nome}: ${JSON.stringify(obtido)}${ok ? "" : ` (esperado ${JSON.stringify(esperado)})`}`);
}

class Memoria implements Repositorio {
  publicado = false;
  indice: Indice | null = null;
  blobs = new Map<string, string>();
  visiveis = new Map<string, string>();
  quebrado = false;
  constructor(public nome: string) {}
  async lerIndice() {
    if (this.quebrado) throw new Error("desconectado");
    return this.indice ? JSON.parse(JSON.stringify(this.indice)) : null;
  }
  async gravarIndice(i: Indice) {
    this.indice = JSON.parse(JSON.stringify(i));
  }
  async listarBlobs() {
    return new Set(this.blobs.keys());
  }
  async lerBlob(id: string) {
    const t = this.blobs.get(id);
    return t === undefined ? undefined : new Blob([t]);
  }
  async gravarBlob(id: string, b: Blob) {
    this.blobs.set(id, await b.text());
  }
  async apagarBlob(id: string) {
    this.blobs.delete(id);
  }
  async gravarVisiveis(i: Indice) {
    this.visiveis.clear();
    for (const a of i.arquivos) if (!a.lixeira) this.visiveis.set(caminhoDoArquivo(i, a).join("/"), (a.trabalho?.blob ?? a.versoes[a.versoes.length - 1].blob));
  }
}

const arq = (id: string, blobs: string[], mod: string, extra: Partial<Arquivo> = {}): Arquivo => ({
  id, nome: `${id}.wjcad`, pasta: "p1", revisao: "", estado: "trabalho", cartao: {}, historico: [], mod,
  versoes: blobs.map((b, i) => ({ n: i + 1, blob: b, tamanho: 1, autor: "J", data: mod, comentario: "", revisao: "", estado: "trabalho" })),
  ...extra,
});
const com = (r: Memoria, arquivos: Arquivo[], blobs: Record<string, string>) => {
  r.indice = { ...indiceVazio(), pastas: [{ id: "p1", nome: "CAD", pai: null, mod: "2026-10-01T00:00:00.000Z" }], arquivos };
  for (const [k, v] of Object.entries(blobs)) r.blobs.set(k, v);
};
const AGORA = "2026-10-28T12:00:00.000Z";

// 1. pendrive vazio recebe o cofre do tablet (arquivo, blob e arquivo visível)
{
  const tab = new Memoria("tablet"), pen = new Memoria("pendrive");
  com(tab, [arq("Eixo", ["b1"], "2026-10-27T10:00:00.000Z")], { b1: "eixo v1" });
  const r = await sincronizar([tab, pen], AGORA);
  igual("pendrive recebeu o arquivo", pen.indice?.arquivos.map((a) => a.id), ["Eixo"]);
  igual("pendrive recebeu o conteúdo", pen.blobs.get("b1"), "eixo v1");
  igual("arquivo visível em CAD/Eixo.wjcad", [...pen.visiveis.keys()], ["CAD/Eixo.wjcad"]);
  igual("1 blob copiado, sem conflito", [r.copiados, r.conflitos.length], [1, 0]);
  const r2 = await sincronizar([tab, pen], AGORA);
  igual("repetir não copia nada", [r2.copiados, r2.conflitos.length], [0, 0]);
}

// 2. versão nova no pendrive (o tablet tem só a v1): sobe para o tablet
{
  const tab = new Memoria("tablet"), pen = new Memoria("pendrive");
  com(tab, [arq("Eixo", ["b1"], "2026-10-27T10:00:00.000Z")], { b1: "v1" });
  com(pen, [arq("Eixo", ["b1", "b2"], "2026-10-28T09:00:00.000Z")], { b1: "v1", b2: "v2" });
  const r = await sincronizar([tab, pen], AGORA);
  igual("tablet agora tem 2 versões", tab.indice?.arquivos[0].versoes.length, 2);
  igual("tablet recebeu o conteúdo da v2", tab.blobs.get("b2"), "v2");
  igual("sem conflito (a v2 contém a v1)", r.conflitos, []);
}

// 3. conflito: v2 diferente nos dois lados; vence a mais recente, a outra vai para a lixeira
{
  const tab = new Memoria("tablet"), pen = new Memoria("pendrive");
  com(tab, [arq("Eixo", ["b1", "bT"], "2026-10-28T08:00:00.000Z")], { b1: "v1", bT: "v2 do tablet" });
  com(pen, [arq("Eixo", ["b1", "bP"], "2026-10-28T09:00:00.000Z")], { b1: "v1", bP: "v2 do pendrive" });
  const r = await sincronizar([tab, pen], AGORA);
  const atual = tab.indice!.arquivos.find((a) => a.id === "Eixo")!;
  igual("vence a mais recente (pendrive)", atual.versoes[1].blob, "bP");
  const lix = tab.indice!.arquivos.find((a) => a.lixeira)!;
  igual("a do tablet foi para a lixeira", [lix?.nome, lix?.versoes[1].blob], ["Eixo (conflito 2026-10-28).wjcad", "bT"]);
  igual("conteúdo perdedor guardado nas duas cópias", [tab.blobs.get("bT"), pen.blobs.get("bT")], ["v2 do tablet", "v2 do tablet"]);
  igual("conflito avisado", r.conflitos, ["Eixo.wjcad"]);
  const r2 = await sincronizar([tab, pen], AGORA);
  igual("repetir não duplica a cópia de conflito", [r2.conflitos.length, tab.indice!.arquivos.length], [0, 2]);
}

// 4. exclusão (destruído no tablet) some do pendrive e libera o conteúdo
{
  const tab = new Memoria("tablet"), pen = new Memoria("pendrive");
  com(tab, [], {});
  tab.indice!.exclusoes = [{ id: "Eixo", tipo: "arquivo", data: "2026-10-28T10:00:00.000Z" }];
  com(pen, [arq("Eixo", ["b1"], "2026-10-27T10:00:00.000Z")], { b1: "v1" });
  await sincronizar([tab, pen], AGORA);
  igual("excluído no pendrive", pen.indice!.arquivos.length, 0);
  igual("conteúdo apagado do pendrive", pen.blobs.has("b1"), false);
  igual("visível apagado", pen.visiveis.size, 0);
}

// 5. alterado DEPOIS da exclusão (em outra cópia): o arquivo vale
{
  const tab = new Memoria("tablet"), pen = new Memoria("pendrive");
  com(tab, [], {});
  tab.indice!.exclusoes = [{ id: "Eixo", tipo: "arquivo", data: "2026-10-27T10:00:00.000Z" }];
  com(pen, [arq("Eixo", ["b1", "b2"], "2026-10-28T09:00:00.000Z")], { b1: "v1", b2: "v2" });
  await sincronizar([tab, pen], AGORA);
  igual("alteração mais nova que a exclusão mantém o arquivo", tab.indice!.arquivos.map((a) => a.id), ["Eixo"]);
}

// 6. lixeira com mais de 30 dias é destruída
{
  const tab = new Memoria("tablet");
  com(tab, [arq("Velho", ["b9"], "2026-09-01T00:00:00.000Z", { lixeira: true, lixeiraData: "2026-09-01T00:00:00.000Z" }), arq("Novo", ["b8"], "2026-10-20T00:00:00.000Z", { lixeira: true, lixeiraData: "2026-10-20T00:00:00.000Z" })], { b9: "x", b8: "y" });
  await sincronizar([tab], AGORA);
  igual("só a lixeira vencida foi destruída", tab.indice!.arquivos.map((a) => a.id), ["Novo"]);
  igual("exclusão registrada", tab.indice!.exclusoes.map((e) => e.id), ["Velho"]);
}

// 7. pendrive arrancado: o tablet e o Drive continuam se igualando
{
  const tab = new Memoria("tablet"), pen = new Memoria("pendrive"), drive = new Memoria("drive");
  com(tab, [arq("Eixo", ["b1"], "2026-10-27T10:00:00.000Z")], { b1: "v1" });
  pen.quebrado = true;
  const r = await sincronizar([tab, pen, drive], AGORA);
  igual("falha só do pendrive", r.falhas.map((f) => f.repo), ["pendrive"]);
  igual("Drive recebeu o arquivo", drive.indice?.arquivos.map((a) => a.id), ["Eixo"]);
}

// 8. cópia de trabalho (salvar no app sem GO-IN) também viaja
{
  const tab = new Memoria("tablet"), pen = new Memoria("pendrive");
  com(tab, [arq("Eixo", ["b1"], "2026-10-28T11:00:00.000Z", { trabalho: { blob: "w1", tamanho: 1, data: "2026-10-28T11:00:00.000Z", autor: "J" } })], { b1: "v1", w1: "trabalho" });
  await sincronizar([tab, pen], AGORA);
  igual("pendrive tem a cópia de trabalho", [pen.blobs.get("w1"), pen.visiveis.get("CAD/Eixo.wjcad")], ["trabalho", "w1"]);
}

// 9. pendrive (publicação): guarda tudo no índice (abre em outro aparelho), mas MOSTRA só o publicado
{
  const ap = new Memoria("aparelho"), tab = new Memoria("tablet"), pen = new Memoria("pendrive");
  pen.publicado = true;
  com(ap, [
    arq("Novo", ["n1"], "2026-10-28T11:00:00.000Z", { soLocal: true, checkout: { usuario: "J", data: "x" } }),
    arq("Eixo", ["b1"], "2026-10-28T11:00:00.000Z", { trabalho: { blob: "w1", tamanho: 1, data: "x", autor: "J" } }),
  ], { n1: "novo", b1: "v1", w1: "trabalho" });
  await sincronizar([ap, tab, pen], AGORA);
  igual("pasta do dispositivo recebe tudo", [tab.indice!.arquivos.length, tab.blobs.has("n1"), tab.blobs.has("w1")], [2, true, true]);
  igual("pendrive guarda tudo no índice (outro aparelho abre o último salvar)", [pen.indice!.arquivos.map((a) => a.id).sort(), pen.blobs.has("n1"), pen.blobs.has("w1"), pen.indice!.arquivos.find((a) => a.id === "Eixo")!.trabalho?.blob], [["Eixo", "Novo"], true, true, "w1"]);
  igual("pendrive MOSTRA só o publicado (Eixo na v1; Novo, nunca publicado, não aparece)", [pen.visiveis.get("CAD/Eixo.wjcad"), [...pen.visiveis.keys()].some((k) => k.includes("Novo"))], ["b1", false]);
  const r2 = await sincronizar([ap, tab, pen], AGORA);
  igual("cópia de trabalho continua no aparelho (sem conflito)", [ap.indice!.arquivos.find((a) => a.id === "Eixo")!.trabalho?.blob, r2.conflitos.length], ["w1", 0]);
  // GO-IN: vira versão 2, sai do "só no dispositivo" e chega ao pendrive
  const novo = ap.indice!.arquivos.find((a) => a.id === "Novo")!;
  novo.soLocal = undefined;
  novo.mod = "2026-10-28T11:30:00.000Z";
  const eixo = ap.indice!.arquivos.find((a) => a.id === "Eixo")!;
  eixo.versoes.push({ ...eixo.versoes[0], n: 2, blob: "w1" });
  eixo.trabalho = undefined;
  eixo.mod = "2026-10-28T11:30:00.000Z";
  await sincronizar([ap, tab, pen], AGORA);
  igual("depois do GO-IN o pendrive tem os dois", [pen.indice!.arquivos.map((a) => a.id).sort(), pen.blobs.has("n1"), pen.blobs.has("w1")], [["Eixo", "Novo"], true, true]);
}

// 9b. dois aparelhos (computador e tablet) com a mesma cópia de publicação (Drive/pendrive):
//     o que se salva num (cópia de trabalho, ou arquivo nunca publicado) abre no outro
{
  const pc = new Memoria("aparelho"), tablet = new Memoria("aparelho"), drive = new Memoria("Google Drive");
  drive.publicado = true;
  com(pc, [
    arq("Eixo", ["b1"], "2026-11-05T10:00:00.000Z", { trabalho: { blob: "w9", tamanho: 1, data: "2026-11-05T10:00:00.000Z", autor: "J" }, checkout: { usuario: "J", data: "x" } }),
    arq("Rascunho", ["r1"], "2026-11-05T10:00:00.000Z", { soLocal: true, checkout: { usuario: "J", data: "x" } }),
  ], { b1: "v1", w9: "salvo no computador", r1: "rascunho do computador" });
  await sincronizar([pc, drive], AGORA);
  await sincronizar([tablet, drive], AGORA);
  const eixo = tablet.indice!.arquivos.find((a) => a.id === "Eixo");
  igual("tablet recebe o último salvar do computador (cópia de trabalho e conteúdo)", [eixo?.trabalho?.blob, tablet.blobs.get("w9")], ["w9", "salvo no computador"]);
  igual("tablet recebe também o arquivo nunca publicado", [tablet.indice!.arquivos.some((a) => a.id === "Rascunho"), tablet.blobs.get("r1")], [true, "rascunho do computador"]);
  igual("no Drive visível continua só o publicado", [drive.visiveis.get("CAD/Eixo.wjcad"), [...drive.visiveis.keys()].some((k) => k.includes("Rascunho"))], ["b1", false]);
}

// 10. salvar de novo (cópia de trabalho ou rascunho nunca publicado substituídos) não é conflito
{
  const ap = new Memoria("aparelho"), tab = new Memoria("tablet");
  com(ap, [
    arq("Novo", ["n1"], "2026-10-28T11:00:00.000Z", { soLocal: true }),
    arq("Eixo", ["b1"], "2026-10-28T11:00:00.000Z", { trabalho: { blob: "w1", tamanho: 1, data: "x", autor: "J" } }),
  ], { n1: "rascunho 1", b1: "v1", w1: "trabalho 1" });
  await sincronizar([ap, tab], AGORA);
  const novo = ap.indice!.arquivos.find((a) => a.id === "Novo")!, eixo = ap.indice!.arquivos.find((a) => a.id === "Eixo")!;
  novo.versoes[0].blob = "n2"; novo.mod = "2026-10-28T11:10:00.000Z";
  eixo.trabalho = { blob: "w2", tamanho: 1, data: "y", autor: "J" }; eixo.mod = "2026-10-28T11:10:00.000Z";
  ap.blobs.set("n2", "rascunho 2"); ap.blobs.set("w2", "trabalho 2");
  const r = await sincronizar([ap, tab], AGORA);
  igual("salvar seguido não gera conflito", [r.conflitos, tab.indice!.arquivos.length], [[], 2]);
  igual("pasta do dispositivo fica com o conteúdo novo e libera o antigo", [tab.blobs.has("n2"), tab.blobs.has("w2"), tab.blobs.has("n1"), tab.blobs.has("w1")], [true, true, false, false]);
}

// 11. tabela de referências: viaja entre cópias, exclusão propaga e pai "só no dispositivo" não vai ao pendrive
{
  const ap = new Memoria("aparelho"), pen = new Memoria("pendrive");
  pen.publicado = true;
  com(ap, [arq("Mont", ["m1"], "2026-10-29T10:00:00.000Z"), arq("Rasc", ["r1"], "2026-10-29T10:00:00.000Z", { soLocal: true })], { m1: "m", r1: "r" });
  ap.indice!.referencias = [
    { id: "Mont>Eixo>", pai: "Mont", filho: "Eixo", tipo: "componente", quantidade: 2, mod: "2026-10-29T10:00:00.000Z" },
    { id: "Rasc>Eixo>", pai: "Rasc", filho: "Eixo", tipo: "componente", quantidade: 1, mod: "2026-10-29T10:00:00.000Z" },
  ];
  await sincronizar([ap, pen], AGORA);
  igual("pendrive guarda as referências (também do arquivo nunca publicado)", pen.indice!.referencias.map((r) => r.id).sort(), ["Mont>Eixo>", "Rasc>Eixo>"]);
  ap.indice = { ...ap.indice!, referencias: ap.indice!.referencias.filter((r) => r.pai !== "Mont"), exclusoes: [{ id: "Mont>Eixo>", tipo: "referencia", data: "2026-10-29T11:00:00.000Z" }] };
  await sincronizar([ap, pen], AGORA);
  igual("referência excluída some do pendrive (a outra fica)", pen.indice!.referencias.map((r) => r.id), ["Rasc>Eixo>"]);
  const velho = new Memoria("antigo");
  velho.indice = { ...indiceVazio(), referencias: undefined } as unknown as Indice;
  const r = await sincronizar([ap, velho], AGORA);
  igual("índice antigo sem a tabela não quebra", r.falhas, []);
}

// pastas de versões ao lado do arquivo (o que as cópias mostram em disco/Drive)
{
  const i = indiceVazio();
  i.pastas.push({ id: "p", nome: "CAD", pai: null } as never);
  i.arquivos.push({ id: "a", nome: "Suporte.wjcad", pasta: "p", revisao: "A", estado: "x", cartao: {}, historico: [], versoes: [{ n: 1, blob: "b1", revisao: "" }, { n: 2, blob: "b2", revisao: "A" }], trabalho: { blob: "w", tamanho: 1, data: "", autor: "" } } as never);
  igual("versões: atual = cópia de trabalho; v1 e v2 rev A na pasta (versões)", visiveisDoIndice(i).map((v) => [v.caminho.join("/"), v.blob]), [["CAD/Suporte.wjcad", "w"], ["CAD/Suporte (versões)/Suporte v1.wjcad", "b1"], ["CAD/Suporte (versões)/Suporte v2 rev A.wjcad", "b2"]]);
}

const T = (h: string) => `2026-11-15T${h}:00.000Z`;

// 15. pendrive de verdade (RepositorioPasta) sobre um disco simulado: o cofre manda (15/11/2026) —
//     mudança feita à mão no pendrive não entra no cofre; a sincronia regrava como o cofre está.
{
  let relogio = 1;
  class Arq {
    kind = "file" as const;
    dados = "";
    mod = 0;
    constructor(public name: string) {}
    async getFile() {
      return new File([this.dados], this.name, { lastModified: this.mod });
    }
    async createWritable() {
      const partes: BlobPart[] = [];
      return { write: async (d: BlobPart) => void partes.push(d), close: async () => void ((this.dados = await new Blob(partes).text()), (this.mod = ++relogio)) };
    }
  }
  const nf = () => Object.assign(new Error("não existe"), { name: "NotFoundError" });
  class Dir {
    kind = "directory" as const;
    filhos = new Map<string, Dir | Arq>();
    constructor(public name: string) {}
    async getDirectoryHandle(n: string, o?: { create?: boolean }) {
      let x = this.filhos.get(n);
      if (!x && o?.create) this.filhos.set(n, (x = new Dir(n)));
      if (!x || x.kind !== "directory") throw nf();
      return x;
    }
    async getFileHandle(n: string, o?: { create?: boolean }) {
      let x = this.filhos.get(n);
      if (!x && o?.create) this.filhos.set(n, (x = new Arq(n)));
      if (!x || x.kind !== "file") throw nf();
      return x;
    }
    async removeEntry(n: string) {
      const x = this.filhos.get(n);
      if (!x) throw nf();
      if (x.kind === "directory" && x.filhos.size) throw Object.assign(new Error("não vazia"), { name: "InvalidModificationError" });
      this.filhos.delete(n);
    }
    async *values() {
      yield* this.filhos.values();
    }
    async *keys() {
      yield* this.filhos.keys();
    }
  }
  const disco = new Dir("pendrive");
  const no = (c: string): Dir | Arq | undefined => c.split("/").reduce<Dir | Arq | undefined>((d, n) => (d?.kind === "directory" ? d.filhos.get(n) : undefined), disco);
  const pai = (c: string) => no(c.split("/").slice(0, -1).join("/")) as Dir;
  const mover = (de: string, para: string) => {
    const x = no(de)!;
    pai(de).filhos.delete(x.name);
    x.name = para.split("/").at(-1)!;
    pai(para).filhos.set(x.name, x);
  };
  const apagar = (c: string) => pai(c).filhos.delete(c.split("/").at(-1)!);
  const arquivos = (d: Dir = disco, c = ""): string[] => [...d.filhos.values()].flatMap((x) => (x.kind === "file" ? [`${c}${x.name}`] : x.name === ".wjpdm" ? [] : arquivos(x, `${c}${x.name}/`))).sort();
  const pastas = (d: Dir = disco, c = ""): string[] => [...d.filhos.values()].flatMap((x) => (x.kind === "file" || x.name === ".wjpdm" ? [] : [`${c}${x.name}`, ...pastas(x, `${c}${x.name}/`)])).sort();
  const ap = new Memoria("aparelho");
  com(ap, [arq("a1", ["b1"], T("08:00"), { nome: "Eixo.wjcad" }), arq("a2", ["b2"], T("08:00"), { nome: "Mancal.wjcad" })], { b1: "eixo", b2: "mancal" });
  ap.indice!.pastas.push({ id: "p2", nome: "Projetos", pai: null, mod: T("08:00") });
  const pen = () => new RepositorioPasta("pendrive", disco as unknown as PastaDisco, true);
  const sinc = (h: string) => sincronizar([ap, pen()], T(h));
  await sinc("09:00");
  igual("15.0 pendrive inicial (pastas vazias também)", [arquivos().filter((x) => !x.includes("versões")), pastas().includes("WJPDM/Projetos")], [["WJPDM/CAD/Eixo.wjcad", "WJPDM/CAD/Mancal.wjcad"], true]);
  // renomear a pasta e mover um arquivo no cofre: o pendrive segue (sem sobras)
  ap.indice!.pastas = ap.indice!.pastas.map((p) => (p.id === "p1" ? { ...p, nome: "CAD 2026", mod: T("09:30") } : p));
  ap.indice!.arquivos = ap.indice!.arquivos.map((a) => (a.id === "a2" ? { ...a, pasta: "p2", mod: T("09:30") } : a));
  await sinc("09:31");
  igual("15.1 renomear/mover no cofre: o pendrive segue", [arquivos(), pastas().includes("WJPDM/CAD")], [["WJPDM/CAD 2026/Eixo (versões)/Eixo v1.wjcad", "WJPDM/CAD 2026/Eixo.wjcad", "WJPDM/Projetos/Mancal (versões)/Mancal v1.wjcad", "WJPDM/Projetos/Mancal.wjcad"], false]);
  // mexido à mão no pendrive: nada entra no cofre
  const antes = JSON.stringify(ap.indice);
  mover("WJPDM/Projetos/Mancal.wjcad", "WJPDM/CAD 2026/Mancal B.wjcad");
  const r = await sinc("10:00");
  igual("15.2 mudança à mão no pendrive não entra no cofre", [JSON.stringify(ap.indice!.arquivos) === JSON.stringify(JSON.parse(antes).arquivos), r.falhas], [true, []]);
  void apagar;
  // zerar: o pendrive perde tudo o que o app pôs (pastas vazias saem), índice novo
  ap.indice = indiceZerado(ap.indice!, "z1", T("11:00"));
  ap.blobs.clear();
  const z = await sinc("11:00");
  igual("15.3 zerar: o pendrive fica só com o que o app não pôs lá e o índice novo", [arquivos(), [...((no("WJPDM/.wjpdm/blobs") as Dir)?.filhos.keys() ?? [])], z.zeradas], [["WJPDM/CAD 2026/Mancal B.wjcad"], [], ["pendrive"]]);
}

// 15b. zerar cofre com dois aparelhos (15/11/2026): o aparelho A zera; o B, ao sincronizar pelo Drive,
//      vê a identidade nova e limpa o banco dele sem reenviar o antigo; usuário/máscara/fluxo ficam.
{
  const a = new Memoria("aparelho"), b = new Memoria("aparelho"), drive = new Memoria("Google Drive");
  drive.publicado = true;
  const meta = { id: "meta" as const, nome: "Cofre", usuario: "Johann", mascara: "12-####", fluxo: { nome: "F", inicial: "x", estados: [], transicoes: [] } as never, mod: T("07:00") };
  com(a, [arq("a1", ["b1"], T("08:00"), { nome: "Eixo.wjcad" }), arq("a2", ["b2"], T("08:00"), { nome: "Mancal.wjcad", lixeira: true, lixeiraData: T("08:00") })], { b1: "eixo", b2: "mancal" });
  a.indice!.meta = meta;
  await sincronizar([a, drive], T("09:00"));
  await sincronizar([b, drive], T("09:05"));
  igual("15b.0 B tem o cofre de A", [b.indice!.arquivos.length, b.blobs.size, [...drive.visiveis.keys()]], [2, 2, ["CAD/Eixo.wjcad"]]);
  // B mexe no cofre antigo (arquivo novo) antes de saber que A zerou
  b.indice!.arquivos.push(arq("a3", ["b3"], T("09:50"), { nome: "Tampa.wjcad" }));
  b.blobs.set("b3", "tampa");
  // A zera (índice novo, identidade nova, sem conteúdos) e sincroniza com o Drive
  a.indice = indiceZerado(a.indice!, "cofre-novo", T("10:00"));
  a.blobs.clear();
  const ra = await sincronizar([a, drive], T("10:00"));
  igual("15b.1 Drive zerado: índice vazio com a identidade nova, sem conteúdos nem visíveis", [drive.indice!.arquivos.length, drive.indice!.pastas.length, drive.blobs.size, drive.visiveis.size, drive.indice!.cofre?.id, ra.zeradas], [0, 0, 0, 0, "cofre-novo", ["Google Drive"]]);
  igual("15b.2 usuário, máscara e fluxo ficam", [drive.indice!.meta?.usuario, drive.indice!.meta?.mascara, (drive.indice!.meta?.fluxo as { nome: string })?.nome], ["Johann", "12-####", "F"]);
  const rb = await sincronizar([b, drive], T("10:30"));
  igual("15b.3 B limpo ao sincronizar (banco e conteúdos), avisado", [b.indice!.arquivos.length, b.indice!.pastas.length, b.blobs.size, b.indice!.cofre?.id, rb.zeradas], [0, 0, 0, "cofre-novo", ["aparelho"]]);
  igual("15b.4 nada do antigo foi reenviado ao Drive", [drive.indice!.arquivos.length, drive.blobs.size, drive.visiveis.size], [0, 0, 0]);
  igual("15b.5 meta mantida em B", b.indice!.meta?.usuario, "Johann");
  // depois de zerar, a vida segue: arquivo novo em B chega ao Drive e a A
  b.indice!.arquivos.push(arq("n1", ["nb1"], T("11:00"), { nome: "Novo.wjcad", pasta: "raiz" }));
  b.blobs.set("nb1", "novo");
  await sincronizar([b, drive], T("11:00"));
  const r3 = await sincronizar([a, drive], T("11:05"));
  igual("15b.6 arquivo novo depois do zerar vai para todos", [a.indice!.arquivos.map((x) => x.nome), a.blobs.get("nb1"), r3.zeradas], [["Novo.wjcad"], "novo", []]);
  // cópia vazia nova (pendrive recém-configurado) nunca conta como zerada
  const vazio = new Memoria("pendrive");
  const r4 = await sincronizar([a, vazio], T("11:10"));
  igual("15b.7 cópia vazia não conta como zerada e recebe o cofre", [r4.zeradas, vazio.indice!.cofre?.id, vazio.indice!.arquivos.length], [[], "cofre-novo", 1]);
  // escolha da identidade: o zerar mais recente vence; sem identidade = cofre de antes do primeiro zerar
  const id = (x?: { id: string; zeradoEm: string }) => ({ ...indiceVazio(), ...(x ? { cofre: x } : {}) });
  igual("15b.8 identidade: o zerar mais recente vence", escolherIdentidade([id(), id({ id: "a", zeradoEm: T("10:00") }), id({ id: "b", zeradoEm: T("12:00") }), null]), { cofre: { id: "b", zeradoEm: T("12:00") }, antigos: [true, true, false, false] });
  igual("15b.9 ninguém zerou: nada é antigo", escolherIdentidade([id(), id(), null]).antigos, [false, false, false]);
}

// 15c. importar pasta com subpastas e nome repetido (15/11/2026)
{
  const pastas: Pasta[] = [{ id: "p1", nome: "CAD", pai: null }];
  const existentes: Arquivo[] = [arq("e1", ["eb1"], T("08:00"), { nome: "Eixo.wjcad", pasta: "p1" }), arq("e2", ["eb2"], T("08:00"), { nome: "a.mp4", pasta: "p1", midia: true }), arq("e3", ["eb3"], T("08:00"), { nome: "Pino.wjcad", pasta: "p1", checkout: { usuario: "Ana", data: T("08:00") } })];
  const ent = (c: string) => ({ caminho: c.split("/"), tamanho: 10 });
  const entradas = [
    "PDM TEMP/CAD/Eixo.wjcad", "PDM TEMP/CAD/Sub/Tampa.wjcad", "PDM TEMP/CAD/Sub/Fundo/Bucha.wjcad", "PDM TEMP/Vídeos/Montagem.mp4", "PDM TEMP/Fotos/peça.JPG",
    "PDM TEMP/CAD/a.mp4", "PDM TEMP/CAD/Pino.wjcad",
    "PDM TEMP/.wjpdm/indice.json", "PDM TEMP/CAD/Eixo (versões)/Eixo v1.wjcad", "PDM TEMP/desktop.ini", "PDM TEMP/CAD/.DS_Store", "PDM TEMP/~$Relatório.docx", "PDM TEMP/CAD/Thumbs.db",
  ].map(ent);
  let n = 0;
  const novoId = () => `n${++n}`;
  const plano = (r: Repetido | null, lista = entradas) => planejarImportacao(pastas, existentes, "raiz", lista, r, "Johann", novoId, T("12:00"));
  // só o conteúdo da pasta escolhida (sem "PDM TEMP")
  const semRaiz = entradas.map((e) => ({ ...e, caminho: e.caminho.slice(1) }));
  const p0 = plano(null, semRaiz);
  igual("15c.1 ignorados: .wjpdm, (versões), desktop.ini, .DS_Store, ~$, Thumbs.db", p0.ignorados.length, 6);
  igual("15c.2 pasta CAD reaproveitada; Sub, Sub/Fundo, Vídeos e Fotos criadas", p0.pastasNovas.map((p) => `${p.nome}<${p.pai ?? "raiz"}`), ["Sub<p1", "Fundo<n1", "Vídeos<raiz", "Fotos<raiz"]);
  igual("15c.3 sem escolha: só conta os repetidos (Eixo, a.mp4, Pino)", [p0.repetidos, p0.arquivos.map((x) => x.nome)], [3, ["Tampa.wjcad", "Bucha.wjcad", "Montagem.mp4", "peça.JPG"]]);
  igual("15c.4 mídia: vídeo e foto", p0.arquivos.map((x) => x.midia), [false, false, true, true]);
  const manter = plano("manter", semRaiz);
  igual("15c.5 manter os dois: \"nome (2)\"", manter.arquivos.filter((x) => x.pasta === "p1").map((x) => x.nome), ["Eixo (2).wjcad", "a (2).mp4", "Pino (2).wjcad"]);
  const pular = plano("pular", semRaiz);
  igual("15c.6 pular: ficam de fora, com o motivo", [pular.arquivos.length, pular.pulados.length], [4, 3]);
  const subst = plano("substituir", semRaiz);
  igual("15c.7 substituir: Eixo e a.mp4 viram a versão seguinte; Pino (GO-OUT da Ana) é pulado", [subst.arquivos.filter((x) => x.acao === "substituir").map((x) => `${x.nome}=${x.existente}`), subst.pulados.map((x) => x.split(" (")[0])], [["Eixo.wjcad=e1", "a.mp4=e2"], ["CAD/Pino.wjcad"]]);
  igual("15c.8 resumo", resumoImportacao(subst), "6 arquivos, 4 pastas, 6 ignorados, 1 pulado");
  // com a pasta escolhida: tudo dentro de "PDM TEMP" (nenhum repetido)
  const com = plano(null);
  igual("15c.9 com a pasta escolhida: PDM TEMP criada, nada repetido", [com.pastasNovas[0].nome, com.pastasNovas[0].pai, com.repetidos, com.arquivos.length], ["PDM TEMP", null, 0, 7]);
  // registros: novo publicado v1 (GO-IN, sem GO-OUT); substituir = versão 2; mídia substituída troca o conteúdo
  const novo = registroImportado(p0.arquivos[0], undefined, "nb", 10, "Johann", T("12:00"), "trabalho", "x1").arquivo;
  igual("15c.10 novo: versão 1 publicada, sem GO-OUT", [novo.versoes.length, novo.versoes[0].n, novo.soLocal, novo.checkout, novo.trabalho, novo.estado], [1, 1, undefined, undefined, undefined, "trabalho"]);
  const v2 = registroImportado(subst.arquivos.find((x) => x.existente === "e1")!, existentes[0], "nb2", 10, "Johann", T("12:00"), "trabalho", "x2").arquivo;
  igual("15c.11 substituir: versão 2 do mesmo arquivo", [v2.id, v2.versoes.map((v) => v.blob)], ["e1", ["eb1", "nb2"]]);
  const vid = registroImportado(subst.arquivos.find((x) => x.existente === "e2")!, existentes[1], "nb3", 10, "Johann", T("12:00"), "trabalho", "x3");
  igual("15c.12 mídia substituída: troca o conteúdo, sem guardar versões", [vid.arquivo.versoes.map((v) => v.blob), vid.sobra], [["nb3"], "eb2"]);
  const m = registroImportado(p0.arquivos[2], undefined, "nb4", 10, "Johann", T("12:00"), "trabalho", "x4").arquivo;
  const ix = { ...indiceVazio(), pastas: [...pastas, ...p0.pastasNovas], arquivos: [m, novo] };
  igual("15c.13 mídia sem a pasta \"(versões)\" nas cópias", visiveisDoIndice(ix).map((v) => v.caminho.join("/")), ["Vídeos/Montagem.mp4", "CAD/Sub/Tampa.wjcad", "CAD/Sub/Tampa (versões)/Tampa v1.wjcad"]);
  igual("15c.14 ignorar", [ignorarNaImportacao(["X", "Eixo (versões)", "Eixo v1.wjcad"]), ignorarNaImportacao(["._foto.jpg"]), ignorarNaImportacao(["CAD", "Eixo.wjcad"])], [true, true, false]);
}

// 16. arquivo órfão (12/11/2026, caso real do cofre do Johann): o arquivo entrou na pasta "Prints"
// numa cópia e, 14 s depois, a pasta foi excluída na outra sem levar o arquivo para a lixeira. A
// exclusão da pasta vencia na mescla e o arquivo ficava com `pasta` apontando para o nada: o WJPDM não
// mostrava e o Drive o publicava na raiz. Agora vai para a pasta "Recuperados", com histórico.
{
  const tab = new Memoria("tablet"), pen = new Memoria("pendrive");
  const print = arq("print", ["bp"], "2026-10-28T01:24:14.000Z", { nome: "Screenshot.png", pasta: "p2" });
  com(tab, [print, arq("lixo", ["bl"], "2026-10-28T01:00:00.000Z", { pasta: "p9", lixeira: true, lixeiraData: "2026-10-28T01:00:00.000Z" })], { bp: "png", bl: "lixo" });
  tab.indice!.pastas.push({ id: "p2", nome: "Prints", pai: null, mod: "2026-10-28T01:20:00.000Z" });
  com(pen, [], {});
  pen.indice!.exclusoes = [{ id: "p2", tipo: "pasta", data: "2026-10-28T01:24:28.000Z" }];
  const r = await sincronizar([tab, pen], AGORA);
  const i = tab.indice!;
  const a = i.arquivos.find((x) => x.id === "print")!;
  const rec = i.pastas.find((p) => p.id === a.pasta);
  igual("16.1 a pasta excluída sai do cofre", i.pastas.some((p) => p.id === "p2"), false);
  igual("16.2 o arquivo vai para a pasta Recuperados (raiz)", [rec?.nome, rec?.pai], ["Recuperados", null]);
  igual("16.3 histórico: pasta original não encontrada", a.historico[a.historico.length - 1]?.texto.startsWith("Pasta original não encontrada"), true);
  igual("16.4 a sincronia avisa quantos", r.recuperados, ["Screenshot.png"]);
  igual("16.5 visível em Recuperados/ (não na raiz) e igual nas duas cópias", [[...pen.visiveis.keys()], pen.indice!.arquivos.find((x) => x.id === "print")?.pasta], [["Recuperados/Screenshot.png"], a.pasta]);
  igual("16.6 arquivo na lixeira não é mexido (restaurar já leva para a raiz)", i.arquivos.find((x) => x.id === "lixo")?.pasta, "p9");
  const r2 = await sincronizar([tab, pen], AGORA);
  igual("16.7 repetir: nada a recuperar, uma pasta Recuperados só", [r2.recuperados.length, tab.indice!.pastas.filter((p) => p.nome === "Recuperados").length], [0, 1]);
  // órfão antigo num cofre só (como no índice dele) + "Recuperados" já criada à mão com outro id: usa ela, nome livre
  const so = new Memoria("tablet"), vazio = new Memoria("pendrive");
  com(so, [arq("x", ["bx"], "2026-10-20T00:00:00.000Z", { nome: "Eixo.wjcad", pasta: "sumiu" }), arq("y", ["by"], "2026-10-20T00:00:00.000Z", { nome: "Eixo.wjcad", pasta: "rm" })], { bx: "1", by: "2" });
  so.indice!.pastas.push({ id: "rm", nome: "recuperados", pai: null, mod: "2026-10-01T00:00:00.000Z" });
  const r3 = await sincronizar([so, vazio], AGORA);
  igual("16.8 usa a Recuperados que já existe, com nome livre", [r3.recuperados, so.indice!.arquivos.map((x) => `${x.pasta}/${x.nome}`).sort()], [["Eixo (2).wjcad"], ["rm/Eixo (2).wjcad", "rm/Eixo.wjcad"]]);
}

console.log(falhas ? `\nsincronia: ${falhas} falha(s)` : "\nsincronia: tudo certo");
if (falhas) process.exit(1);
