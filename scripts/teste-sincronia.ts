// Teste da sincronia entre cópias do cofre do WJPDM (src/pdm/sincronia.ts), com cópias em memória:
// arquivo novo, versão nova, conflito (mais recente vence, o outro vai para a lixeira), exclusão,
// lixeira vencida, cópia que falha no meio e repetição sem efeito.
import { visiveisDoIndice, caminhoDoArquivo, indiceVazio, sincronizar, type Indice, type Repositorio } from "../src/pdm/sincronia";
import type { Arquivo } from "../src/pdm/regras";
import { analisarEspelho, trazerParaOCofre, type EspelhoVisto } from "../src/pdm/espelho";
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

// ---------- mudanças feitas fora do app no espelho (12/11/2026) ----------
const T = (h: string) => `2026-11-12T${h}:00.000Z`;
const base = () => {
  const i = indiceVazio();
  i.pastas.push({ id: "p1", nome: "CAD", pai: null, mod: T("08:00") }, { id: "p2", nome: "Projetos", pai: null, mod: T("08:00") });
  i.arquivos.push(arq("a1", ["b1"], T("08:00"), { nome: "Eixo.wjcad" }), arq("a2", ["b2"], T("08:00"), { nome: "Mancal.wjcad" }));
  return i;
};
const visto = (arquivos: EspelhoVisto["arquivos"], pastas: EspelhoVisto["pastas"] = []): EspelhoVisto => ({ copia: "pendrive", arquivos, pastas });
const ids = () => {
  let n = 0;
  return () => `n${++n}`;
};

// 12. mover e renomear à mão: à espera da escolha; "Trazer" vira Mover/Renomear com histórico
{
  const i = base();
  const a = analisarEspelho(i, visto([{ id: "a1", gravado: ["CAD", "Eixo.wjcad"], visto: ["Projetos", "Eixo.wjcad"] }, { id: "a2", gravado: ["CAD", "Mancal.wjcad"], visto: ["CAD", "Mancal B.wjcad"] }]), T("10:00"));
  igual("12.1 duas mudanças à espera, nada mudou no cofre", [a.pendentes.map((m) => `${m.de.join("/")} → ${m.para!.join("/")}`), a.indice === i, [...a.manter]], [["CAD/Eixo.wjcad → Projetos/Eixo.wjcad", "CAD/Mancal.wjcad → CAD/Mancal B.wjcad"], true, ["a1", "a2"]]);
  let t = trazerParaOCofre(i, a.pendentes[0], a.pendentes, T("10:05"), "Johann", ids());
  const e = "erro" in t ? undefined : t.indice.arquivos.find((x) => x.id === "a1")!;
  igual("12.2 trazer o movido: pasta nova e histórico", [e && caminhoDoArquivo((t as { indice: Indice }).indice, e).join("/"), e?.historico.at(-1)?.texto, e?.mod], ["Projetos/Eixo.wjcad", "Movido no pendrive de CAD/Eixo.wjcad para Projetos/Eixo.wjcad", T("10:05")]);
  t = trazerParaOCofre(i, a.pendentes[1], a.pendentes, T("10:05"), "Johann", ids());
  const m = "erro" in t ? undefined : t.indice.arquivos.find((x) => x.id === "a2")!;
  igual("12.3 trazer o renomeado", [m?.nome, m?.historico.at(-1)?.texto], ["Mancal B.wjcad", "Renomeado no pendrive de Mancal.wjcad para Mancal B.wjcad"]);
  const outro = { ...i, arquivos: i.arquivos.map((x) => (x.id === "a2" ? { ...x, checkout: { usuario: "Ana", data: "x" } } : x)) };
  igual("12.4 em GO-OUT com outra pessoa: não traz, explica", "erro" in trazerParaOCofre(outro, a.pendentes[1], a.pendentes, T("10:05"), "Johann", ids()), true);
  const d = analisarEspelho(i, visto([{ id: "a1", gravado: ["CAD", "Eixo.wjcad"], visto: ["Projetos", "Eixo.wjcad"] }]), T("10:10"), { decididos: new Set([a.pendentes[0].id]) });
  igual("12.5 decidida (Desfazer): sai da lista e o espelho segue o cofre", [d.pendentes.length, d.manter.size, d.vistas], [0, 0, [a.pendentes[0].id]]);
}

// 13. pasta renomeada à mão no pendrive (sem id): descoberta pelos arquivos de dentro; uma mudança só
{
  const i = base();
  const a = analisarEspelho(i, visto([{ id: "a1", gravado: ["CAD", "Eixo.wjcad"], visto: ["CAD 2026", "Eixo.wjcad"] }, { id: "a2", gravado: ["CAD", "Mancal.wjcad"], visto: ["CAD 2026", "Mancal.wjcad"] }], [{ id: "p1", gravado: ["CAD"], visto: undefined }, { id: "p2", gravado: ["Projetos"], visto: ["Projetos"] }]), T("10:00"));
  igual("13.1 pasta renomeada: uma mudança; os arquivos de dentro acompanham", [a.pendentes.map((m) => `${m.tipo} ${m.de.join("/")} → ${m.para!.join("/")}`), [...a.presos].sort(), a.trocas], [["pasta CAD → CAD 2026"], ["a1", "a2"], [[["CAD"], ["CAD 2026"]]]]);
  const t = trazerParaOCofre(i, a.pendentes[0], a.pendentes, T("10:05"), "Johann", ids());
  igual("13.2 trazer: pasta renomeada no cofre", "erro" in t ? t.erro : t.pastas.map((p) => p.nome), ["CAD 2026"]);
  // esvaziada para outra pasta do app NÃO é renomeação
  const b = analisarEspelho(i, visto([{ id: "a1", gravado: ["CAD", "Eixo.wjcad"], visto: ["Projetos", "Eixo.wjcad"] }], [{ id: "p1", gravado: ["CAD"], visto: undefined }, { id: "p2", gravado: ["Projetos"], visto: ["Projetos"] }]), T("10:00"));
  igual("13.3 pasta esvaziada à mão para outra pasta do app: só o arquivo movido", b.pendentes.map((m) => m.tipo), ["arquivo"]);
  // pasta nova criada à mão no pendrive (o nome é visível): trazer cria a pasta no cofre
  const c = analisarEspelho(i, visto([{ id: "a1", gravado: ["CAD", "Eixo.wjcad"], visto: ["CAD", "Usinados", "Eixo.wjcad"] }]), T("10:00"));
  const tc = trazerParaOCofre(i, c.pendentes[0], c.pendentes, T("10:05"), "Johann", () => "pNova");
  igual("13.4 pasta criada à mão no pendrive entra no cofre", "erro" in tc ? tc.erro : [tc.pastas.map((p) => [p.id, p.nome, p.pai]), caminhoDoArquivo(tc.indice, tc.indice.arquivos.find((x) => x.id === "a1")!).join("/")], [[["pNova", "Usinados", "p1"]], "CAD/Usinados/Eixo.wjcad"]);
}

// 14. conflito com mudança feita no app ao mesmo tempo: a mais recente vence, a outra vai para a lixeira do cofre
{
  const comApp = (mod: string) => {
    const i = base();
    const a1 = i.arquivos.find((x) => x.id === "a1")!;
    a1.nome = "Eixo motor.wjcad";
    a1.mod = mod;
    return i;
  };
  // fora do app mais recente (10:30 > 10:00): vence o Drive/pendrive
  let i = comApp(T("10:00"));
  let a = analisarEspelho(i, visto([{ id: "a1", gravado: ["CAD", "Eixo.wjcad"], visto: ["Projetos", "Eixo.wjcad"], quando: T("10:30") }]), T("11:00"), { usuario: "Johann" });
  let a1 = a.indice.arquivos.find((x) => x.id === "a1")!;
  let lix = a.indice.arquivos.find((x) => x.lixeira)!;
  igual("14.1 fora do app mais recente: vence, sem perguntar", [caminhoDoArquivo(a.indice, a1).join("/"), a.pendentes.length, a.conflitos], ["Projetos/Eixo.wjcad", 0, ["Eixo motor.wjcad"]]);
  igual("14.2 a mudança do app vai para a lixeira do cofre", [lix?.nome, caminhoDoArquivo(a.indice, lix).join("/")], ["Eixo motor (conflito 2026-11-12).wjcad", "CAD/Eixo motor (conflito 2026-11-12).wjcad"]);
  // app mais recente (10:30 > 10:00): o cofre fica; o espelho volta (não está em "manter")
  i = comApp(T("10:30"));
  a = analisarEspelho(i, visto([{ id: "a1", gravado: ["CAD", "Eixo.wjcad"], visto: ["Projetos", "Eixo.wjcad"], quando: T("10:00") }]), T("11:00"));
  a1 = a.indice.arquivos.find((x) => x.id === "a1")!;
  lix = a.indice.arquivos.find((x) => x.lixeira)!;
  igual("14.3 app mais recente: vence; o espelho segue o cofre", [caminhoDoArquivo(a.indice, a1).join("/"), a.manter.size], ["CAD/Eixo motor.wjcad", 0]);
  igual("14.4 onde o Johann pôs vai para a lixeira do cofre", [lix?.nome, caminhoDoArquivo(a.indice, lix).slice(0, -1).join("/")], ["Eixo (conflito 2026-11-12).wjcad", "Projetos"]);
  const b = analisarEspelho(a.indice, visto([{ id: "a1", gravado: ["CAD", "Eixo.wjcad"], visto: ["Projetos", "Eixo.wjcad"], quando: T("10:00") }]), T("11:05"));
  igual("14.5 repetir não duplica a cópia da lixeira", b.indice.arquivos.filter((x) => x.lixeira).length, 1);
  // os dois fizeram a mesma mudança: nada a decidir
  const c = analisarEspelho(comApp(T("10:30")), visto([{ id: "a1", gravado: ["CAD", "Eixo.wjcad"], visto: ["CAD", "Eixo motor.wjcad"] }]), T("11:00"));
  igual("14.6 mesma mudança nos dois lados: nada pendente nem conflito", [c.pendentes.length, c.conflitos.length], [0, 0]);
}

// 15. pendrive de verdade (RepositorioPasta) sobre um disco simulado
{
  class Arq {
    kind = "file" as const;
    dados = "";
    constructor(public name: string) {}
    async getFile() {
      return new File([this.dados], this.name);
    }
    async createWritable() {
      const partes: BlobPart[] = [];
      return { write: async (d: BlobPart) => void partes.push(d), close: async () => void (this.dados = await new Blob(partes).text()) };
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
  const mover = (de: string, para: string) => {
    const x = no(de)!, pd = no(de.split("/").slice(0, -1).join("/")) as Dir, pp = no(para.split("/").slice(0, -1).join("/")) as Dir;
    pd.filhos.delete(x.name);
    x.name = para.split("/").at(-1)!;
    pp.filhos.set(x.name, x);
  };
  const arquivos = (d: Dir = disco, c = ""): string[] => [...d.filhos.values()].flatMap((x) => (x.kind === "file" ? [`${c}${x.name}`] : x.name === ".wjpdm" ? [] : arquivos(x, `${c}${x.name}/`))).sort();
  const pastas = (d: Dir = disco, c = ""): string[] => [...d.filhos.values()].flatMap((x) => (x.kind === "file" || x.name === ".wjpdm" ? [] : [`${c}${x.name}`, ...pastas(x, `${c}${x.name}/`)])).sort();
  const ap = new Memoria("aparelho");
  com(ap, [arq("a1", ["b1"], T("08:00"), { nome: "Eixo.wjcad" }), arq("a2", ["b2"], T("08:00"), { nome: "Mancal.wjcad" })], { b1: "eixo", b2: "mancal" });
  ap.indice!.pastas.push({ id: "p2", nome: "Projetos", pai: null, mod: T("08:00") });
  const pen = () => new RepositorioPasta("pendrive", disco as unknown as PastaDisco, true);
  const sinc = (h: string, decididos = new Set<string>()) => sincronizar([ap, pen()], T(h), { decididos, usuario: "Johann", novoId: ids() });
  await sinc("09:00");
  igual("15.0 pendrive inicial", arquivos().filter((x) => !x.includes("versões")), ["WJPDM/CAD/Eixo.wjcad", "WJPDM/CAD/Mancal.wjcad"]);
  // à mão: CAD → "CAD 2026"; Mancal → Projetos com outro nome
  mover("WJPDM/CAD", "WJPDM/CAD 2026");
  mover("WJPDM/CAD 2026/Mancal.wjcad", "WJPDM/Projetos/Mancal B.wjcad");
  let r = await sinc("10:00");
  igual("15.1 detecta pela pasta e pelo conteúdo", r.foraDoApp.map((m) => `${m.tipo} ${m.de.join("/")} → ${m.para?.join("/")}`).sort(), ["arquivo CAD/Mancal.wjcad → Projetos/Mancal B.wjcad", "pasta CAD → CAD 2026"]);
  igual("15.2 nada muda sozinho no pendrive (sem CAD de volta)", [arquivos().filter((x) => !x.includes("versões")), pastas().includes("WJPDM/CAD")], [["WJPDM/CAD 2026/Eixo.wjcad", "WJPDM/Projetos/Mancal B.wjcad"], false]);
  // GO-IN do Eixo com a pasta à espera: conteúdo novo no lugar, sem recriar CAD
  ap.indice!.arquivos[0] = arq("a1", ["b1", "b1b"], T("10:30"), { nome: "Eixo.wjcad" });
  ap.blobs.set("b1b", "eixo v2");
  r = await sinc("10:31");
  igual("15.3 GO-IN com a pasta renomeada à mão: atualizado no lugar", [(no("WJPDM/CAD 2026/Eixo.wjcad") as Arq)?.dados, pastas().includes("WJPDM/CAD"), r.foraDoApp.length], ["eixo v2", false, 2]);
  // escolhas: pasta → Trazer; Mancal → Desfazer
  const pasta = r.foraDoApp.find((m) => m.tipo === "pasta")!, mancal = r.foraDoApp.find((m) => m.tipo === "arquivo")!;
  const t = trazerParaOCofre(ap.indice!, pasta, r.foraDoApp, T("10:40"), "Johann", ids());
  if (!("erro" in t)) ap.indice = t.indice;
  r = await sinc("10:41", new Set([mancal.id]));
  igual("15.4 depois das escolhas", [arquivos().filter((x) => !x.includes("versões")), r.foraDoApp.length, caminhoDoArquivo(ap.indice!, ap.indice!.arquivos[0]).join("/")], [["WJPDM/CAD 2026/Eixo.wjcad", "WJPDM/CAD 2026/Mancal.wjcad"], 0, "CAD 2026/Eixo.wjcad"]);
  igual("15.5 versões ficam ao lado do arquivo", arquivos().filter((x) => x.includes("versões")), ["WJPDM/CAD 2026/Eixo (versões)/Eixo v1.wjcad", "WJPDM/CAD 2026/Eixo (versões)/Eixo v2.wjcad", "WJPDM/CAD 2026/Mancal (versões)/Mancal v1.wjcad"]);
  // Desfazer de uma pasta renomeada à mão: tudo volta, a pasta vazia sai
  mover("WJPDM/CAD 2026", "WJPDM/Velha");
  r = await sinc("11:00");
  const p2 = r.foraDoApp[0];
  igual("15.6 pasta renomeada de novo", r.foraDoApp.map((m) => `${m.de.join("/")} → ${m.para?.join("/")}`), ["CAD 2026 → Velha"]);
  r = await sinc("11:01", new Set([p2.id]));
  igual("15.7 desfeita: arquivos e versões de volta, a pasta Velha sai (vazia)", [arquivos(), pastas().includes("WJPDM/Velha"), r.foraDoApp.length],
    [["WJPDM/CAD 2026/Eixo (versões)/Eixo v1.wjcad", "WJPDM/CAD 2026/Eixo (versões)/Eixo v2.wjcad", "WJPDM/CAD 2026/Eixo.wjcad", "WJPDM/CAD 2026/Mancal (versões)/Mancal v1.wjcad", "WJPDM/CAD 2026/Mancal.wjcad"], false, 0]);
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
