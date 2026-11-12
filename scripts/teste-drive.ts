// Teste do Google Drive como cópia do cofre (src/comum/drive.ts) contra um Drive simulado que
// responde como a API REST v3 (consulta q, pastas, upload multipart, atualização de conteúdo,
// download e exclusão). Confere a estrutura Meu Drive/WJPDM/..., atualização no lugar (mesmo id,
// o Drive guarda as revisões), exclusão e acesso vencido (401).
import { pedidoUnico, RepositorioDrive } from "../src/comum/drive";
import { caminhoDoArquivo, indiceVazio, sincronizar, type Indice, type Repositorio } from "../src/pdm/sincronia";
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
interface Item { id: string; name: string; parents: string[]; mimeType: string; dados: string; revisoes: number; lixo?: boolean; lixoEm?: string; mao?: boolean; mod: string }
/** md5 simulado (o Drive devolve o md5 do conteúdo dos arquivos) */
const md5 = (t: string) => `md5-${[...t].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7)}-${t.length}`;
class DriveFalso {
  itens = new Map<string, Item>();
  n = 0;
  token = "ok";
  chamadas = 0;
  apagados: string[] = []; // DELETE (apagado de vez)
  relogio = "2026-10-28T00:00:00.000Z";
  /** false: o Google recusa tirar um item de uma pasta criada à mão (drive.file sem acesso a ela) */
  tirarDeMao = true;
  /** como na API: o que está dentro de uma pasta na lixeira também está na lixeira */
  meta = (x: Item) => {
    const lixo = this.lixoDe(x);
    return { id: x.id, name: x.name, parents: x.parents, mimeType: x.mimeType, modifiedTime: x.mod, trashed: !!lixo, ...(lixo ? { trashedTime: lixo.lixoEm } : {}), ...(x.mimeType === "file" ? { md5Checksum: md5(x.dados) } : {}) };
  };
  lixoDe(x: Item): Item | undefined {
    for (let p: Item | undefined = x; p; p = this.itens.get(p.parents[0])) if (p.lixo) return p;
    return undefined;
  }
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
      const files = [...this.itens.values()].filter((x) => visivel(x) && !this.lixoDe(x) && (!pais.length || x.parents.some((p) => pais.includes(p))) && (nome === undefined || x.name === nome) && (!soPasta || x.mimeType.endsWith("folder"))).map(this.meta);
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
      return Response.json({ id: x.id, md5Checksum: md5(x.dados) });
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
        if (b.trashed) (x!.lixo = true), (x!.lixoEm = this.relogio);
        if (b.name) x!.name = b.name;
        if (rem) x!.parents = x!.parents.filter((p) => !rem.split(",").includes(p));
        if (add) x!.parents = [...new Set([...x!.parents, add])];
        x!.mod = this.relogio;
        return Response.json({ id });
      }
      x!.dados = await (init.body as Blob).text();
      x!.revisoes++;
      x!.mod = this.relogio;
      return Response.json({ id, md5Checksum: md5(x!.dados) });
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
  lixeiraAMao(x: Item) {
    x.lixo = true;
    x.lixoEm = this.relogio;
  }
  editarAMao(x: Item, dados: string) {
    x.dados = dados;
    x.mod = this.relogio;
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

// 11. o Johann reorganiza À MÃO no Drive (decisão de 12/11/2026: o que ele faz à mão é o modelo do
//     cofre): aplicado sozinho, exceções desfeitas no Drive com o motivo, pasta criada à mão
//     (invisível com drive.file) só com aviso; nunca pasta duplicada nem DELETE.
{
  const dv = new DriveFalso();
  const ap = new Memoria("aparelho");
  const T0 = "2026-11-12T08:00:00.000Z";
  ap.indice = {
    ...indiceVazio(),
    pastas: [{ id: "p1", nome: "CAD", pai: null, mod: T0 }, { id: "p2", nome: "Projetos", pai: null, mod: T0 }, { id: "p3", nome: "Sub", pai: "p1", mod: T0 }],
    arquivos: [
      arq("a1", "Eixo.wjcad", ["b1"], T0), arq("a2", "Mancal.wjcad", ["b2"], T0), arq("a3", "Tampa.wjcad", ["b3"], T0, { pasta: "p3" }), arq("a4", "Pino.wjcad", ["b4"], T0, { pasta: "p2" }),
      arq("a5", "Bucha.wjcad", ["b5"], T0, { estado: "serie-prod" }), arq("a6", "Arruela.wjcad", ["b6"], T0, { checkout: { usuario: "Ana", data: T0 } }),
    ],
  };
  for (const [k, v] of [["b1", "eixo"], ["b2", "mancal"], ["b3", "tampa"], ["b4", "pino"], ["b5", "bucha"], ["b6", "arruela"]]) ap.blobs.set(k, v);
  const rp = () => new RepositorioDrive(() => dv.token, dv.responder as typeof fetch);
  const sinc = (agora = "2026-11-12T10:00:00.000Z") => sincronizar([ap, rp()], agora, { usuario: "Johann", novoId: () => `n${++dv.n}` });
  const visiveis = () => dv.arquivos().filter((x) => !x.includes(".wjpdm") && !x.includes("versões"));
  const reg = (id: string) => ap.indice!.arquivos.find((a) => a.id === id)!;
  const pastasCom = (nome: string) => [...dv.itens.values()].filter((x) => x.mimeType.endsWith("folder") && !dv.naLixeira(x) && x.name === nome).length;
  let r = await sinc();
  igual("11.0 espelho inicial", visiveis(), ["WJPDM/CAD/Arruela.wjcad", "WJPDM/CAD/Bucha.wjcad", "WJPDM/CAD/Eixo.wjcad", "WJPDM/CAD/Mancal.wjcad", "WJPDM/CAD/Sub/Tampa.wjcad", "WJPDM/Projetos/Pino.wjcad"]);
  const raiz = dv.pastaPorCaminho("WJPDM")!;
  // à mão: CAD → "CAD 2026"; Mancal → Projetos; Tampa → pasta criada à mão; Pino e Bucha (Série em
  // produção) para a lixeira do Drive; Arruela (GO-OUT da Ana) → Projetos; Eixo editado
  dv.relogio = "2026-11-12T09:00:00.000Z";
  dv.renomearAMao(dv.pastaPorCaminho("WJPDM/CAD")!, "CAD 2026");
  dv.moverAMao(dv.arquivoPorCaminho("WJPDM/CAD 2026/Mancal.wjcad")!, dv.pastaPorCaminho("WJPDM/Projetos")!.id);
  const morto = dv.criarPastaAMao("Arquivo morto", raiz.id);
  dv.moverAMao(dv.arquivoPorCaminho("WJPDM/CAD 2026/Sub/Tampa.wjcad")!, morto.id);
  dv.lixeiraAMao(dv.arquivoPorCaminho("WJPDM/Projetos/Pino.wjcad")!);
  dv.lixeiraAMao(dv.arquivoPorCaminho("WJPDM/CAD 2026/Bucha.wjcad")!);
  dv.moverAMao(dv.arquivoPorCaminho("WJPDM/CAD 2026/Arruela.wjcad")!, dv.pastaPorCaminho("WJPDM/Projetos")!.id);
  dv.editarAMao(dv.arquivoPorCaminho("WJPDM/CAD 2026/Eixo.wjcad")!, "eixo mexido à mão");
  r = await sinc();
  igual("11.1 tudo visto e resolvido sem perguntar", r.foraDoApp.map((m) => `${m.acao} ${m.nome}`).sort(),
    ["desfeito Arruela.wjcad", "desfeito Bucha.wjcad", "editado Eixo.wjcad", "fora Tampa.wjcad", "lixeira Pino.wjcad", "movido Mancal.wjcad", "renomeado CAD"]);
  igual("11.2 cofre: pasta renomeada, Mancal movido (histórico), Pino na lixeira do cofre", [ap.indice!.pastas.find((p) => p.id === "p1")?.nome, caminhoDoArquivo(ap.indice!, reg("a2")).join("/"), reg("a2").historico.at(-1)?.texto, reg("a4").lixeira, reg("a4").versoes.length],
    ["CAD 2026", "Projetos/Mancal.wjcad", "Movido no Drive de CAD 2026/Mancal.wjcad para Projetos/Mancal.wjcad", true, 1]);
  igual("11.3 exceções ficam no cofre: Bucha (protegida) e Arruela (GO-OUT da Ana)", [reg("a5").lixeira, caminhoDoArquivo(ap.indice!, reg("a6")).join("/"), reg("a3").pasta], [undefined, "CAD 2026/Arruela.wjcad", "p3"]);
  igual("11.4 Drive igual ao cofre: Bucha recriada, Arruela de volta, Tampa onde ele pôs (sem cópia repetida)", visiveis(),
    ["WJPDM/Arquivo morto/Tampa.wjcad", "WJPDM/CAD 2026/Arruela.wjcad", "WJPDM/CAD 2026/Bucha.wjcad", "WJPDM/CAD 2026/Eixo.wjcad", "WJPDM/Projetos/Mancal.wjcad"]);
  igual("11.5 conteúdo editado à mão: vale o cofre", dv.arquivoPorCaminho("WJPDM/CAD 2026/Eixo.wjcad")?.dados, "eixo");
  igual("11.6 a pasta (versões) acompanha o arquivo movido (pelo id), nada sobra no lugar antigo", dv.arquivos().filter((x) => x.includes("Mancal (versões)")), ["WJPDM/Projetos/Mancal (versões)/Mancal v1.wjcad"]);
  igual("11.7 sem pasta duplicada (procurada pelo id)", [pastasCom("CAD"), pastasCom("CAD 2026"), pastasCom("Projetos"), pastasCom("WJPDM"), pastasCom("Sub")], [0, 1, 1, 1, 1]);
  igual("11.8 o motivo das exceções", r.foraDoApp.filter((m) => m.acao === "desfeito" || m.acao === "fora").map((m) => m.motivo?.split(":")[0]).sort(), ["\"Série em produção\" não deixa excluir (torne-o obsoleto antes)", "em GO-OUT com Ana", "posto numa pasta criada à mão no Drive"]);
  r = await sinc("2026-11-12T10:05:00.000Z");
  igual("11.9 sincronia seguinte: só o aviso da pasta criada à mão (continua igual)", r.foraDoApp.map((m) => `${m.acao} ${m.nome}`), ["fora Tampa.wjcad"]);
  // GO-IN da Tampa com ela na pasta criada à mão: o conteúdo novo entra no lugar, sem cópia repetida
  ap.indice!.arquivos = ap.indice!.arquivos.map((a) => (a.id === "a3" ? arq("a3", "Tampa.wjcad", ["b3", "b3b"], "2026-11-12T10:10:00.000Z", { pasta: "p3" }) : a));
  ap.blobs.set("b3b", "tampa v2");
  await sinc("2026-11-12T10:11:00.000Z");
  igual("11.10 GO-IN com o arquivo na pasta criada à mão: atualizado lá, sem repetir", [dv.arquivoPorCaminho("WJPDM/Arquivo morto/Tampa.wjcad")?.dados, visiveis().filter((x) => x.endsWith("Tampa.wjcad")).length], ["tampa v2", 1]);
  // ele cria a pasta pelo WJPDM ("Arquivo morto" no cofre) e move a Tampa para ela à mão no Drive
  ap.indice!.pastas.push({ id: "p9", nome: "Morto", pai: null, mod: "2026-11-12T10:20:00.000Z" });
  await sinc("2026-11-12T10:21:00.000Z");
  dv.relogio = "2026-11-12T10:30:00.000Z";
  dv.moverAMao(dv.arquivoPorCaminho("WJPDM/Arquivo morto/Tampa.wjcad")!, dv.pastaPorCaminho("WJPDM/Morto")!.id);
  r = await sinc("2026-11-12T10:31:00.000Z");
  igual("11.11 movida para a pasta criada pelo WJPDM: aplicada no cofre", [r.foraDoApp.map((m) => `${m.acao} ${m.nome}`), caminhoDoArquivo(ap.indice!, reg("a3")).join("/")], [["movido Tampa.wjcad"], "Morto/Tampa.wjcad"]);
  // conflito: arquivo movido à mão E renomeado no app depois → a mais recente (app) vence; a outra vai para a lixeira do cofre
  dv.relogio = "2026-11-12T12:00:00.000Z";
  dv.moverAMao(dv.arquivoPorCaminho("WJPDM/CAD 2026/Eixo.wjcad")!, dv.pastaPorCaminho("WJPDM/Projetos")!.id);
  const e2 = reg("a1");
  e2.nome = "Eixo motor.wjcad";
  e2.mod = "2026-11-12T12:30:00.000Z";
  r = await sinc("2026-11-12T12:31:00.000Z");
  igual("11.12 conflito: a mudança do app (mais recente) vence", dv.arquivos().filter((x) => x.includes("Eixo") && !x.includes("versões")), ["WJPDM/CAD 2026/Eixo motor.wjcad"]);
  const lix = ap.indice!.arquivos.find((a) => a.lixeira && a.id.startsWith("a1~"));
  igual("11.13 a outra (onde o Johann pôs) vai para a lixeira do cofre", [lix?.nome, lix && caminhoDoArquivo(ap.indice!, lix).slice(0, -1).join("/"), r.conflitos], ["Eixo (conflito 2026-11-12).wjcad", "Projetos", ["Eixo motor.wjcad"]]);
  // movido à mão às 13:00 depois de renomeado no app às 12:45: o Drive (mais recente) vence
  const e3 = reg("a1"); // a sincronia troca o índice: o registro de agora
  e3.nome = "Eixo B.wjcad";
  e3.mod = "2026-11-12T12:45:00.000Z";
  dv.relogio = "2026-11-12T13:00:00.000Z";
  // (o app ainda não levou o nome novo ao Drive: o Johann mexe no arquivo com o nome antigo)
  const ex = dv.arquivoPorCaminho("WJPDM/CAD 2026/Eixo motor.wjcad")!;
  dv.moverAMao(ex, dv.pastaPorCaminho("WJPDM/Projetos")!.id);
  ex.mod = dv.relogio;
  r = await sinc("2026-11-12T13:01:00.000Z");
  igual("11.14 conflito: a mudança do Drive (mais recente) vence", [caminhoDoArquivo(ap.indice!, reg("a1")).join("/"), r.foraDoApp.map((m) => m.acao)], ["Projetos/Eixo motor.wjcad", ["conflito"]]);
  // pasta inteira para a lixeira do Drive: arquivos para a lixeira do cofre, pasta fora, sem órfão
  dv.relogio = "2026-11-12T14:00:00.000Z";
  dv.lixeiraAMao(dv.pastaPorCaminho("WJPDM/Projetos")!);
  r = await sinc("2026-11-12T14:01:00.000Z");
  igual("11.15 pasta excluída no Drive: arquivos na lixeira do cofre, pasta sai, sem órfão", [r.foraDoApp.map((m) => `${m.acao} ${m.nome}`).sort(), ap.indice!.pastas.some((p) => p.id === "p2"), r.recuperados, ap.indice!.arquivos.filter((a) => !a.lixeira && !ap.indice!.pastas.some((p) => p.id === a.pasta) && a.pasta !== "raiz").length],
    [["lixeira Eixo motor.wjcad", "lixeira Mancal.wjcad", "lixeira Projetos"], false, [], 0]);
  igual("11.16 nada apagado de vez no Drive (nenhum DELETE, nem de conteúdo)", dv.apagados, []);
}

// 12. o Drive do Johann hoje: pastas.json antigo (só caminhos) e a pasta JÁ renomeada à mão antes
//     desta versão — a pasta é reconhecida pela pasta-mãe dos arquivos dela (sem duplicar) e o cofre a segue
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
  const vis = JSON.parse(vj.dados) as Record<string, { pai?: string; md5?: string }>;
  for (const v of Object.values(vis)) delete v.pai, delete v.md5;
  vj.dados = JSON.stringify(vis); // sem a pasta de cada arquivo nem o md5 (formato antigo)
  dv.renomearAMao(dv.pastaPorCaminho("WJPDM/CAD")!, "Mecânica");
  const r = await sincronizar([ap, rp()], "2026-11-12T10:00:00.000Z", { usuario: "Johann" });
  igual("12.1 pastas.json antigo + pasta já renomeada: aplicada, sem CAD duplicada", [r.foraDoApp.map((m) => `${m.acao} ${m.de.join("/")} → ${m.para?.join("/")}`), ap.indice!.pastas[0].nome, !!dv.pastaPorCaminho("WJPDM/CAD")], [["renomeado CAD → Mecânica"], "Mecânica", false]);
  igual("12.2 pastas.json passa a guardar o id; visiveis.json, o md5", [Object.keys(JSON.parse(dv.arquivoPorCaminho("WJPDM/.wjpdm/pastas.json")!.dados).pastas ?? {}), Object.values(JSON.parse(dv.arquivoPorCaminho("WJPDM/.wjpdm/visiveis.json")!.dados) as { md5?: string }[]).every((v) => !!v.md5)], [["p1"], true]);
}

// 13. a estrutura do cofre no Drive nunca aceita mudança de fora: WJPDM renomeada à mão é achada pelo
//     indice.json (sem criar outra WJPDM) e o nome volta; .wjpdm apagada é recriada; (versões) regravada
{
  const dv = new DriveFalso();
  const ap = new Memoria("aparelho");
  const T0 = "2026-11-12T08:00:00.000Z";
  ap.indice = { ...indiceVazio(), pastas: [{ id: "p1", nome: "CAD", pai: null, mod: T0 }], arquivos: [arq("a1", "Eixo.wjcad", ["b1", "b2"], T0)] };
  ap.blobs.set("b1", "eixo v1");
  ap.blobs.set("b2", "eixo v2");
  const rp = () => new RepositorioDrive(() => dv.token, dv.responder as typeof fetch);
  await sincronizar([ap, rp()], "2026-11-12T09:00:00.000Z");
  dv.renomearAMao(dv.pastaPorCaminho("WJPDM")!, "Meu cofre");
  let r = await sincronizar([ap, rp()], "2026-11-12T10:00:00.000Z", { usuario: "Johann" });
  const raizes = [...dv.itens.values()].filter((x) => x.parents[0] === "root" && x.mimeType.endsWith("folder") && !dv.naLixeira(x)).map((x) => x.name);
  igual("13.1 WJPDM renomeada à mão: achada pelo id, nome de volta, nenhuma outra criada", [raizes, r.foraDoApp.map((m) => `${m.acao} ${m.nome}`), r.falhas], [["WJPDM"], ["desfeito WJPDM"], []]);
  // versão excluída e editada à mão: o app regrava a pasta (versões)
  dv.lixeiraAMao(dv.arquivoPorCaminho("WJPDM/CAD/Eixo (versões)/Eixo v1.wjcad")!);
  dv.editarAMao(dv.arquivoPorCaminho("WJPDM/CAD/Eixo (versões)/Eixo v2.wjcad")!, "mexido");
  r = await sincronizar([ap, rp()], "2026-11-12T10:05:00.000Z", { usuario: "Johann" });
  igual("13.2 (versões): excluída é recriada e editada volta ao conteúdo do cofre", [dv.arquivoPorCaminho("WJPDM/CAD/Eixo (versões)/Eixo v1.wjcad")?.dados, dv.arquivoPorCaminho("WJPDM/CAD/Eixo (versões)/Eixo v2.wjcad")?.dados, ap.indice!.arquivos[0].lixeira], ["eixo v1", "eixo v2", undefined]);
  // .wjpdm para a lixeira do Drive: recriada com tudo (índice, conteúdos), sem duplicar o visível
  dv.lixeiraAMao(dv.pastaPorCaminho("WJPDM/.wjpdm")!);
  r = await sincronizar([ap, rp()], "2026-11-12T10:10:00.000Z", { usuario: "Johann" });
  igual("13.3 .wjpdm na lixeira: recriada, nada repetido nem perdido", [dv.arquivos().filter((x) => x.includes(".wjpdm")).sort(), dv.arquivos().filter((x) => !x.includes(".wjpdm")), ap.indice!.arquivos.filter((a) => !a.lixeira).length, r.falhas],
    [["WJPDM/.wjpdm/blobs/b1", "WJPDM/.wjpdm/blobs/b2", "WJPDM/.wjpdm/indice.json", "WJPDM/.wjpdm/pastas.json", "WJPDM/.wjpdm/visiveis.json"], ["WJPDM/CAD/Eixo (versões)/Eixo v1.wjcad", "WJPDM/CAD/Eixo (versões)/Eixo v2.wjcad", "WJPDM/CAD/Eixo.wjcad"], 1, []]);
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
