// Teste do Google Drive como cópia do cofre (src/comum/drive.ts) contra um Drive simulado que
// responde como a API REST v3 (consulta q, pastas, upload multipart, atualização de conteúdo,
// download e exclusão). Confere a estrutura Meu Drive/WJPDM/..., atualização no lugar (mesmo id,
// o Drive guarda as revisões), exclusão e acesso vencido (401).
import { pedidoUnico, RepositorioDrive } from "../src/comum/drive";
import { caminhoDoArquivo, indiceVazio, sincronizar, type Indice, type Repositorio } from "../src/pdm/sincronia";
import { trazerParaOCofre, type MudancaFora } from "../src/pdm/espelho";
import type { Arquivo } from "../src/pdm/regras";

let falhas = 0;
function igual(nome: string, obtido: unknown, esperado: unknown) {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "ok  " : "FALHA"} ${nome}: ${JSON.stringify(obtido)}${ok ? "" : ` (esperado ${JSON.stringify(esperado)})`}`);
}

// ---------- Drive simulado ----------
// Responde como a API REST v3 com o escopo drive.file: o que foi criado À MÃO no Drive (`mao`) não
// aparece nas consultas nem abre pelo id (404) — o app só enxerga o que ele mesmo criou.
interface Item { id: string; name: string; parents: string[]; mimeType: string; dados: string; revisoes: number; lixo?: boolean; mao?: boolean; mod: string }
class DriveFalso {
  itens = new Map<string, Item>();
  n = 0;
  token = "ok";
  chamadas = 0;
  apagados: string[] = []; // DELETE (apagado de vez)
  relogio = "2026-10-28T00:00:00.000Z";
  /** false: o Google recusa tirar um item de uma pasta criada à mão (drive.file sem acesso a ela) */
  tirarDeMao = true;
  meta = (x: Item) => ({ id: x.id, name: x.name, parents: x.parents, mimeType: x.mimeType, modifiedTime: x.mod, trashed: !!x.lixo });
  responder = async (url: string, init: RequestInit = {}): Promise<Response> => {
    this.chamadas++;
    if ((init.headers as Record<string, string>)?.Authorization !== `Bearer ${this.token}`) return new Response("unauthorized", { status: 401 });
    const u = new URL(url);
    const m = init.method ?? "GET";
    const id = u.pathname.match(/\/files\/([^/]+)$/)?.[1];
    const visivel = (x?: Item) => !!x && !x.mao;
    if (m === "GET" && !id) {
      const qq = u.searchParams.get("q")!;
      const nome = /name='((?:[^'\\]|\\.)*)'/.exec(qq)?.[1]?.replace(/\\'/g, "'");
      const pais = [...qq.matchAll(/'([^']+)' in parents/g)].map((x) => x[1]);
      const soPasta = qq.includes("mimeType='application/vnd.google-apps.folder'");
      const files = [...this.itens.values()].filter((x) => visivel(x) && !x.lixo && x.parents.some((p) => pais.includes(p)) && (nome === undefined || x.name === nome) && (!soPasta || x.mimeType.endsWith("folder"))).map(this.meta);
      return Response.json({ files });
    }
    if (m === "GET" && id) {
      const x = this.itens.get(id);
      if (!visivel(x)) return new Response("nf", { status: 404 });
      return u.searchParams.get("alt") === "media" ? new Response(x!.dados) : Response.json(this.meta(x!));
    }
    if (m === "POST" && u.pathname === "/drive/v3/files") {
      const meta = JSON.parse(String(init.body));
      if (meta.parents.some((p: string) => this.itens.get(p)?.mao)) return new Response("nf", { status: 404 });
      const x: Item = { id: `d${++this.n}`, name: meta.name, parents: meta.parents, mimeType: meta.mimeType, dados: "", revisoes: 0, mod: this.relogio };
      this.itens.set(x.id, x);
      return Response.json({ id: x.id });
    }
    if (m === "POST" && u.pathname === "/upload/drive/v3/files") {
      const fronteira = /boundary=(\S+)/.exec((init.headers as Record<string, string>)["Content-Type"])![1];
      const corpo = await (init.body as Blob).text();
      const partes = corpo.split(`--${fronteira}`).slice(1, -1).map((p) => p.slice(p.indexOf("\r\n\r\n") + 4).replace(/\r\n$/, ""));
      const meta = JSON.parse(partes[0]);
      const x: Item = { id: `d${++this.n}`, name: meta.name, parents: meta.parents, mimeType: "file", dados: partes[1], revisoes: 1, mod: this.relogio };
      this.itens.set(x.id, x);
      return Response.json({ id: x.id });
    }
    if (m === "PATCH" && id) {
      const x = this.itens.get(id);
      if (!visivel(x)) return new Response("nf", { status: 404 });
      if (typeof init.body === "string") {
        // metadados: nome, lixeira e troca de pasta (addParents/removeParents)
        const b = JSON.parse(init.body);
        const add = u.searchParams.get("addParents"), rem = u.searchParams.get("removeParents");
        if (add && this.itens.get(add)?.mao) return new Response("sem acesso à pasta", { status: 404 });
        if (rem && !this.tirarDeMao && rem.split(",").some((p) => this.itens.get(p)?.mao)) return new Response("sem acesso à pasta", { status: 403 });
        if (b.trashed) x!.lixo = true;
        if (b.name) x!.name = b.name;
        if (rem) x!.parents = x!.parents.filter((p) => !rem.split(",").includes(p));
        if (add) x!.parents = [...new Set([...x!.parents, add])];
        x!.mod = this.relogio;
        return Response.json({ id });
      }
      x!.dados = await (init.body as Blob).text();
      x!.revisoes++;
      x!.mod = this.relogio;
      return Response.json({ id });
    }
    if (m === "DELETE" && id) {
      this.apagados.push(this.itens.get(id)?.name ?? id);
      this.itens.delete(id);
      return new Response(null, { status: 204 });
    }
    return new Response("?", { status: 400 });
  };
  /** Caminho legível de um item (Meu Drive/...). */
  caminho(x: Item): string {
    const n: string[] = [x.name];
    for (let p = this.itens.get(x.parents[0]); p; p = this.itens.get(p.parents[0])) n.unshift(p.name);
    return n.join("/");
  }
  /** Arquivos fora da lixeira do Drive. */
  arquivos = () => [...this.itens.values()].filter((x) => x.mimeType === "file" && !this.naLixeira(x)).map((x) => this.caminho(x)).sort();
  naLixeira(x: Item): boolean {
    for (let p: Item | undefined = x; p; p = this.itens.get(p.parents[0])) if (p.lixo) return true;
    return false;
  }
  pastaPorCaminho = (c: string) => [...this.itens.values()].find((x) => x.mimeType.endsWith("folder") && !this.naLixeira(x) && this.caminho(x) === c);
  arquivoPorCaminho = (c: string) => [...this.itens.values()].find((x) => x.mimeType === "file" && !this.naLixeira(x) && this.caminho(x) === c);
  // o Johann mexendo direto no Drive (fora do app)
  criarPastaAMao(nome: string, pai: string): Item {
    const x: Item = { id: `m${++this.n}`, name: nome, parents: [pai], mimeType: "application/vnd.google-apps.folder", dados: "", revisoes: 0, mao: true, mod: this.relogio };
    this.itens.set(x.id, x);
    return x;
  }
  moverAMao(x: Item, pai: string) {
    x.parents = [pai];
  }
  renomearAMao(x: Item, nome: string, quando = this.relogio) {
    x.name = nome;
    x.mod = quando;
  }
}

class Memoria implements Repositorio {
  indice: Indice | null = null;
  blobs = new Map<string, string>();
  constructor(public nome: string) {}
  async lerIndice() { return this.indice ? JSON.parse(JSON.stringify(this.indice)) : null; }
  async gravarIndice(i: Indice) { this.indice = JSON.parse(JSON.stringify(i)); }
  async listarBlobs() { return new Set(this.blobs.keys()); }
  async lerBlob(id: string) { const t = this.blobs.get(id); return t === undefined ? undefined : new Blob([t]); }
  async gravarBlob(id: string, b: Blob) { this.blobs.set(id, await b.text()); }
  async apagarBlob(id: string) { this.blobs.delete(id); }
}
const arq = (id: string, nome: string, blobs: string[], mod: string, extra: Partial<Arquivo> = {}): Arquivo => ({
  id, nome, pasta: "p1", revisao: "", estado: "trabalho", cartao: {}, historico: [], mod,
  versoes: blobs.map((b, i) => ({ n: i + 1, blob: b, tamanho: 1, autor: "J", data: mod, comentario: "", revisao: "", estado: "trabalho" })), ...extra,
});
const AGORA = "2026-10-28T12:00:00.000Z";

const drive = new DriveFalso();
const tab = new Memoria("aparelho");
tab.indice = { ...indiceVazio(), pastas: [{ id: "p1", nome: "CAD", pai: null, mod: "2026-10-01T00:00:00.000Z" }], arquivos: [arq("a1", "Eixo.wjcad", ["b1"], "2026-10-27T10:00:00.000Z")] };
tab.blobs.set("b1", "eixo v1");
const repo = () => new RepositorioDrive(() => drive.token, drive.responder as typeof fetch);

// 1. primeiro envio: estrutura no Drive
let r = await sincronizar([tab, repo()], AGORA);
igual("sem falhas", r.falhas, []);
igual("estrutura em Meu Drive/WJPDM", drive.arquivos(), ["WJPDM/.wjpdm/blobs/b1", "WJPDM/.wjpdm/indice.json", "WJPDM/.wjpdm/pastas.json", "WJPDM/.wjpdm/visiveis.json", "WJPDM/CAD/Eixo (versões)/Eixo v1.wjcad", "WJPDM/CAD/Eixo.wjcad"]);
const visivel = [...drive.itens.values()].find((x) => x.name === "Eixo.wjcad")!;
igual("conteúdo legível", visivel.dados, "eixo v1");

// 2. nova versão: atualiza o mesmo arquivo no Drive (revisão), sem criar outro
tab.indice.arquivos[0] = arq("a1", "Eixo.wjcad", ["b1", "b2"], "2026-10-28T09:00:00.000Z");
tab.blobs.set("b2", "eixo v2");
r = await sincronizar([tab, repo()], AGORA);
const v2 = [...drive.itens.values()].filter((x) => x.name === "Eixo.wjcad");
igual("mesmo arquivo atualizado (o Drive guarda a revisão)", [v2.length, v2[0].id === visivel.id, v2[0].dados, v2[0].revisoes], [1, true, "eixo v2", 2]);

// 3. repetir: nada é enviado de novo (só leituras)
const antes = drive.n;
r = await sincronizar([tab, repo()], AGORA);
igual("repetir não cria nada", [drive.n - antes, r.copiados], [0, 0]);

// 4. arquivo novo vindo do Drive (outro aparelho) chega ao tablet
const outro = new Memoria("notebook");
r = await sincronizar([outro, repo()], AGORA);
igual("outro aparelho recebe o cofre do Drive", [outro.indice?.arquivos.map((a) => a.nome), outro.blobs.get("b2")], [["Eixo.wjcad"], "eixo v2"]);

// 5. renomeado e movido: o arquivo antigo sai do Drive
tab.indice.pastas.push({ id: "p2", nome: "Projetos", pai: null, mod: "2026-10-28T10:00:00.000Z" });
tab.indice.arquivos[0] = { ...tab.indice.arquivos[0], nome: "Eixo motor.wjcad", pasta: "p2", mod: "2026-10-28T11:00:00.000Z" };
r = await sincronizar([tab, repo()], AGORA);
igual("movido: arquivo e versões só no caminho novo (pasta de versões antiga some)", drive.arquivos().filter((x) => !x.includes(".wjpdm")), ["WJPDM/Projetos/Eixo motor (versões)/Eixo motor v1.wjcad", "WJPDM/Projetos/Eixo motor (versões)/Eixo motor v2.wjcad", "WJPDM/Projetos/Eixo motor.wjcad"]);

// 6. destruído no tablet: some do Drive (arquivo visível e conteúdo)
tab.indice.arquivos = [];
tab.indice.exclusoes = [{ id: "a1", tipo: "arquivo", data: "2026-10-28T11:30:00.000Z" }];
r = await sincronizar([tab, repo()], AGORA);
igual("excluído: só o índice fica", drive.arquivos(), ["WJPDM/.wjpdm/indice.json", "WJPDM/.wjpdm/pastas.json", "WJPDM/.wjpdm/visiveis.json"]);

// 7. acesso vencido (401): o Drive falha sozinho, o resto segue
drive.token = "novo"; // o Google trocou o token; o app ainda tem o antigo
const pen = new Memoria("pendrive");
r = await sincronizar([tab, pen, new RepositorioDrive(() => "ok", drive.responder as typeof fetch)], AGORA);
igual("acesso vencido: falha só no Drive, com mensagem clara", r.falhas.map((f) => `${f.repo}: ${f.erro}`), ["Google Drive: acesso ao Google vencido (reconecte)"]);
igual("pendrive igualado mesmo assim", pen.indice?.exclusoes.map((e) => e.id), ["a1"]);

// 8. nome com apóstrofo na consulta
tab.indice.arquivos = [arq("a9", "D'água.wjcad", ["b9"], "2026-10-28T11:40:00.000Z")];
tab.blobs.set("b9", "x");
drive.token = "ok";
const rr = repo();
r = await sincronizar([tab, rr], AGORA);
r = await sincronizar([tab, repo()], AGORA);
igual("apóstrofo no nome não duplica", drive.arquivos().filter((x) => x.endsWith("D'água.wjcad")).length, 1);
igual("caminho", caminhoDoArquivo(tab.indice, tab.indice.arquivos[0]), ["CAD", "D'água.wjcad"]);

// 9. pastas: a vazia é criada; a excluída (com subpasta) vai para a lixeira do Drive
const pastaNoDrive = (nome: string) => [...drive.itens.values()].find((x) => x.name === nome && x.mimeType.endsWith("folder"));
tab.indice.pastas.push({ id: "p3", nome: "Vazia", pai: null, mod: "2026-10-28T11:50:00.000Z" }, { id: "p4", nome: "Sub", pai: "p2", mod: "2026-10-28T11:50:00.000Z" });
r = await sincronizar([tab, repo()], AGORA);
igual("pastas vazias criadas no Drive", [!!pastaNoDrive("Vazia"), !!pastaNoDrive("Sub"), pastaNoDrive("Projetos")?.lixo], [true, true, undefined]);
tab.indice.pastas = tab.indice.pastas.filter((p) => p.id !== "p2" && p.id !== "p4");
tab.indice.exclusoes.push({ id: "p2", tipo: "pasta", data: "2026-10-28T11:55:00.000Z" }, { id: "p4", tipo: "pasta", data: "2026-10-28T11:55:00.000Z" });
r = await sincronizar([tab, repo()], AGORA);
igual("pasta excluída vai para a lixeira do Drive", [pastaNoDrive("Projetos")?.lixo, pastaNoDrive("Sub")?.lixo, pastaNoDrive("Vazia")?.lixo], [true, true, undefined]);

// 11. o Johann reorganiza À MÃO no Drive (12/11/2026): pasta renomeada, arquivo movido, pasta criada
//     à mão (invisível com drive.file). Nada muda sozinho; "Trazer" e "Desfazer" fazem o que dizem;
//     nunca uma pasta duplicada nem um DELETE de arquivo visível.
{
  const dv = new DriveFalso();
  const ap = new Memoria("aparelho");
  const T0 = "2026-11-12T08:00:00.000Z";
  ap.indice = {
    ...indiceVazio(),
    pastas: [{ id: "p1", nome: "CAD", pai: null, mod: T0 }, { id: "p2", nome: "Projetos", pai: null, mod: T0 }, { id: "p3", nome: "Sub", pai: "p1", mod: T0 }],
    arquivos: [arq("a1", "Eixo.wjcad", ["b1"], T0), arq("a2", "Mancal.wjcad", ["b2"], T0), arq("a3", "Tampa.wjcad", ["b3"], T0, { pasta: "p3" })],
  };
  for (const [k, v] of [["b1", "eixo"], ["b2", "mancal"], ["b3", "tampa"]]) ap.blobs.set(k, v);
  const rp = () => new RepositorioDrive(() => dv.token, dv.responder as typeof fetch);
  const sinc = (decididos = new Set<string>(), agora = "2026-11-12T10:00:00.000Z") => sincronizar([ap, rp()], agora, { decididos, usuario: "Johann", novoId: () => `n${++dv.n}` });
  let r = await sinc();
  igual("11.0 espelho inicial", dv.arquivos().filter((x) => !x.includes(".wjpdm") && !x.includes("versões")), ["WJPDM/CAD/Eixo.wjcad", "WJPDM/CAD/Mancal.wjcad", "WJPDM/CAD/Sub/Tampa.wjcad"]);
  const raiz = dv.pastaPorCaminho("WJPDM")!;
  // à mão: CAD → "CAD 2026"; Mancal → Projetos; Tampa → pasta nova criada à mão
  dv.relogio = "2026-11-12T09:00:00.000Z";
  dv.renomearAMao(dv.pastaPorCaminho("WJPDM/CAD")!, "CAD 2026");
  dv.moverAMao(dv.arquivoPorCaminho("WJPDM/CAD 2026/Mancal.wjcad")!, dv.pastaPorCaminho("WJPDM/Projetos")!.id);
  const morto = dv.criarPastaAMao("Arquivo morto", raiz.id);
  dv.moverAMao(dv.arquivoPorCaminho("WJPDM/CAD 2026/Sub/Tampa.wjcad")!, morto.id);
  const n0 = dv.n;
  r = await sinc();
  const fora = (r as { foraDoApp?: MudancaFora[] }).foraDoApp ?? [];
  const lista = fora.map((m) => `${m.tipo} ${m.de.join("/")} → ${m.para?.join("/") ?? "?"}`).sort();
  igual("11.1 detecta pasta renomeada, arquivo movido e pasta criada à mão", lista, ["arquivo CAD/Mancal.wjcad → Projetos/Mancal.wjcad", "arquivo CAD/Sub/Tampa.wjcad → ?", "pasta CAD → CAD 2026"]);
  igual("11.2 nada muda sozinho no Drive (sem pasta CAD de volta, nada criado)", [!!dv.pastaPorCaminho("WJPDM/CAD"), dv.n - n0, dv.arquivoPorCaminho("WJPDM/Projetos/Mancal.wjcad") !== undefined], [false, 0, true]);
  igual("11.3 nem no cofre", caminhoDoArquivo(ap.indice, ap.indice.arquivos.find((a) => a.id === "a2")!), ["CAD", "Mancal.wjcad"]);
  // GO-IN do Eixo com a renomeação ainda à espera: atualiza dentro de "CAD 2026" (pasta pelo id), sem duplicar CAD
  const eixo = ap.indice.arquivos.find((a) => a.id === "a1")!;
  ap.indice.arquivos[ap.indice.arquivos.indexOf(eixo)] = arq("a1", "Eixo.wjcad", ["b1", "b1b"], "2026-11-12T10:30:00.000Z");
  ap.blobs.set("b1b", "eixo v2");
  r = await sinc(new Set(), "2026-11-12T10:31:00.000Z");
  igual("11.4 GO-IN com a pasta renomeada à mão: sem pasta CAD duplicada", [!!dv.pastaPorCaminho("WJPDM/CAD"), dv.arquivoPorCaminho("WJPDM/CAD 2026/Eixo.wjcad")?.dados, !!dv.arquivoPorCaminho("WJPDM/CAD 2026/Eixo (versões)/Eixo v2.wjcad")], [false, "eixo v2", true]);
  const fora2 = ((r as { foraDoApp?: MudancaFora[] }).foraDoApp ?? []);
  igual("11.5 as três continuam à espera da escolha", fora2.length, 3);
  // escolhas: pasta → Trazer; Mancal → Desfazer; Tampa (pasta invisível) → Escolher pasta do cofre (Projetos)
  const pasta = fora2.find((m) => m.tipo === "pasta")!, mancal = fora2.find((m) => m.alvo === "a2")!, tampa = fora2.find((m) => m.alvo === "a3")!;
  let t = trazerParaOCofre(ap.indice, pasta, fora2, "2026-11-12T11:00:00.000Z", "Johann", () => "nX");
  igual("11.6 trazer a pasta: renomeada no cofre", "erro" in t ? t.erro : t.indice.pastas.find((p) => p.id === "p1")?.nome, "CAD 2026");
  if (!("erro" in t)) ap.indice = t.indice;
  // regressão (roteiro no navegador, 12/11/2026): trazer a pasta muda o caminho dos arquivos de dentro
  // no cofre, mas isso não é "o app também mexeu" — o Mancal e a Tampa continuam à espera, sem conflito
  const rp6 = await sinc(new Set(), "2026-11-12T11:00:30.000Z");
  igual("11.6b depois de trazer a pasta, os arquivos de dentro continuam à espera (sem conflito)", [rp6.foraDoApp.map((m) => m.alvo).sort(), rp6.conflitos, ap.indice.arquivos.filter((a) => a.lixeira).length], [["a2", "a3"], [], 0]);
  const semPasta = trazerParaOCofre(ap.indice, tampa, fora2, "2026-11-12T11:00:00.000Z", "Johann", () => "nY");
  igual("11.7 pasta criada à mão: o app não sabe o nome, pede a pasta do cofre", "erro" in semPasta, true);
  t = trazerParaOCofre(ap.indice, tampa, fora2, "2026-11-12T11:00:00.000Z", "Johann", () => "nY", "p2");
  if (!("erro" in t)) ap.indice = t.indice;
  const ta = ap.indice.arquivos.find((a) => a.id === "a3")!;
  igual("11.8 levada para a pasta escolhida, com histórico", [caminhoDoArquivo(ap.indice, ta).join("/"), ta.historico.at(-1)?.texto], ["Projetos/Tampa.wjcad", "Movido no Drive de CAD/Sub/Tampa.wjcad para uma pasta criada fora do app; levado para Projetos"]);
  r = await sinc(new Set([mancal.id, tampa.id]), "2026-11-12T11:01:00.000Z");
  igual("11.9 depois das escolhas: Mancal de volta, Tampa em Projetos, nada pendente", [dv.arquivos().filter((x) => !x.includes(".wjpdm") && !x.includes("versões")), ((r as { foraDoApp?: MudancaFora[] }).foraDoApp ?? []).length],
    [["WJPDM/CAD 2026/Eixo.wjcad", "WJPDM/CAD 2026/Mancal.wjcad", "WJPDM/Projetos/Tampa.wjcad"], 0]);
  igual("11.10 nenhum arquivo visível apagado de vez (só lixeira do Drive)", dv.apagados.filter((n) => n.endsWith(".wjcad")), []);
  igual("11.11 Tampa saiu da pasta criada à mão sem ser apagada (mesmo id ou cópia nova; a original fica com o Johann)", !!dv.arquivoPorCaminho("WJPDM/Projetos/Tampa.wjcad"), true);
  // conflito: arquivo movido à mão E renomeado no app depois → a mais recente (app) vence; a outra vai para a lixeira do cofre
  dv.relogio = "2026-11-12T12:00:00.000Z";
  dv.moverAMao(dv.arquivoPorCaminho("WJPDM/CAD 2026/Eixo.wjcad")!, dv.pastaPorCaminho("WJPDM/Projetos")!.id);
  const e2 = ap.indice.arquivos.find((a) => a.id === "a1")!;
  e2.nome = "Eixo motor.wjcad";
  e2.mod = "2026-11-12T12:30:00.000Z";
  r = await sinc(new Set(), "2026-11-12T12:31:00.000Z");
  igual("11.12 conflito: a mudança do app (mais recente) vence", dv.arquivos().filter((x) => x.includes("Eixo") && !x.includes("versões")), ["WJPDM/CAD 2026/Eixo motor.wjcad"]);
  const lix = ap.indice.arquivos.find((a) => a.lixeira && a.id.startsWith("a1~"));
  igual("11.13 a outra (onde o Johann pôs) vai para a lixeira do cofre", [lix?.nome, lix && caminhoDoArquivo(ap.indice, lix).slice(0, -1).join("/"), r.conflitos], ["Eixo (conflito 2026-11-12).wjcad", "Projetos", ["Eixo motor.wjcad"]]);
  // excluído no app: o arquivo visível vai para a lixeira do Drive (recuperável), não DELETE
  ap.indice.arquivos = ap.indice.arquivos.filter((a) => a.id !== "a2");
  ap.indice.exclusoes.push({ id: "a2", tipo: "arquivo", data: "2026-11-12T13:00:00.000Z" });
  await sinc(new Set(), "2026-11-12T13:01:00.000Z");
  const mc = [...dv.itens.values()].find((x) => x.name === "Mancal.wjcad");
  igual("11.14 excluído no app: Mancal na lixeira do Drive, não apagado de vez", [mc?.lixo, dv.apagados.filter((n) => n.endsWith(".wjcad"))], [true, []]);
}

// 12. o Drive do Johann hoje: pastas.json antigo (só caminhos) e a pasta JÁ renomeada à mão antes
//     desta versão — a pasta é reconhecida pela pasta-mãe dos arquivos dela (sem duplicar)
{
  const dv = new DriveFalso();
  const ap = new Memoria("aparelho");
  const T0 = "2026-11-12T08:00:00.000Z";
  ap.indice = { ...indiceVazio(), pastas: [{ id: "p1", nome: "CAD", pai: null, mod: T0 }], arquivos: [arq("a1", "Eixo.wjcad", ["b1"], T0)] };
  ap.blobs.set("b1", "eixo");
  const rp = () => new RepositorioDrive(() => dv.token, dv.responder as typeof fetch);
  await sincronizar([ap, rp()], "2026-11-12T09:00:00.000Z");
  const pj = dv.arquivoPorCaminho("WJPDM/.wjpdm/pastas.json")!;
  pj.dados = JSON.stringify([["CAD"]]); // formato antigo
  const vj = dv.arquivoPorCaminho("WJPDM/.wjpdm/visiveis.json")!;
  const vis = JSON.parse(vj.dados) as Record<string, { pai?: string }>;
  for (const v of Object.values(vis)) delete v.pai;
  vj.dados = JSON.stringify(vis); // sem a pasta de cada arquivo (formato antigo)
  dv.renomearAMao(dv.pastaPorCaminho("WJPDM/CAD")!, "Mecânica");
  const r = await sincronizar([ap, rp()], "2026-11-12T10:00:00.000Z", { usuario: "Johann" });
  igual("12.1 pastas.json antigo + pasta já renomeada: detectada, sem CAD duplicada", [r.foraDoApp.map((m) => `${m.de.join("/")} → ${m.para?.join("/")}`), !!dv.pastaPorCaminho("WJPDM/CAD")], [["CAD → Mecânica"], false]);
  igual("12.2 pastas.json passa a guardar o id", Object.keys(JSON.parse(dv.arquivoPorCaminho("WJPDM/.wjpdm/pastas.json")!.dados).pastas ?? {}), ["p1"]);
}

// 13. Desfazer de um arquivo posto numa pasta criada à mão, quando o Google não deixa o app tirá-lo
//     de lá: o app põe uma cópia no lugar do cofre e a original fica onde o Johann pôs (nada apagado)
{
  const dv = new DriveFalso();
  dv.tirarDeMao = false;
  const ap = new Memoria("aparelho");
  const T0 = "2026-11-12T08:00:00.000Z";
  ap.indice = { ...indiceVazio(), pastas: [{ id: "p1", nome: "CAD", pai: null, mod: T0 }], arquivos: [arq("a1", "Eixo.wjcad", ["b1"], T0)] };
  ap.blobs.set("b1", "eixo");
  const rp = () => new RepositorioDrive(() => dv.token, dv.responder as typeof fetch);
  await sincronizar([ap, rp()], "2026-11-12T09:00:00.000Z");
  const mao = dv.criarPastaAMao("Minha pasta", dv.pastaPorCaminho("WJPDM")!.id);
  const original = dv.arquivoPorCaminho("WJPDM/CAD/Eixo.wjcad")!;
  dv.moverAMao(original, mao.id);
  let r = await sincronizar([ap, rp()], "2026-11-12T10:00:00.000Z");
  const m = r.foraDoApp[0];
  r = await sincronizar([ap, rp()], "2026-11-12T10:01:00.000Z", { decididos: new Set([m.id]) });
  igual("13.1 cópia no lugar do cofre; a original continua na pasta dele", [dv.arquivoPorCaminho("WJPDM/CAD/Eixo.wjcad")?.dados, original.parents[0] === mao.id, original.lixo, dv.apagados.filter((n) => n.endsWith(".wjcad"))], ["eixo", true, undefined, []]);
  r = await sincronizar([ap, rp()], "2026-11-12T10:02:00.000Z");
  igual("13.2 depois disso nada fica pendente", r.foraDoApp.length, 0);
}

// 10. janela do Google: um pedido por vez e sempre termina (GO-IN travado, 10/11/2026)
{
  let aberturas = 0;
  let responder: ((v: boolean) => void) | null = null;
  const pedir = pedidoUnico<boolean>((terminar) => {
    aberturas++;
    responder = terminar;
  }, 200, false);
  // renovação do primeiro toque + toque do GO-IN no mesmo gesto: uma janela só, a mesma resposta
  const a = pedir(), b = pedir();
  igual("dois pedidos juntos abrem uma janela só", [aberturas, a === b], [1, true]);
  responder!(true);
  igual("os dois recebem a resposta do Google", await Promise.all([a, b]), [true, true]);
  // o Google nunca responde (janela fechada sem aviso): termina no prazo, sem travar a sincronia
  const c = pedir();
  igual("pedido novo depois da resposta abre outra janela", aberturas, 2);
  const t0 = Date.now();
  igual("sem resposta: termina no prazo com false", await c, false);
  igual("terminou perto do prazo (200 ms)", Date.now() - t0 < 1000, true);
  responder!(true); // resposta tardia não quebra nada
  // erro ao abrir: termina na hora
  const d = pedidoUnico<boolean>(() => {
    throw new Error("bloqueada");
  }, 60000, false)();
  igual("erro ao abrir a janela: termina com false", await d, false);
}

console.log(falhas ? `\ndrive: ${falhas} falha(s)` : "\ndrive: tudo certo");
if (falhas) process.exit(1);
