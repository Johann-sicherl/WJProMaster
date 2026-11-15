// Teste do Google Drive como cópia do cofre (src/comum/drive.ts) contra um Drive simulado que
// responde como a API REST v3 (consulta q, pastas, upload multipart, atualização de conteúdo,
// download e exclusão). Confere a estrutura Meu Drive/WJPDM/..., atualização no lugar (mesmo id,
// o Drive guarda as revisões), exclusão e acesso vencido (401).
import { pedidoUnico, registrar, RepositorioDrive, resumoAberturas, travadoPorOutra, type AberturaGoogle } from "../src/comum/drive";
import { caminhoDoArquivo, indiceVazio, indiceZerado, sincronizar, type Indice, type Repositorio } from "../src/pdm/sincronia";
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

// 11. o cofre manda (15/11/2026): mudança feita à mão no Drive não entra no cofre; a sincronia põe os
//     visíveis de volta como o cofre está, pelos ids (sem pasta duplicada, nada apagado de vez).
{
  const dv = new DriveFalso();
  const ap = new Memoria("aparelho");
  const T0 = "2026-11-15T08:00:00.000Z";
  ap.indice = {
    ...indiceVazio(),
    pastas: [{ id: "p1", nome: "CAD", pai: null, mod: T0 }, { id: "p2", nome: "Projetos", pai: null, mod: T0 }],
    arquivos: [arq("a1", "Eixo.wjcad", ["b1"], T0), arq("a2", "Pino.wjcad", ["b2"], T0, { pasta: "p2" })],
  };
  ap.blobs.set("b1", "eixo").set("b2", "pino");
  const rp = () => new RepositorioDrive(() => dv.token, dv.responder as typeof fetch);
  const visiveis = () => dv.arquivos().filter((x) => !x.includes(".wjpdm") && !x.includes("versões"));
  await sincronizar([ap, rp()], "2026-11-15T09:00:00.000Z");
  igual("11.0 visíveis iniciais", visiveis(), ["WJPDM/CAD/Eixo.wjcad", "WJPDM/Projetos/Pino.wjcad"]);
  dv.renomearAMao(dv.pastaPorCaminho("WJPDM/CAD")!, "CAD 2026");
  dv.moverAMao(dv.arquivoPorCaminho("WJPDM/CAD 2026/Eixo.wjcad")!, dv.pastaPorCaminho("WJPDM/Projetos")!.id);
  const antes = JSON.stringify(ap.indice);
  const r = await sincronizar([ap, rp()], "2026-11-15T10:00:00.000Z");
  igual("11.1 cofre intacto (nada aplicado de fora)", [JSON.stringify(ap.indice!.arquivos) === JSON.stringify(JSON.parse(antes).arquivos), ap.indice!.pastas.map((p) => p.nome).sort(), r.falhas], [true, ["CAD", "Projetos"], []]);
  igual("11.2 o Drive volta a ser o cofre, sem pasta duplicada nem DELETE", [visiveis(), [...dv.itens.values()].filter((x) => x.name === "CAD" && x.mimeType.endsWith("folder")).length, dv.apagados], [["WJPDM/CAD/Eixo.wjcad", "WJPDM/Projetos/Pino.wjcad"], 1, []]);
}

// 12. zerar cofre com o Drive e dois aparelhos (15/11/2026): o Drive vai para a lixeira dele (nunca
//     DELETE), ganha a identidade nova; o outro aparelho é limpo sem reenviar o antigo.
{
  const dv = new DriveFalso();
  const pc = new Memoria("aparelho"), tablet = new Memoria("aparelho");
  const T0 = "2026-11-15T08:00:00.000Z";
  pc.indice = { ...indiceVazio(), meta: { id: "meta", nome: "Cofre", usuario: "Johann", mascara: "12-####", mod: T0 }, pastas: [{ id: "p1", nome: "CAD", pai: null, mod: T0 }], arquivos: [arq("a1", "Eixo.wjcad", ["b1", "b2"], T0)] };
  pc.blobs.set("b1", "eixo v1").set("b2", "eixo v2");
  const rp = () => new RepositorioDrive(() => dv.token, dv.responder as typeof fetch);
  await sincronizar([pc, rp()], "2026-11-15T09:00:00.000Z");
  await sincronizar([tablet, rp()], "2026-11-15T09:05:00.000Z");
  igual("12.0 o tablet recebeu o cofre", [tablet.indice!.arquivos.length, tablet.blobs.size], [1, 2]);
  // zerar no computador
  pc.indice = indiceZerado(pc.indice!, "cofre2", "2026-11-15T10:00:00.000Z");
  pc.blobs.clear();
  const r1 = await sincronizar([pc, rp()], "2026-11-15T10:00:00.000Z");
  const sisDrive = (x: string) => x.includes(".wjpdm/indice.json") || x.includes(".wjpdm/visiveis.json") || x.includes(".wjpdm/pastas.json");
  igual("12.1 Drive zerado: visíveis, versões e conteúdos na lixeira do Drive; só o índice novo", [dv.arquivos().filter((x) => !sisDrive(x)), r1.zeradas, dv.apagados], [[], ["Google Drive"], []]);
  const noDrive = JSON.parse(dv.arquivoPorCaminho("WJPDM/.wjpdm/indice.json")!.dados) as Indice;
  igual("12.2 índice do Drive: identidade nova, meta mantida, nada mais", [noDrive.cofre?.id, noDrive.meta?.usuario, noDrive.arquivos.length, noDrive.pastas.length], ["cofre2", "Johann", 0, 0]);
  igual("12.3 o que saiu está na lixeira do Drive (recuperável)", [...dv.itens.values()].filter((x) => x.mimeType === "file" && x.lixo).length > 0, true);
  const r2 = await sincronizar([tablet, rp()], "2026-11-15T10:30:00.000Z");
  igual("12.4 tablet limpo ao sincronizar, sem reenviar o antigo", [tablet.indice!.arquivos.length, tablet.indice!.pastas.length, tablet.blobs.size, tablet.indice!.cofre?.id, r2.zeradas, dv.arquivos().filter((x) => !sisDrive(x))], [0, 0, 0, "cofre2", ["aparelho"], []]);
}

// 13. login do Google: trava comum a todas as janelas e registro das aberturas (15/11/2026)
{
  const agora = Date.parse("2026-11-15T12:00:00.000Z");
  igual("13.1 trava de outra janela, ainda valendo: espera", travadoPorOutra({ dono: "B", ate: agora + 1000 }, "A", agora), true);
  igual("13.2 trava minha, vencida ou nenhuma: pode abrir", [travadoPorOutra({ dono: "A", ate: agora + 1000 }, "A", agora), travadoPorOutra({ dono: "B", ate: agora - 1 }, "A", agora), travadoPorOutra(null, "A", agora)], [false, false, false]);
  let lista: AberturaGoogle[] = [];
  const ab = (min: number, pagina: string, janela: string, motivo: string, modo = "none", resultado: AberturaGoogle["resultado"] = "ok") =>
    (lista = registrar(lista, { quando: new Date(agora - min * 60000).toISOString(), pagina, janela, motivo, modo, resultado }));
  ab(300, "cad", "j1", "primeiro toque", "");
  ab(90, "pdm", "j2", "sincronizar com toque");
  ab(30, "cad", "j1", "primeiro toque");
  ab(30, "cad/montagem", "j3", "primeiro toque", "", "evitada");
  ab(26 * 60, "pdm", "j2", "antiga");
  const r = resumoAberturas(lista, agora, 24);
  igual("13.3 últimas 24 h: abertas, evitadas, sem seletor", [r.abertas, r.evitadas, r.semSeletor], [3, 1, 2]);
  igual("13.4 por página, por janela e por quê", [r.porPagina, r.porJanela, r.porMotivo], [{ cad: 2, pdm: 1 }, { j1: 2, j2: 1 }, { "primeiro toque": 2, "sincronizar com toque": 1 }]);
  igual("13.5 por hora (3 horas diferentes)", Object.keys(r.porHora).length, 3);
  for (let k = 0; k < 250; k++) lista = registrar(lista, lista[0]);
  igual("13.6 registro limitado a 200", lista.length, 200);
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
