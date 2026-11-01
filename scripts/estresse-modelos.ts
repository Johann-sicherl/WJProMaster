// Estresse (Node) das partes novas: solver da montagem com montagens aleatórias, padrões e
// explosão; projeção do desenho (câmeras, seções e montagens aleatórias); cotas e anotações com
// geometria aleatória; leitura de arquivos corrompidos; e a sincronia do cofre com operações
// aleatórias gravando de verdade numa pasta simulada (arquivos visíveis e pastas de versões).
//   pnpm estresse:modelos            (completo)
//   pnpm estresse:modelos rapido     (menos rodadas)
// Confere: nada estoura, nada sai NaN/infinito, mensagens de erro legíveis, tempos, e que o disco
// fica exatamente igual ao que o cofre manda (nem arquivo a mais, nem a menos).
import opencascade from "replicad-opencascadejs";
import { setOC } from "replicad";
import { createRequire } from "node:module";
import { documentoExemplo, type Referencia, type Vec3 } from "../src/model";
import { regenerar, pecaAtual } from "../src/kernel/regenerar";
import { posicionar, projetar } from "../src/kernel/projecao";
import {
  aplicarPadroes, embutirPeca, excluirComponentes, excluirPadrao, inserirComponente, montagemVazia, posesExplodidas, explosaoAutomatica, quantidades,
  quatDeEuler, validarMontagem, type DocumentoMontagem, type Posicionamento, type TipoPosicionamento,
} from "../src/montagem/modelo";
import { primitivaLocal, resolverMontagem, tiposPossiveis } from "../src/montagem/solver";
import { cameraProjetada, CAMERAS, layoutTresVistas, validarDesenho, type Camera, type Lado } from "../src/desenho/modelo";
import { desenhoCota, entidadeSob, medida, posicionarBaloes, reencontrar, type Cota, type EntCota } from "../src/desenho/anotacoes";
import { indiceVazio, sincronizar, visiveisDoIndice, vistaPublicada, caminhosDasPastas, type Indice, type Repositorio } from "../src/pdm/sincronia";
import { RepositorioPasta } from "../src/comum/repositorios";
import type { Arquivo, Pasta } from "../src/pdm/regras";

const rapido = process.argv.includes("rapido");
const require = createRequire(import.meta.url);
setOC(await (opencascade as unknown as (o: object) => Promise<unknown>)({ locateFile: () => require.resolve("replicad-opencascadejs/wasm") }) as never);

// gerador pseudoaleatório com semente (repetível: o achado pode ser reproduzido)
let semente = Number(process.env.SEMENTE ?? 20261029);
const rnd = () => ((semente = (semente * 1664525 + 1013904223) % 4294967296) / 4294967296);
const ri = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));
const pick = <T>(l: T[]) => l[Math.floor(rnd() * l.length)];

const achados: string[] = [];
const achar = (onde: string, msg: string) => {
  const l = `${onde}: ${msg}`.slice(0, 400);
  if (!achados.includes(l)) achados.push(l);
  console.log(`ACHADO ${l}`);
};
const finito = (x: unknown): boolean => (typeof x === "number" ? Number.isFinite(x) : Array.isArray(x) ? x.every(finito) : x && typeof x === "object" ? Object.values(x).every(finito) : true);
const legivel = (m: string) => !!m && !/undefined|TypeError|ReferenceError|\[object|NaN|Cannot read/.test(m);

// ---------- 1. montagem: solver com montagens aleatórias ----------
{
  const t0 = performance.now();
  const r = regenerar(documentoExemplo().features);
  const topo = r.topologia!;
  const refs: Referencia[] = [
    ...topo.faces.map((ass) => ({ tipo: "face" as const, ass })),
    ...topo.arestas.map((ass) => ({ tipo: "aresta" as const, ass })),
    ...topo.vertices.slice(0, 8).map((p) => ({ tipo: "vertice" as const, p })),
  ].filter((x) => primitivaLocal(x));
  const rodadas = rapido ? 40 : 160;
  let piorMs = 0, conflitos = 0, totalMates = 0;
  for (let k = 0; k < rodadas; k++) {
    const m = montagemVazia(`M${k}`);
    const p = embutirPeca(m, documentoExemplo(), {});
    const n = ri(2, rapido ? 12 : 30);
    for (let i = 0; i < n; i++) inserirComponente(m, p, { pos: [ri(-200, 200), ri(-200, 200), ri(-200, 200)], rot: quatDeEuler(ri(0, 359), ri(0, 359), ri(0, 359)) });
    const nm = ri(1, n * 2);
    for (let j = 0; j < nm; j++) {
      const a = pick(m.componentes), b = pick(m.componentes.filter((c) => c !== a));
      const ra = pick(refs), rb = pick(refs);
      const tipos = tiposPossiveis(primitivaLocal(ra)!, primitivaLocal(rb)!);
      if (!tipos.length) continue;
      const tipo: TipoPosicionamento = pick(tipos);
      const mate: Posicionamento = { id: `m${j}`, nome: `P${j}`, tipo, a: { comp: a.id, ref: ra }, b: { comp: b.id, ref: rb }, alinhamento: pick(["auto", "alinhado", "antialinhado"] as const), ...(tipo === "distancia" ? { valor: ri(0, 80) } : tipo === "angulo" ? { valor: ri(0, 180) } : {}), ...(rnd() < 0.1 ? { suprimido: true } : {}) };
      m.posicionamentos.push(mate);
    }
    totalMates += m.posicionamentos.length;
    const t = performance.now();
    try {
      const s = resolverMontagem(m, { escala: 80 });
      const ms = performance.now() - t;
      piorMs = Math.max(piorMs, ms);
      if (ms > 8000) achar("montagem/solver", `lento: ${Math.round(ms)} ms com ${n} componentes e ${m.posicionamentos.length} posicionamentos`);
      for (const [id, tr] of s.poses) {
        if (!finito(tr.pos) || !finito(tr.rot)) achar("montagem/solver", `pose não finita em ${id}`);
        const q = Math.hypot(...tr.rot);
        if (Math.abs(q - 1) > 1e-6) achar("montagem/solver", `quatérnio não unitário (${q})`);
      }
      if (!Number.isFinite(s.residuo)) achar("montagem/solver", "resíduo não finito");
      for (const msg of s.erros.values()) if (!legivel(msg)) achar("montagem/solver", `mensagem ilegível: ${msg}`);
      for (const g of s.graus.values()) if (!(g >= 0 && g <= 6)) achar("montagem/solver", `graus fora de 0..6: ${g}`);
      conflitos += s.erros.size;
      // aplicar e resolver de novo: o que já está resolvido não pode piorar
      for (const [id, tr] of s.poses) m.componentes.find((c) => c.id === id)!.t = tr;
      const s2 = resolverMontagem(m, { escala: 80 });
      if (s2.residuo > s.residuo + 1e-3 && s2.residuo > 1e-2) achar("montagem/solver", `piora ao resolver de novo (${s.residuo.toFixed(4)} → ${s2.residuo.toFixed(4)})`);
    } catch (e) {
      achar("montagem/solver", `estourou: ${(e as Error).message}`);
    }
    // padrões, explosão, exclusão, ida e volta do arquivo
    try {
      const sem = pick(m.componentes.filter((c) => !c.padrao));
      m.padroes!.push({ id: "pl", nome: "PL", tipo: "linear", sementes: [sem.id], dir: [rnd(), rnd(), rnd()], passo: ri(-50, 50), n: ri(1, 6), ...(rnd() < 0.5 ? { dir2: [0, 1, 0] as Vec3, passo2: ri(1, 30), n2: ri(1, 4) } : {}) });
      m.padroes!.push({ id: "pc", nome: "PC", tipo: "circular", sementes: [sem.id], ponto: [0, 0, 0], eixo: [rnd(), rnd() + 0.1, rnd()], n: ri(1, 8), angulo: pick([360, 90, -45, 0]) });
      m.padroes!.push({ id: "es", nome: "ES", tipo: "espelho", sementes: [sem.id], ponto: [ri(-10, 10), 0, 0], normal: [1, 0, 0] });
      aplicarPadroes(m);
      aplicarPadroes(m); // idempotente
      const inst = m.componentes.filter((c) => c.padrao);
      if (new Set(m.componentes.map((c) => c.id)).size !== m.componentes.length) achar("montagem/padrões", "ids repetidos");
      if (inst.some((c) => !finito(c.t))) achar("montagem/padrões", "instância com pose não finita");
      const qtd = quantidades(m).reduce((s, x) => s + x.qtd, 0);
      if (qtd !== m.componentes.filter((c) => !c.suprimido).length) achar("montagem/padrões", "quantidade da lista ≠ componentes");
      m.explosao = explosaoAutomatica(m, new Map(m.componentes.map((c) => [c.id, c.t.pos])), rnd() * 3);
      const ex = posesExplodidas(m);
      if ([...ex.values()].some((t) => !finito(t))) achar("montagem/explosão", "pose explodida não finita");
      if (rnd() < 0.5) excluirPadrao(m, "pc");
      excluirComponentes(m, [sem.id]);
      aplicarPadroes(m);
      if (m.componentes.some((c) => c.padrao && !m.padroes!.some((p) => p.id === c.padrao))) achar("montagem/padrões", "instância órfã depois de excluir a semente");
      const ida = validarMontagem(JSON.parse(JSON.stringify(m)));
      if (ida.componentes.length !== m.componentes.length) achar("montagem/arquivo", "ida e volta perdeu componentes");
      resolverMontagem(ida, { escala: 80 });
    } catch (e) {
      achar("montagem/padrões", `estourou: ${(e as Error).message}`);
    }
  }
  console.log(`montagem: ${rodadas} montagens, ${totalMates} posicionamentos, ${conflitos} conflitos marcados, pior solver ${Math.round(piorMs)} ms, ${Math.round((performance.now() - t0) / 1000)} s`);
}

// ---------- 2. desenho: projeções, seções e montagens aleatórias ----------
{
  const t0 = performance.now();
  regenerar(documentoExemplo().features);
  const peca = pecaAtual()!;
  const unit = (v: Vec3): Vec3 => { const n = Math.hypot(...v) || 1; return [v[0] / n, v[1] / n, v[2] / n]; };
  const camAleatoria = (): Camera => {
    const o = unit([rnd() - 0.5, rnd() - 0.5, rnd() - 0.5]);
    return { olho: o, direita: unit([rnd() - 0.5, rnd() - 0.5, rnd() - 0.5]) };
  };
  const rodadas = rapido ? 25 : 90;
  let pior = 0;
  for (let k = 0; k < rodadas; k++) {
    const cam = k < 7 ? CAMERAS[(Object.keys(CAMERAS) as (keyof typeof CAMERAS)[])[k]] : rnd() < 0.5 ? camAleatoria() : cameraProjetada(pick(Object.values(CAMERAS)), pick(["direita", "esquerda", "acima", "abaixo", "diagonal"] as Lado[]), pick([1, 3] as const));
    const n = ri(1, 4);
    const sols = Array.from({ length: n }, () => posicionar(peca, { pos: [ri(-150, 150), ri(-50, 50), ri(-150, 150)], rot: quatDeEuler(ri(0, 359), ri(0, 359), ri(0, 359)) }));
    const corte = rnd() < 0.4 ? { p: [ri(-60, 60), ri(0, 30), ri(-60, 60)] as Vec3, n: cam.olho } : undefined;
    const t = performance.now();
    try {
      const pr = projetar(sols, cam, pick([0.05, 0.2, 1, 5]), corte);
      pior = Math.max(pior, performance.now() - t);
      if (!finito(pr.caixa) || !finito(pr.visiveis) || !finito(pr.ocultas) || !finito(pr.circulos)) achar("desenho/projeção", `valores não finitos (câmera ${JSON.stringify(cam)})`);
      if (!pr.visiveis.length) achar("desenho/projeção", `vista vazia (câmera ${JSON.stringify(cam)}, corte ${!!corte})`);
      if (pr.caixa.x1 < pr.caixa.x0 || pr.caixa.y1 < pr.caixa.y0) achar("desenho/projeção", "caixa invertida");
      if (corte && pr.cortes) for (const c of pr.cortes) for (const l of c.lacos) if (l.length < 3) achar("desenho/seção", "laço de hachura com menos de 3 pontos");
      // cotas em entidades sorteadas da própria vista
      for (let j = 0; j < 6; j++) {
        const q: [number, number] = [pr.caixa.x0 + rnd() * (pr.caixa.x1 - pr.caixa.x0), pr.caixa.y0 + rnd() * (pr.caixa.y1 - pr.caixa.y0)];
        const e1 = entidadeSob(q, pr.visiveis, pr.circulos, 50, 50), e2 = rnd() < 0.5 ? entidadeSob([q[0] + 10, q[1] - 7], pr.visiveis, pr.circulos, 50, 50) : null;
        if (!e1) continue;
        const c: Cota = { id: "c", vista: "v", e1, ...(e2 ? { e2 } : {}), pos: [q[0] + ri(-40, 40), q[1] + ri(-40, 40)], modo: pick(["auto", "h", "v", "alinhada"] as const) };
        const m = medida(c);
        if (m && (!Number.isFinite(m.valor) || m.valor < 0)) achar("desenho/cota", `valor inválido ${m.valor} (${JSON.stringify(c).slice(0, 200)})`);
        const d = desenhoCota(c, pick([0.1, 1, 2, 10]));
        if (d && !finito(d)) achar("desenho/cota", `desenho da cota não finito (${JSON.stringify(c).slice(0, 200)})`);
        if (reencontrar(e1, pr.visiveis, pr.circulos, 1e-6) === null) achar("desenho/cota", `entidade da própria vista não reencontrada (${e1.tipo})`);
      }
    } catch (e) {
      const msg = (e as Error).message;
      if (!(corte && msg === "O plano de corte não passa pelo modelo.")) achar("desenho/projeção", `estourou: ${msg}`);
    } finally {
      for (const s of sols) s.delete();
    }
  }
  // o sólido guardado continua inteiro depois de tudo
  try {
    if (Math.round(projetar([peca], "frontal").caixa.x1) !== 40) achar("desenho/projeção", "o sólido guardado mudou");
  } catch (e) {
    achar("desenho/projeção", `sólido guardado apagado: ${(e as Error).message}`);
  }
  // cotas com entidades degeneradas
  const degen: EntCota[] = [{ tipo: "ponto", p: [0, 0] }, { tipo: "linha", a: [0, 0], b: [0, 0] }, { tipo: "circulo", c: [0, 0], r: 0 }, { tipo: "linha", a: [1, 1], b: [1, 1 + 1e-12] }];
  for (const e1 of degen) for (const e2 of [undefined, ...degen]) for (const modo of ["auto", "h", "v", "alinhada"] as const) {
    const c: Cota = { id: "c", vista: "v", e1, ...(e2 ? { e2 } : {}), pos: [0, 0], modo };
    try {
      const m = medida(c);
      if (m && !Number.isFinite(m.valor)) achar("desenho/cota", `degenerada dá ${m.valor}: ${JSON.stringify(c)}`);
      const d = desenhoCota(c, 1);
      if (d && !finito(d)) achar("desenho/cota", `degenerada desenha NaN: ${JSON.stringify(c)}`);
    } catch (e) {
      achar("desenho/cota", `degenerada estourou: ${(e as Error).message} ${JSON.stringify(c)}`);
    }
  }
  // layout e balões com caixas extremas
  for (let k = 0; k < 200; k++) {
    const caixa = () => { const x = ri(-500, 500), y = ri(-500, 500); return { x0: x, y0: y, x1: x + rnd() * pick([0, 1e-6, 10, 2000]), y1: y + rnd() * pick([0, 1e-6, 10, 2000]) }; };
    const L = layoutTresVistas({ frontal: caixa(), superior: caixa(), lateral: caixa() }, { x0: 25, y0: 51, x1: 413, y1: 290 }, pick([1, 3] as const));
    if (!finito(L)) achar("desenho/layout", "layout não finito");
    const b = posicionarBaloes(Array.from({ length: ri(0, 30) }, () => [ri(-100, 100), ri(-100, 100)] as [number, number]), caixa());
    if (!finito(b)) achar("desenho/balões", "posição não finita");
  }
  // arquivos corrompidos
  const lixo = [null, 1, "x", [], {}, { formato: "wjdrw" }, { formato: "wjdrw", folhas: [null, 1, { vistas: [null, { modelo: "?" }] }] }, { formato: "wjdrw", folhas: [{ formato: "Z9", escala: -1, vistas: "x", cotas: 5, baloes: [null], tabelas: [{ modelo: 3 }] }], modelos: [{ id: "a", tipo: "peca" }] }];
  for (const l of lixo) {
    try {
      const d = validarDesenho(l);
      if (!d.folhas.length) achar("desenho/arquivo", "desenho sem folha");
    } catch (e) {
      if (!legivel((e as Error).message) || (e as Error) instanceof TypeError) achar("desenho/arquivo", `erro ilegível para ${JSON.stringify(l)}: ${(e as Error).message}`);
    }
    try {
      validarMontagem(l);
    } catch (e) {
      if (!legivel((e as Error).message) || (e as Error) instanceof TypeError) achar("montagem/arquivo", `erro ilegível para ${JSON.stringify(l)}: ${(e as Error).message}`);
    }
  }
  console.log(`desenho: ${rodadas} projeções aleatórias, pior ${Math.round(pior)} ms, ${Math.round((performance.now() - t0) / 1000)} s`);
}

// ---------- 3. cofre: operações aleatórias, sincronia e o disco de verdade ----------
{
  const t0 = performance.now();
  // pasta de disco simulada (File System Access) em memória
  class ErroFS extends Error { constructor(public name: string, m: string) { super(m); } }
  class Arq { kind = "file" as const; dados = ""; constructor(public name: string) {} async getFile() { const d = this.dados; return { text: async () => d, size: d.length } as unknown as File; } async createWritable() { let buf = ""; return { write: async (x: Blob | string) => { buf += typeof x === "string" ? x : await x.text(); }, close: async () => { this.dados = buf; } }; } }
  class Dir {
    kind = "directory" as const;
    filhos = new Map<string, Dir | Arq>();
    constructor(public name: string) {}
    async getDirectoryHandle(n: string, o: { create?: boolean } = {}) {
      const x = this.filhos.get(n);
      if (x instanceof Dir) return x;
      if (x) throw new ErroFS("TypeMismatchError", "é arquivo");
      if (!o.create) throw new ErroFS("NotFoundError", n);
      const d = new Dir(n);
      this.filhos.set(n, d);
      return d;
    }
    async getFileHandle(n: string, o: { create?: boolean } = {}) {
      const x = this.filhos.get(n);
      if (x instanceof Arq) return x;
      if (x) throw new ErroFS("TypeMismatchError", "é pasta");
      if (!o.create) throw new ErroFS("NotFoundError", n);
      const a = new Arq(n);
      this.filhos.set(n, a);
      return a;
    }
    async removeEntry(n: string, o: { recursive?: boolean } = {}) {
      const x = this.filhos.get(n);
      if (!x) throw new ErroFS("NotFoundError", n);
      if (x instanceof Dir && x.filhos.size && !o.recursive) throw new ErroFS("InvalidModificationError", "pasta não vazia");
      this.filhos.delete(n);
    }
    async *keys() { yield* this.filhos.keys(); }
    lista(pre = ""): string[] {
      return [...this.filhos.values()].flatMap((x) => x instanceof Dir ? (x.name === ".wjpdm" ? [] : [`${pre}${x.name}/`, ...x.lista(`${pre}${x.name}/`)]) : [`${pre}${x.name}`]);
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
  const esperado = (i: Indice) => {
    const s = new Set<string>();
    for (const c of caminhosDasPastas(i)) for (let k = 1; k <= c.length; k++) s.add(`${c.slice(0, k).join("/")}/`);
    for (const v of visiveisDoIndice(i)) {
      for (let k = 1; k < v.caminho.length; k++) s.add(`${v.caminho.slice(0, k).join("/")}/`);
      s.add(v.caminho.join("/"));
    }
    return s;
  };
  const rodadas = rapido ? 6 : 20, passos = rapido ? 40 : 90;
  let ops = 0;
  for (let r = 0; r < rodadas; r++) {
    const mem = new Memoria("aparelho");
    const raizTab = new Dir("TAB"), raizPen = new Dir("PEN");
    const tab = new RepositorioPasta("pasta do dispositivo", raizTab as never), pen = new RepositorioPasta("pendrive", raizPen as never, true);
    let i = indiceVazio();
    let relogio = Date.UTC(2026, 9, 1);
    const t = () => new Date((relogio += 60000)).toISOString();
    let nb = 0;
    const blob = (txt: string) => { const id = `b${r}-${nb++}`; mem.blobs.set(id, txt); return id; };
    const nomes = ["Suporte", "Eixo", "Placa base", "Peça ç", "Tampa", "Conjunto", "Bucha", "Eixo"];
    for (let k = 0; k < passos; k++) {
      ops++;
      const vivas = i.pastas.filter((p) => !(p as Pasta & { lixeira?: boolean }).lixeira);
      const arqs = i.arquivos.filter((a) => !a.lixeira);
      const op = pick(["arquivo", "arquivo", "versao", "versao", "trabalho", "renomear", "mover", "excluir", "pasta", "renomearPasta", "excluirPasta", "golocal"]);
      const agora = t();
      try {
        if (op === "pasta" || !vivas.length) {
          const pai = vivas.length && rnd() < 0.5 ? pick(vivas).id : null;
          const nome = pick(["CAD", "Projetos", "Clientes", "Ação", "Sub"]);
          if (!i.pastas.some((p) => p.pai === pai && p.nome === nome)) i.pastas.push({ id: `p${r}-${k}`, nome, pai, mod: agora } as Pasta);
        } else if (op === "arquivo" || !arqs.length) {
          const pasta = pick(vivas).id;
          let nome = `${pick(nomes)}.${pick(["wjcad", "wjasm", "wjdrw"])}`;
          if (i.arquivos.some((a) => a.pasta === pasta && a.nome === nome && !a.lixeira)) nome = `${nome.replace(/\./, ` ${k}.`)}`;
          const so = rnd() < 0.2;
          i.arquivos.push({ id: `a${r}-${k}`, nome, pasta, revisao: "", estado: "dev", cartao: {}, historico: [], mod: agora, ...(so ? { soLocal: true } : {}), versoes: [{ n: 1, blob: blob(`${nome} v1`), tamanho: 1, autor: "J", data: agora, comentario: "", revisao: "", estado: "dev" }] } as Arquivo);
        } else {
          const a = pick(arqs);
          if (op === "versao") {
            a.versoes.push({ n: a.versoes.length + 1, blob: a.trabalho?.blob ?? blob(`${a.nome} v${a.versoes.length + 1}`), tamanho: 1, autor: "J", data: agora, comentario: "", revisao: rnd() < 0.3 ? pick(["A", "B", "01"]) : "", estado: "dev" });
            delete a.trabalho;
            delete a.soLocal;
          } else if (op === "trabalho") a.trabalho = { blob: blob(`${a.nome} trabalho ${k}`), tamanho: 1, data: agora, autor: "J" };
          else if (op === "renomear") {
            const novo = `${pick(nomes)} ${k}.${a.nome.split(".").pop()}`;
            if (!i.arquivos.some((x) => x.pasta === a.pasta && x.nome === novo && !x.lixeira)) a.nome = novo;
          } else if (op === "mover") {
            const p = pick(vivas).id;
            if (!i.arquivos.some((x) => x.pasta === p && x.nome === a.nome && !x.lixeira)) a.pasta = p;
          } else if (op === "excluir") Object.assign(a, { lixeira: true, lixeiraData: agora });
          else if (op === "renomearPasta") {
            const p = pick(vivas);
            const novo = `${p.nome} ${k}`;
            if (!i.pastas.some((x) => x.pai === p.pai && x.nome === novo)) p.nome = novo;
            p.mod = agora;
          } else if (op === "excluirPasta") {
            const p = pick(vivas);
            const ids = new Set<string>([p.id]);
            for (let mudou = true; mudou;) { mudou = false; for (const x of i.pastas) if (x.pai && ids.has(x.pai) && !ids.has(x.id)) (ids.add(x.id), (mudou = true)); }
            for (const a2 of i.arquivos) if (ids.has(a2.pasta)) Object.assign(a2, { lixeira: true, lixeiraData: agora, pasta: "raiz" });
            i.pastas = i.pastas.filter((x) => !ids.has(x.id));
            for (const id of ids) i.exclusoes.push({ id, tipo: "pasta", data: agora } as never);
          } else if (op === "golocal") a.soLocal = undefined;
          a.mod = agora;
        }
        await mem.gravarIndice(i);
        const res = await sincronizar([mem, tab, pen], agora);
        if (res.falhas.length) achar("cofre/sincronia", `falha: ${JSON.stringify(res.falhas)} (op ${op})`);
        if (res.faltando.length) achar("cofre/sincronia", `blobs faltando: ${res.faltando.length} (op ${op})`);
        i = (await mem.lerIndice())!;
        // o disco tem exatamente o que o cofre manda
        for (const [nome, raiz, vis] of [["dispositivo", raizTab, i], ["pendrive", raizPen, vistaPublicada(i)]] as const) {
          const wj = raiz.filhos.get("WJPDM") as Dir | undefined;
          const tem = new Set(wj ? wj.lista() : []);
          const quer = esperado(vis);
          const sobra = [...tem].filter((x) => !quer.has(x)), falta = [...quer].filter((x) => !tem.has(x));
          if (sobra.length || falta.length) {
            achar(`cofre/disco ${nome}`, `depois de "${op}": sobra ${JSON.stringify(sobra.slice(0, 4))} falta ${JSON.stringify(falta.slice(0, 4))}`);
            break;
          }
          // conteúdo do arquivo atual e de cada versão
          for (const v of visiveisDoIndice(vis)) {
            let d: Dir = wj!;
            for (const n of v.caminho.slice(0, -1)) d = d.filhos.get(n) as Dir;
            const f = d?.filhos.get(v.caminho[v.caminho.length - 1]) as Arq | undefined;
            if (f?.dados !== mem.blobs.get(v.blob)) {
              achar(`cofre/disco ${nome}`, `conteúdo errado em ${v.caminho.join("/")} depois de "${op}"`);
              break;
            }
          }
        }
      } catch (e) {
        achar("cofre/sincronia", `estourou em "${op}": ${(e as Error).stack?.split("\n").slice(0, 3).join(" | ")}`);
      }
    }
  }
  console.log(`cofre: ${ops} operações com sincronia e conferência do disco, ${Math.round((performance.now() - t0) / 1000)} s`);
}

console.log(achados.length ? `\nestresse dos modelos: ${achados.length} achado(s)\n${achados.map((a) => `- ${a}`).join("\n")}` : "\nestresse dos modelos: nenhum achado");
if (achados.length) process.exit(1);
