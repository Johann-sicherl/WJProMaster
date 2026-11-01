// Montagem STEP → montagem WJCAD (.wjasm). O kernel (src/kernel/importar.ts) separa os sólidos e
// as posições; aqui, só com o texto do arquivo, saem a árvore de produtos (NEXT_ASSEMBLY_USAGE_
// OCCURRENCE) e os nomes das peças. Puro: testado em scripts/teste-montagem.ts.

import { documentoImportado } from "../model";
import { inserirComponente, montagemVazia, novoIdM, type DocumentoMontagem, type Transformacao } from "./modelo";

/** Texto de uma string STEP: '' → ', \X2\hhhh…\X0\ (UTF-16), \X4\…\X0\, \X\hh (Latin-1), \S\c. */
export function textoStep(s: string): string {
  return s
    .replace(/''/g, "'")
    .replace(/\\X2\\([0-9A-F]+)\\X0\\/gi, (_, h: string) => String.fromCharCode(...(h.match(/.{4}/g) ?? []).map((x) => parseInt(x, 16))))
    .replace(/\\X4\\([0-9A-F]+)\\X0\\/gi, (_, h: string) => String.fromCodePoint(...(h.match(/.{8}/g) ?? []).map((x) => parseInt(x, 16))))
    .replace(/\\X\\([0-9A-F]{2})/gi, (_, h: string) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\S\\(.)/g, (_, c: string) => String.fromCharCode(c.charCodeAt(0) + 128))
    .trim();
}

/** Argumentos de primeiro nível de uma entidade simples (strings sem as aspas; listas como texto). */
function argumentos(corpo: string): string[] {
  const r: string[] = [];
  let atual = "", nivel = 0, aspas = false;
  for (let i = 0; i < corpo.length; i++) {
    const c = corpo[i];
    if (aspas) {
      if (c === "'" && corpo[i + 1] === "'") {
        atual += "''";
        i++;
      } else if (c === "'") aspas = false;
      else atual += c;
      continue;
    }
    if (c === "'") aspas = true;
    else if (c === "(") nivel++, (atual += c);
    else if (c === ")") nivel--, (atual += c);
    else if (c === "," && nivel === 0) r.push(atual.trim()), (atual = "");
    else atual += c;
  }
  r.push(atual.trim());
  return r;
}

/** Entidades simples do STEP: número → [tipo, argumentos]. Só as que interessam à árvore. */
function entidades(texto: string, tipos: Set<string>): Map<number, [string, string[]]> {
  const m = new Map<number, [string, string[]]>();
  const ini = texto.indexOf("DATA;");
  let i = ini < 0 ? 0 : ini + 5, comeco = i, aspas = false;
  for (; i < texto.length; i++) {
    const c = texto[i];
    if (c === "'") aspas = !aspas;
    else if (c === ";" && !aspas) {
      const e = texto.slice(comeco, i).trim();
      comeco = i + 1;
      const k = /^#(\d+)\s*=\s*([A-Z0-9_]+)\s*\(/.exec(e);
      if (k && tipos.has(k[2])) m.set(+k[1], [k[2], argumentos(e.slice(k[0].length, e.lastIndexOf(")")))]);
    }
  }
  return m;
}

export interface PecaDoStep {
  nome: string;
  /** instâncias na montagem inteira (subconjuntos multiplicam) */
  n: number;
}

/**
 * Peças (produtos sem filhos) na ordem em que aparecem percorrendo a árvore a partir da raiz,
 * filhos na ordem do arquivo, e quantas vezes cada uma entra. Sem árvore (STEP de peça): [].
 */
export function pecasDoStep(texto: string): PecaDoStep[] {
  const ent = entidades(texto, new Set(["PRODUCT", "PRODUCT_DEFINITION_FORMATION", "PRODUCT_DEFINITION_FORMATION_WITH_SPECIFIED_SOURCE", "PRODUCT_DEFINITION", "NEXT_ASSEMBLY_USAGE_OCCURRENCE"]));
  const ref = (a: string | undefined) => (a && /^#\d+$/.test(a) ? +a.slice(1) : -1);
  const nomeDe = (pd: number): string => {
    const form = ent.get(ref(ent.get(pd)?.[1][2]));
    const prod = ent.get(ref(form?.[1][2]));
    const [id, nome] = prod?.[1] ?? [];
    return textoStep(nome || id || "") || `Peça #${pd}`;
  };
  const filhos = new Map<number, number[]>();
  const ehFilho = new Set<number>();
  for (const [num, [tipo, a]] of [...ent].sort((x, y) => x[0] - y[0])) {
    if (tipo !== "NEXT_ASSEMBLY_USAGE_OCCURRENCE") continue;
    const pai = ref(a[3]), filho = ref(a[4]);
    if (pai < 0 || filho < 0) continue;
    (filhos.get(pai) ?? filhos.set(pai, []).get(pai)!).push(filho);
    ehFilho.add(filho);
    void num;
  }
  if (!filhos.size) return [];
  const raizes = [...filhos.keys()].filter((p) => !ehFilho.has(p));
  const pecas = new Map<number, PecaDoStep>();
  const visitar = (pd: number, mult: number, pilha: Set<number>) => {
    const fs = filhos.get(pd);
    if (!fs) {
      const p = pecas.get(pd) ?? pecas.set(pd, { nome: nomeDe(pd), n: 0 }).get(pd)!;
      p.n += mult;
      return;
    }
    if (pilha.has(pd)) return; // arquivo com ciclo: ignora
    pilha.add(pd);
    for (const f of fs) visitar(f, mult, pilha);
    pilha.delete(pd);
  };
  for (const r of raizes) visitar(r, 1, new Set());
  return [...pecas.values()];
}

/** Nome do produto raiz (o conjunto), se houver árvore. */
export function nomeDoConjunto(texto: string): string | null {
  const ent = entidades(texto, new Set(["PRODUCT", "PRODUCT_DEFINITION_FORMATION", "PRODUCT_DEFINITION_FORMATION_WITH_SPECIFIED_SOURCE", "PRODUCT_DEFINITION", "NEXT_ASSEMBLY_USAGE_OCCURRENCE"]));
  const ref = (a: string | undefined) => (a && /^#\d+$/.test(a) ? +a.slice(1) : -1);
  const pais = new Set<number>(), filhos = new Set<number>();
  for (const [tipo, a] of ent.values()) if (tipo === "NEXT_ASSEMBLY_USAGE_OCCURRENCE") pais.add(ref(a[3])), filhos.add(ref(a[4]));
  const raiz = [...pais].find((p) => !filhos.has(p));
  if (raiz === undefined) return null;
  const prod = ent.get(ref(ent.get(ref(ent.get(raiz)?.[1][2]))?.[1][2]));
  return prod ? textoStep(prod[1][1] || prod[1][0]) || null : null;
}

/** O que o kernel devolve (src/kernel/importar.ts), sem depender do kernel aqui. */
export interface LeituraStep {
  corpos: { step: Uint8Array; volume: number; n: number }[];
  instancias: { corpo: number; t: Transformacao }[];
}

/**
 * Nomes dos corpos: a ordem dos sólidos que o kernel encontra segue a árvore do arquivo; o nome
 * só é usado se a quantidade de instâncias de cada peça confere (senão, nomes genéricos, para
 * nunca dar o nome errado a uma peça).
 */
export function nomesDosCorpos(pecas: PecaDoStep[], corpos: { n: number }[]): string[] {
  const genericos = corpos.map((_, i) => `Peça${i + 1}`);
  if (pecas.length === corpos.length && pecas.every((p, i) => p.n === corpos[i].n)) return pecas.map((p) => p.nome);
  // ordem diferente: casa pela quantidade quando ela é única dos dois lados
  const porN = new Map<number, PecaDoStep[]>();
  for (const p of pecas) (porN.get(p.n) ?? porN.set(p.n, []).get(p.n)!).push(p);
  const nCorpos = new Map<number, number>();
  for (const c of corpos) nCorpos.set(c.n, (nCorpos.get(c.n) ?? 0) + 1);
  return corpos.map((c, i) => (porN.get(c.n)?.length === 1 && nCorpos.get(c.n) === 1 ? porN.get(c.n)![0].nome : genericos[i]));
}

/** Monta o .wjasm: uma peça embutida por corpo (com o corpo importado) e os componentes fixos no lugar. */
export function montagemDoStep(nomeArquivo: string, texto: string, leitura: LeituraStep): DocumentoMontagem {
  const base = nomeArquivo.replace(/\.[^.]+$/, "") || "Montagem";
  const d = montagemVazia(nomeDoConjunto(texto) ?? base);
  const nomes = nomesDosCorpos(pecasDoStep(texto), leitura.corpos);
  // nomes repetidos (peças diferentes com o mesmo nome no STEP) ganham sufixo
  const usados = new Map<string, number>();
  const ids = leitura.corpos.map((c, i) => {
    let nome = nomes[i].replace(/[\\/:*?"<>|]/g, "-");
    const k = usados.get(nome) ?? 0;
    usados.set(nome, k + 1);
    if (k) nome = `${nome} (${k + 1})`;
    const doc = documentoImportado(`${nome}.step`, c.step);
    const id = novoIdM();
    d.pecas.push({ id, nome, doc });
    return id;
  });
  for (const ins of leitura.instancias) {
    const comp = inserirComponente(d, ids[ins.corpo], ins.t);
    comp.t = ins.t; // o primeiro também fica onde o arquivo o pôs
    comp.fixo = true; // como veio do arquivo: o usuário flutua o que quiser posicionar
  }
  return d;
}
