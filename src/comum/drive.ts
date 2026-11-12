// Google Drive como cópia do cofre do WJPDM (mesma interface das outras cópias: Repositorio).
// Acesso pelo navegador com o login do Google (Google Identity Services, token de 1 hora) e
// escopo drive.file: o app só enxerga o que ele mesmo criou no Drive (a pasta WJPDM).
//
// No Drive:  Meu Drive/WJPDM/<pastas>/<arquivo>        ← arquivo atual (o Drive guarda revisões)
//            Meu Drive/WJPDM/<pastas>/<nome> (versões)/<nome> v<n>.<ext>  ← cópia de cada GO-IN
//            Meu Drive/WJPDM/.wjpdm/indice.json        ← índice do cofre
//            Meu Drive/WJPDM/.wjpdm/blobs/<id>         ← conteúdo de cada versão
//            Meu Drive/WJPDM/.wjpdm/visiveis.json      ← o que já foi gravado em <pastas> (id no Drive)
//            Meu Drive/WJPDM/.wjpdm/pastas.json        ← pasta do cofre → id da pasta no Drive
//
// Mudanças feitas à mão no Drive (12/11/2026): as pastas e os arquivos que o app criou são achados
// pelo id (não pelo nome), então pasta renomeada à mão não vira pasta duplicada e arquivo movido à
// mão é visto onde está; o que foi excluído à mão é visto (lixeira do Drive ou 404) com a data, e o
// conteúdo editado fora do app, pelo md5. O cofre aplica sozinho (src/pdm/espelho.ts). A pasta WJPDM
// e a .wjpdm renomeadas/movidas à mão são achadas pelo indice.json (só o app o cria). Nada é apagado
// de vez: o que sai vai para a lixeira do Drive (trashed), nunca DELETE.

import { visiveisDoIndice, type Indice, type Repositorio } from "../pdm/sincronia";
import { caminhoDaPasta, decisaoVazia, type DecisaoEspelho, type EspelhoVisto, type ItemVisto } from "../pdm/espelho";

/** Cliente OAuth do projeto WJProMaster no Google Cloud (público; a chave secreta não é usada). */
export const CLIENTE_GOOGLE = "751073631393-8tmbbv019s57975tbfv4h1g11gsahunb.apps.googleusercontent.com";
const ESCOPO = "https://www.googleapis.com/auth/drive.file";
const API = "https://www.googleapis.com/drive/v3/files";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";
const PASTA = "application/vnd.google-apps.folder";

/** Destino na nuvem (registrado no cofre). */
export interface DestinoNuvem {
  nome: string;
  conectado(): boolean;
  situacao(): string;
  conectar(): Promise<void>;
  /** Renova o acesso vencido (abre a janela do Google; precisa de um toque recente). */
  renovar(): Promise<boolean>;
  /** Já autorizado e o acesso vence em menos de `ms` (ou já venceu): vale renovar no próximo toque. */
  vencendo?(ms: number): boolean;
  /** Renova já (dentro de um toque), mesmo que ainda não tenha vencido. */
  renovarAgora?(): Promise<boolean>;
  /** Carrega antes o que a renovação precisa (a janela abre logo no toque). */
  preparar?(): void;
  repositorio(): Repositorio;
}

export class ErroDrive extends Error {
  constructor(public status: number, msg: string) {
    super(msg);
  }
}

// ---------- repositório (só fetch: testável com um Drive simulado) ----------

type Buscar = typeof fetch;
const q = (s: string) => s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
/** Metadados de um item do Drive (null = sumiu, na lixeira ou fora do alcance do app). */
type Meta = { id: string; name: string; parents?: string[]; mimeType?: string; modifiedTime?: string; trashed?: boolean; trashedTime?: string; md5Checksum?: string };
/** Arquivo visível gravado: caminho no cofre, conteúdo, id no Drive, pasta onde foi posto no Drive, pasta do cofre e md5 do que o app gravou. */
type RegVis = { caminho: string[]; blob: string; drive: string; pai?: string; pasta?: string; md5?: string };
/** Pasta do cofre → pasta no Drive (e a pasta-mãe no cofre). */
type RegPastas = Record<string, { caminho: string[]; drive: string; pai?: string | null }>;
const CAMPOS = "id,name,parents,mimeType,modifiedTime,trashed,trashedTime,md5Checksum";
const igual = (a?: string[], b?: string[]) => !!a && !!b && a.length === b.length && a.every((x, k) => x === b[k]);

export class RepositorioDrive implements Repositorio {
  nome = "Google Drive";
  /** O Drive é cópia de publicação: só recebe o que passou por GO-IN. */
  publicado = true;
  private ids = new Map<string, string>(); // caminho de pasta → id
  private blobIds: Map<string, string> | null = null;
  constructor(private token: () => string, private buscar: Buscar = (...a) => fetch(...a)) {}

  private async req(url: string, init: RequestInit = {}): Promise<Response> {
    // rede "pendurada" (Wi-Fi sem internet): desiste a tempo, em vez de travar a sincronia e o salvar
    const envio = !!init.body;
    const limite = typeof AbortSignal !== "undefined" && "timeout" in AbortSignal ? AbortSignal.timeout(envio ? 120000 : 15000) : undefined;
    const r = await this.buscar(url, { ...init, ...(limite && !init.signal ? { signal: limite } : {}), headers: { ...(init.headers ?? {}), Authorization: `Bearer ${this.token()}` } }).catch((e: Error) => {
      throw new ErroDrive(0, e?.name === "TimeoutError" || e?.name === "AbortError" ? "sem resposta do Google (sem internet?)" : "sem conexão com o Google");
    });
    if (!r.ok) {
      const t = await r.text().catch(() => "");
      throw new ErroDrive(r.status, r.status === 401 ? "acesso ao Google vencido (reconecte)" : r.status === 403 ? "o Google recusou o acesso (confira o usuário de teste e o escopo drive.file)" : `Drive respondeu ${r.status} ${t.slice(0, 120)}`);
    }
    return r;
  }
  private async listar(consulta: string, campos = "id,name"): Promise<Meta[]> {
    const out: Meta[] = [];
    let pagina = "";
    do {
      const u = `${API}?q=${encodeURIComponent(consulta)}&fields=${encodeURIComponent(`nextPageToken,files(${campos})`)}&pageSize=1000&spaces=drive${pagina ? `&pageToken=${pagina}` : ""}`;
      const j = (await (await this.req(u)).json()) as { files: Meta[]; nextPageToken?: string };
      out.push(...j.files);
      pagina = j.nextPageToken ?? "";
    } while (pagina);
    return out;
  }
  /** Pasta pelo caminho (a partir de Meu Drive), criando o que faltar. */
  private async pasta(caminho: string[]): Promise<string> {
    let pai = "root";
    for (let k = 0; k < caminho.length; k++) {
      const chave = caminho.slice(0, k + 1).join("/");
      let id = this.ids.get(chave);
      if (!id) {
        const achadas = await this.listar(`name='${q(caminho[k])}' and '${pai}' in parents and mimeType='${PASTA}' and trashed=false`);
        id = achadas[0]?.id;
        if (!id) {
          const r = await this.req(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: caminho[k], mimeType: PASTA, parents: [pai] }) });
          id = ((await r.json()) as { id: string }).id;
        }
        this.ids.set(chave, id);
      }
      pai = id;
    }
    return pai;
  }
  /** Pasta pelo caminho, sem criar (undefined se não existe). */
  private async acharPasta(caminho: string[]): Promise<string | undefined> {
    let pai = "root";
    for (const n of caminho) {
      const id = (await this.listar(`name='${q(n)}' and '${pai}' in parents and mimeType='${PASTA}' and trashed=false`))[0]?.id;
      if (!id) return undefined;
      pai = id;
    }
    return pai;
  }
  private async arquivoNa(pasta: string, nome: string): Promise<string | undefined> {
    return (await this.listar(`name='${q(nome)}' and '${pasta}' in parents and trashed=false`))[0]?.id;
  }
  private async baixar(id: string): Promise<Blob> {
    return (await this.req(`${API}/${id}?alt=media`)).blob();
  }
  /** md5 de cada arquivo enviado nesta sincronia (o Drive devolve): conteúdo editado fora do app é visto por ele. */
  private md5s = new Map<string, string>();
  /** Cria (multipart: dados + nome/pasta) ou atualiza o conteúdo de um arquivo existente. */
  private async enviar(dados: Blob, nome: string, pasta: string, id?: string): Promise<string> {
    if (id) {
      const r = await this.req(`${UPLOAD}/${id}?uploadType=media&fields=id,md5Checksum`, { method: "PATCH", body: dados });
      const j = (await r.json().catch(() => ({}))) as { md5Checksum?: string };
      if (j.md5Checksum) this.md5s.set(id, j.md5Checksum);
      return id;
    }
    const fronteira = `wjpdm${Math.random().toString(36).slice(2)}`;
    const corpo = new Blob([
      `--${fronteira}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name: nome, parents: [pasta] })}\r\n`,
      `--${fronteira}\r\nContent-Type: ${dados.type || "application/octet-stream"}\r\n\r\n`, dados, `\r\n--${fronteira}--`,
    ]);
    const r = await this.req(`${UPLOAD}?uploadType=multipart&fields=id,md5Checksum`, { method: "POST", headers: { "Content-Type": `multipart/related; boundary=${fronteira}` }, body: corpo });
    const j = (await r.json()) as { id: string; md5Checksum?: string };
    if (j.md5Checksum) this.md5s.set(j.id, j.md5Checksum);
    return j.id;
  }

  /** Texto de um arquivo fora do cofre (ex.: Meu Drive/WJTaskPlan/tarefas.json); null se não existe. */
  async lerArquivo(pasta: string[], nome: string): Promise<string | null> {
    const p = await this.acharPasta(pasta);
    const id = p && (await this.arquivoNa(p, nome));
    return id ? (await this.baixar(id)).text() : null;
  }
  /** Grava (cria ou atualiza no lugar) um arquivo fora do cofre. */
  async gravarArquivo(pasta: string[], nome: string, dados: Blob) {
    const p = await this.pasta(pasta);
    await this.enviar(dados, nome, p, await this.arquivoNa(p, nome));
  }

  /** O que o app teve de pôr de volta na estrutura (pasta WJPDM ou .wjpdm renomeada/movida à mão). */
  avisos: string[] = [];
  private base?: Promise<{ raiz: string; sis: string }>;
  /**
   * Meu Drive/WJPDM e WJPDM/.wjpdm. Pelo nome no lugar de sempre; se foram renomeadas ou movidas à
   * mão, pelo indice.json (só o app o cria, então só ele aparece com drive.file) — e o nome volta,
   * para os outros aparelhos acharem. Nunca uma segunda pasta WJPDM enquanto a original existir.
   */
  private localizar() {
    return (this.base ??= (async () => {
      const porNome = async (nome: string, pai: string) => (await this.listar(`name='${q(nome)}' and '${pai}' in parents and mimeType='${PASTA}' and trashed=false`))[0]?.id;
      let raiz = await porNome("WJPDM", "root");
      let sis = raiz ? await porNome(".wjpdm", raiz) : undefined;
      if (!sis) {
        const indices = (await this.listar("name='indice.json' and trashed=false", "id,name,parents,modifiedTime")).sort((a, b) => (b.modifiedTime ?? "").localeCompare(a.modifiedTime ?? ""));
        for (const x of indices) {
          const s = x.parents?.[0];
          const ms = s ? await this.meta(s) : null;
          const r = ms?.parents?.[0];
          const mr = r ? await this.meta(r) : null;
          if (!s || !ms || !r || !mr || ms.mimeType !== PASTA || mr.mimeType !== PASTA || (raiz && r !== raiz)) continue;
          [raiz, sis] = [r, s];
          for (const [id, nome, m] of [[r, "WJPDM", mr], [s, ".wjpdm", ms]] as const) {
            if (m.name === nome) continue;
            await this.req(`${API}/${id}?fields=id`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: nome }) });
            this.metas.set(id, { ...m, name: nome });
            this.avisos.push(`A pasta ${nome} foi renomeada à mão no Drive (para "${m.name}"): o app pôs o nome de volta (ela guarda o cofre).`);
          }
          break;
        }
      }
      raiz ??= await this.criarPasta("WJPDM", "root", false);
      sis ??= await this.criarPasta(".wjpdm", raiz, false);
      this.ids.set("WJPDM", raiz);
      this.ids.set("WJPDM/.wjpdm", sis);
      return { raiz, sis };
    })());
  }
  private sis = () => this.localizar().then((b) => b.sis);
  private blobsPasta = () => this.localizar().then(() => this.pasta(["WJPDM", ".wjpdm", "blobs"]));

  async lerIndice(): Promise<Indice | null> {
    const id = await this.arquivoNa(await this.sis(), "indice.json");
    if (!id) return null;
    const i = JSON.parse(await (await this.baixar(id)).text()) as Indice;
    if (i.formato !== "wjpdm-indice") throw new Error("índice do cofre inválido no Drive");
    return i;
  }
  async gravarIndice(i: Indice) {
    const sis = await this.sis();
    await this.enviar(new Blob([JSON.stringify(i)], { type: "application/json" }), "indice.json", sis, await this.arquivoNa(sis, "indice.json"));
  }
  async listarBlobs() {
    const lista = await this.listar(`'${await this.blobsPasta()}' in parents and trashed=false`);
    this.blobIds = new Map(lista.map((f) => [f.name, f.id]));
    return new Set(this.blobIds.keys());
  }
  async lerBlob(id: string) {
    if (!this.blobIds) await this.listarBlobs();
    const d = this.blobIds!.get(id);
    return d ? this.baixar(d) : undefined;
  }
  async gravarBlob(id: string, b: Blob) {
    const d = await this.enviar(b, id, await this.blobsPasta());
    this.blobIds?.set(id, d);
  }
  /** Conteúdo que nenhum arquivo usa mais: para a lixeira do Drive (nunca DELETE). */
  async apagarBlob(id: string) {
    if (!this.blobIds) await this.listarBlobs();
    const d = this.blobIds!.get(id);
    if (d) await this.req(`${API}/${d}?fields=id`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ trashed: true }) });
    this.blobIds!.delete(id);
  }

  // ---------- espelho legível (Meu Drive/WJPDM/<pastas>) ----------

  /** Metadados lidos nesta sincronia (cada sincronia usa um repositório novo). */
  private metas = new Map<string, Meta | null>();
  /** itens que sumiram: na lixeira do Drive (com a data) ou apagados de vez ("") */
  private sumidos = new Map<string, string>();
  private estado?: Promise<{ vis: Record<string, RegVis>; idVis?: string; pastas: RegPastas; idPastas?: string }>;
  private raiz = () => this.localizar().then((b) => b.raiz);

  private async meta(id: string): Promise<Meta | null> {
    if (this.metas.has(id)) return this.metas.get(id)!;
    const m = await this.req(`${API}/${id}?fields=${CAMPOS}`)
      .then((r) => r.json() as Promise<Meta>)
      .catch((e) => {
        if (e instanceof ErroDrive && e.status === 404) return null; // apagado de vez ou fora do alcance (drive.file)
        throw e;
      });
    if (!m || m.trashed) this.sumidos.set(id, m?.trashedTime ?? "");
    this.metas.set(id, m && !m.trashed ? m : null);
    return this.metas.get(id)!;
  }
  /** Tudo o que está nestas pastas (poucas consultas: vários pais por consulta). */
  private async lerFilhos(pais: string[]) {
    for (let k = 0; k < pais.length; k += 40) {
      const grupo = pais.slice(k, k + 40);
      for (const m of await this.listar(`trashed=false and (${grupo.map((p) => `'${p}' in parents`).join(" or ")})`, CAMPOS)) this.metas.set(m.id, m);
    }
  }
  /** Leva o item para a pasta `pai` com o nome `nome` (PATCH: mesmo id, sem recriar). */
  private async colocar(id: string, nome: string, pai: string): Promise<"ok" | "sumiu" | "preso"> {
    const m = await this.meta(id);
    if (!m) return "sumiu";
    const pais = m.parents ?? [];
    if (m.name === nome && pais.length === 1 && pais[0] === pai) return "ok";
    const tirar = pais.filter((p) => p !== pai);
    const params = [...(pais.includes(pai) ? [] : [`addParents=${pai}`]), ...(tirar.length ? [`removeParents=${tirar.join(",")}`] : [])];
    try {
      await this.req(`${API}/${id}?${[...params, "fields=id"].join("&")}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: nome }) });
    } catch (e) {
      // pasta criada à mão (fora do alcance do drive.file): o app não consegue tirar o item de lá
      if (e instanceof ErroDrive && (e.status === 403 || e.status === 404)) return "preso";
      throw e;
    }
    this.metas.set(id, { ...m, name: nome, parents: [pai] });
    return "ok";
  }
  /** Para a lixeira do Drive (recuperável lá por 30 dias): nunca apagar de vez o que está à vista. */
  private lixeira(id: string) {
    this.metas.set(id, null);
    return this.req(`${API}/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ trashed: true }) }).then(() => {}, () => {});
  }
  /**
   * Pasta nova em `pai`. `procurar`: antes, reaproveita a do app com o mesmo nome (só quando não há id
   * guardado dela, ex.: pastas.json perdido); com id guardado, a pasta é sempre achada pelo id.
   */
  private async criarPasta(nome: string, pai: string, procurar = true): Promise<string> {
    const achada = procurar ? (await this.listar(`name='${q(nome)}' and '${pai}' in parents and mimeType='${PASTA}' and trashed=false`))[0]?.id : undefined;
    if (achada) return achada;
    const r = await this.req(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: nome, mimeType: PASTA, parents: [pai] }) });
    return ((await r.json()) as { id: string }).id;
  }

  /**
   * visiveis.json e pastas.json. O pastas.json antigo (só caminhos) passa a ter o id de cada pasta,
   * achado pela pasta-mãe dos arquivos que estavam dentro dela — assim uma pasta já renomeada à mão
   * antes desta versão também é reconhecida.
   */
  private carregar(i: Indice) {
    return (this.estado ??= (async () => {
      const sis = await this.sis();
      const idVis = await this.arquivoNa(sis, "visiveis.json");
      const vis: Record<string, RegVis> = idVis ? JSON.parse(await (await this.baixar(idVis)).text()) : {};
      const idPastas = await this.arquivoNa(sis, "pastas.json");
      const bruto: unknown = idPastas ? JSON.parse(await (await this.baixar(idPastas)).text()) : { pastas: {} };
      let pastas: RegPastas;
      if (Array.isArray(bruto)) {
        pastas = {};
        const antigos = bruto as string[][];
        const raiz = await this.raiz();
        for (const p of [...i.pastas].sort((a, b) => caminhoDaPasta(i, a.id).length - caminhoDaPasta(i, b.id).length)) {
          const c = caminhoDaPasta(i, p.id);
          if (!antigos.some((x) => igual(x, c))) continue;
          const votos = new Map<string, number>();
          for (const v of Object.entries(vis).filter(([k, x]) => !k.includes("#") && igual(x.caminho.slice(0, -1), c)).slice(0, 5).map(([, x]) => x)) {
            const pai = (await this.meta(v.drive))?.parents?.[0];
            if (pai && pai !== raiz) votos.set(pai, (votos.get(pai) ?? 0) + 1);
          }
          let id = [...votos.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
          if (!id) {
            const pai = p.pai ? pastas[p.pai]?.drive : raiz;
            id = pai && (await this.listar(`name='${q(p.nome)}' and '${pai}' in parents and mimeType='${PASTA}' and trashed=false`))[0]?.id;
          }
          if (id) pastas[p.id] = { caminho: c, drive: id };
        }
      } else pastas = (bruto as { pastas: RegPastas }).pastas ?? {};
      return { vis, idVis, pastas, idPastas };
    })());
  }

  /** Onde estão de fato as pastas e os arquivos que o app pôs em Meu Drive/WJPDM. */
  async lerEspelho(i: Indice): Promise<EspelhoVisto> {
    const { vis, pastas } = await this.carregar(i);
    const raiz = await this.raiz();
    const conhecidas = [raiz, ...Object.values(pastas).map((p) => p.drive), ...Object.values(vis).map((v) => v.pai).filter((x): x is string => !!x)];
    await this.lerFilhos([...new Set(conhecidas)]);
    // o que não apareceu nas pastas conhecidas: saiu delas (pasta criada à mão), lixeira ou apagado
    for (const id of [...Object.values(pastas).map((p) => p.drive), ...Object.entries(vis).filter(([k]) => !k.includes("#")).map(([, v]) => v.drive)]) if (!this.metas.has(id)) await this.meta(id);
    const caminho = (id: string, n = 0): string[] | null => {
      if (id === raiz) return [];
      const m = this.metas.get(id);
      const pai = m?.parents?.[0];
      if (!m || !pai || n > 64) return null;
      const c = caminho(pai, n + 1);
      return c && [...c, m.name];
    };
    const item = (id: string, gravado: string[], drive: string, noCofre: string | null | undefined): ItemVisto => {
      const m = this.metas.get(drive);
      const pai = noCofre !== undefined ? { pai: noCofre } : {};
      // excluído à mão (lixeira do Drive ou apagado de vez): o cofre o leva para a lixeira dele
      if (!m) return { id, gravado, visto: undefined, ...(this.sumidos.get(drive) ? { quando: this.sumidos.get(drive) } : {}), ...pai };
      const d = m.parents?.[0] ? caminho(m.parents[0]) : null;
      return { id, gravado, visto: d && [...d, m.name], quando: m.modifiedTime, ...pai };
    };
    // conteúdo mudado fora do app (o md5 não é o do que o app gravou): vale a cópia do cofre
    const editados = Object.entries(vis).filter(([, v]) => {
      const m = this.metas.get(v.drive);
      return !!m && !!v.md5 && !!m.md5Checksum && m.md5Checksum !== v.md5;
    }).map(([k]) => k);
    return {
      copia: this.nome,
      pastas: Object.entries(pastas).map(([id, p]) => item(id, p.caminho, p.drive, p.pai)),
      arquivos: Object.entries(vis).filter(([k]) => !k.includes("#")).map(([k, v]) => item(k, v.caminho, v.drive, v.pasta)),
      editados,
      estrutura: [...this.avisos],
    };
  }

  /**
   * Arquivos legíveis em Meu Drive/WJPDM, iguais ao cofre: conteúdo atualizado no lugar (o Drive
   * guarda as revisões), mover/renomear pelo id, pastas pelo id (também as "(versões)"). O que está
   * numa pasta criada à mão (`espelho.manter`) fica onde ele pôs; o que foi editado fora do app
   * (`espelho.regravar`) recebe de novo o conteúdo do cofre. O que sai vai para a lixeira do Drive.
   */
  async gravarVisiveis(i: Indice, lerBlob: (id: string) => Promise<Blob | undefined>, espelho: DecisaoEspelho = decisaoVazia()) {
    const sis = await this.sis();
    const raiz = await this.raiz();
    const { vis: antes, idVis, pastas: pastasAntes, idPastas } = await this.carregar(i);
    // 1. pastas do cofre (também as vazias), das mais rasas para as mais fundas
    const pastasAgora: RegPastas = {};
    const presas = new Set<string>(); // ficaram numa pasta criada à mão: não vão para a lixeira
    const fundura = new Map(i.pastas.map((p) => [p.id, caminhoDaPasta(i, p.id)]));
    for (const p of [...i.pastas].sort((a, b) => fundura.get(a.id)!.length - fundura.get(b.id)!.length)) {
      const rec = pastasAntes[p.id];
      if (rec && espelho.manter.has(`pasta:${p.id}`)) {
        pastasAgora[p.id] = rec;
        continue;
      }
      const pai = p.pai && pastasAgora[p.pai] ? pastasAgora[p.pai].drive : raiz;
      let id: string | undefined = rec?.drive;
      if (id) {
        const r = await this.colocar(id, p.nome, pai);
        if (r === "preso") presas.add(id);
        if (r !== "ok") id = undefined;
      }
      // excluída à mão e mantida no cofre (tem arquivos que não saem): recriada, sem procurar pelo nome
      id ??= await this.criarPasta(p.nome, pai, !rec);
      pastasAgora[p.id] = { caminho: fundura.get(p.id)!, drive: id, pai: p.pai ?? null };
    }
    const pastaDe = new Map(Object.values(pastasAgora).map((x) => [JSON.stringify(x.caminho), x.drive]));
    const versoes = new Map<string, string>(); // "<pasta>/<nome> (versões)" → id
    // pasta "(versões)" de cada arquivo pelo id guardado: acompanha o arquivo movido/renomeado à mão
    const versoesAntes = new Map<string, string>();
    for (const [k, v] of Object.entries(antes)) if (k.includes("#") && v.pai) versoesAntes.set(k.split("#")[0], v.pai);
    const pastaVersoes = async (pai: string, nome: string, arquivo: string) => {
      const k = `${pai}/${nome}`;
      if (!versoes.has(k)) {
        let id = versoesAntes.get(arquivo);
        if (id) {
          const r = await this.colocar(id, nome, pai);
          if (r === "preso") presas.add(id);
          if (r !== "ok") id = undefined;
        }
        versoes.set(k, id ?? (await this.criarPasta(nome, pai)));
      }
      return versoes.get(k)!;
    };
    // 2. arquivos (e, ao lado, as pastas de versões)
    const agora: Record<string, RegVis> = {};
    const pastaDoArquivo = new Map(i.arquivos.map((a) => [a.id, a.pasta]));
    const md5 = (drive: string, v?: RegVis) => this.md5s.get(drive) ?? this.metas.get(drive)?.md5Checksum ?? v?.md5;
    for (const { chave: k, caminho, blob } of visiveisDoIndice(i)) {
      const v = antes[k];
      const regravar = espelho.regravar.has(k);
      if (espelho.manter.has(k.split("#")[0])) {
        // numa pasta criada à mão: fica onde ele pôs; conteúdo novo (ou o do cofre, se editado fora) entra no lugar
        if (!v) continue;
        agora[k] = v;
        if (v.blob !== blob || regravar) {
          const dados = await lerBlob(blob);
          if (dados && (await this.enviar(dados, "", "", v.drive).then(() => true, () => false))) agora[k] = { ...v, blob, md5: this.md5s.get(v.drive) ?? v.md5 };
        }
        continue;
      }
      const versao = k.includes("#");
      const dirPrincipal = caminho.slice(0, versao ? -2 : -1);
      const principal = dirPrincipal.length ? pastaDe.get(JSON.stringify(dirPrincipal)) : raiz;
      if (!principal) continue;
      const pasta = versao ? await pastaVersoes(principal, caminho[caminho.length - 2], k.split("#")[0]) : principal;
      const nome = caminho[caminho.length - 1];
      let drive: string | undefined = v?.drive;
      if (drive && (v.blob !== blob || regravar)) {
        const dados = await lerBlob(blob);
        if (!dados) continue;
        drive = await this.enviar(dados, nome, pasta, drive).catch((e) => {
          if (e instanceof ErroDrive && e.status === 404) return undefined; // apagado à mão no Drive
          throw e;
        });
      }
      if (drive) {
        const r = await this.colocar(drive, nome, pasta);
        if (r === "preso") presas.add(drive);
        if (r !== "ok") drive = undefined;
      }
      if (!drive) {
        const dados = await lerBlob(blob);
        if (!dados) continue;
        // sem registro (sincronia anterior interrompida antes de gravar visiveis.json): reaproveita o
        // arquivo com o mesmo nome que já está lá, em vez de criar outro igual
        const ja = !v ? await this.arquivoNa(pasta, nome) : undefined;
        drive = ja && !Object.values(agora).some((x) => x.drive === ja) ? await this.enviar(dados, nome, pasta, ja) : await this.enviar(dados, nome, pasta);
      }
      agora[k] = { caminho, blob, drive, pai: pasta, pasta: pastaDoArquivo.get(k.split("#")[0]), md5: md5(drive, v?.drive === drive ? v : undefined) };
    }
    // 3. o que saiu do cofre (lixeira, destruído): para a lixeira do Drive, nunca apagado de vez
    const usados = new Set(Object.values(agora).map((x) => x.drive));
    for (const v of Object.values(antes)) if (!usados.has(v.drive) && !presas.has(v.drive)) await this.lixeira(v.drive);
    // pastas de versões que ficaram sem nada (arquivo excluído, renomeado ou movido)
    const pastasDeVersoes = async (x: Record<string, RegVis>) => {
      const r = new Set<string>();
      for (const [k, v] of Object.entries(x)) {
        if (!k.includes("#")) continue;
        const pai = v.pai ?? this.metas.get(v.drive)?.parents?.[0] ?? (await this.acharPasta(["WJPDM", ...v.caminho.slice(0, -1)]));
        if (pai) r.add(pai);
      }
      return r;
    };
    const versoesAgora = await pastasDeVersoes(agora);
    for (const id of await pastasDeVersoes(antes)) if (!versoesAgora.has(id) && !presas.has(id)) await this.lixeira(id);
    // pastas excluídas do cofre: lixeira do Drive (as mais fundas primeiro)
    const vivas = new Set(Object.values(pastasAgora).map((x) => x.drive));
    for (const [id, rec] of Object.entries(pastasAntes).sort((a, b) => b[1].caminho.length - a[1].caminho.length)) {
      if (pastasAgora[id] || vivas.has(rec.drive) || presas.has(rec.drive)) continue;
      await this.lixeira(rec.drive);
    }
    await this.enviar(new Blob([JSON.stringify(agora)], { type: "application/json" }), "visiveis.json", sis, idVis);
    await this.enviar(new Blob([JSON.stringify({ formato: 2, pastas: pastasAgora })], { type: "application/json" }), "pastas.json", sis, idPastas);
    this.estado = undefined;
  }
}

// ---------- login do Google (Google Identity Services) ----------

interface ClienteToken {
  requestAccessToken(o?: { prompt?: string }): void;
}
type Google = { accounts: { oauth2: { initTokenClient(o: { client_id: string; scope: string; callback: (r: { access_token?: string; expires_in?: number; error?: string }) => void; error_callback?: (e: { type?: string }) => void }): ClienteToken } } };
const CHAVE = "wjgoogle:acesso";

function lerAcesso(): { token: string; expira: number } | null {
  try {
    return JSON.parse(localStorage.getItem(CHAVE) ?? "null");
  } catch {
    return null;
  }
}
const autorizado = () => localStorage.getItem("wjgoogle:autorizado") === "1";

let script: Promise<Google> | null = null;
function carregarGoogle(): Promise<Google> {
  return (script ??= new Promise((ok, erro) => {
    const g = (window as unknown as { google?: Google }).google;
    if (g?.accounts) return ok(g);
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    s.onload = () => ok((window as unknown as { google: Google }).google);
    s.onerror = () => {
      script = null;
      erro(new Error("sem internet para falar com o Google"));
    };
    document.head.append(s);
  }));
}

/**
 * Um pedido por vez, que sempre termina (10/11/2026): enquanto um pedido está aberto, quem pedir de
 * novo recebe a mesma promessa; e ela termina com `valorNoPrazo` depois de `prazo` ms mesmo que a
 * resposta nunca chegue. Causa do GO-IN travado: a renovação do primeiro toque e o toque do GO-IN
 * pediam a janela do Google juntos, o Google respondia a um só e a sincronia esperava para sempre.
 */
export function pedidoUnico<T>(fazer: (terminar: (v: T) => void) => void, prazo: number, valorNoPrazo: T): () => Promise<T> {
  let aberto: Promise<T> | null = null;
  return () =>
    (aberto ??= new Promise<T>((ok) => {
      let feito = false;
      const terminar = (v: T) => {
        if (feito) return;
        feito = true;
        clearTimeout(relogio);
        aberto = null;
        ok(v);
      };
      const relogio = setTimeout(() => terminar(valorNoPrazo), prazo);
      try {
        fazer(terminar);
      } catch {
        terminar(valorNoPrazo);
      }
    }));
}

const PRAZO_GOOGLE = 120000; // a janela do Google nunca segura o app mais que isto
const ESPERA_AO_VOLTAR = 4000; // voltou para o app sem resposta: a janela foi fechada sem aviso

let consentirPedido = false;
const pedirUmaVez = pedidoUnico<boolean>((terminar) => {
  void carregarGoogle().then((g) => {
    // fechada sem o Google avisar (acontece no Android): ao voltar para o app, desiste em 4 s
    const aoVoltar = () => setTimeout(() => terminar(false), ESPERA_AO_VOLTAR);
    addEventListener("focus", aoVoltar, { once: true });
    const c = g.accounts.oauth2.initTokenClient({
      client_id: CLIENTE_GOOGLE,
      scope: ESCOPO,
      callback: (r) => {
        removeEventListener("focus", aoVoltar);
        if (!r.access_token) return terminar(false);
        localStorage.setItem(CHAVE, JSON.stringify({ token: r.access_token, expira: Date.now() + (r.expires_in ?? 3600) * 1000 }));
        localStorage.setItem("wjgoogle:autorizado", "1");
        terminar(true);
      },
      error_callback: () => terminar(false), // janela fechada ou bloqueada
    });
    c.requestAccessToken({ prompt: consentirPedido ? "consent" : "" });
  }, () => terminar(false));
}, PRAZO_GOOGLE, false);

/** Pede o acesso (janela do Google). `consentir`: mostra a tela de permissão (1ª vez). */
async function pedirAcesso(consentir: boolean): Promise<boolean> {
  consentirPedido = consentir;
  return pedirUmaVez();
}

const valido = () => {
  const a = lerAcesso();
  return !!a && a.expira - Date.now() > 120000;
};

/** Drive com o acesso atual (para pastas irmãs do cofre, como Meu Drive/WJTaskPlan). */
export const driveGoogle = () => new RepositorioDrive(() => lerAcesso()?.token ?? "");

export const nuvemGoogle: DestinoNuvem = {
  nome: "Google Drive",
  conectado: () => valido(),
  situacao() {
    if (valido()) return "Conectado: o cofre fica em Meu Drive/WJPDM.";
    if (autorizado()) return "Acesso vencido (o Google libera por 1 hora): toque em Sincronizar agora ou Reconectar.";
    return "Não conectado. Toque em Conectar e autorize com a sua conta Google (o app só vê as pastas que ele cria: WJPDM e WJTaskPlan).";
  },
  async conectar() {
    if (!(await pedirAcesso(!autorizado()))) throw new Error("O Google não liberou o acesso (janela fechada, bloqueada ou usuário fora da lista de teste).");
  },
  renovar: () => (valido() ? Promise.resolve(true) : autorizado() ? pedirAcesso(false).catch(() => false) : Promise.resolve(false)),
  vencendo: (ms) => autorizado() && (lerAcesso()?.expira ?? 0) - Date.now() < ms,
  renovarAgora: () => (autorizado() ? pedirAcesso(false).catch(() => false) : Promise.resolve(false)),
  preparar: () => {
    if (autorizado()) void carregarGoogle().catch(() => {});
  },
  repositorio: () => new RepositorioDrive(() => lerAcesso()?.token ?? ""),
};
