// Mudanças feitas FORA do app no espelho legível do cofre (Meu Drive/WJPDM, pendrive, pasta do
// dispositivo).
//
// Decisão do Johann (12/11/2026, substitui a janela de escolhas do #122): "o que eu fizer à mão no
// Drive é o modelo atual do cofre". A cada sincronia, o que ele mudou à mão nos arquivos e pastas que
// o app criou é APLICADO SOZINHO no índice do cofre, sem perguntar, e a sincronia avisa no fim:
// - renomear/mover → Renomear/Mover no cofre, com histórico ("Movido no Drive de X para Y");
// - excluir → lixeira do cofre (30 dias, versões preservadas), nunca destruído;
// - exceções, desfeitas na cópia com o motivo: arquivo em GO-OUT (com qualquer pessoa), arquivo em
//   estado protegido ("não excluir") não sai do cofre, renomear arquivo travado;
// - arquivo/pasta posto numa pasta criada à mão no Drive (o escopo drive.file não mostra o nome dela):
//   fica onde estava no cofre, com o aviso "crie a pasta pelo WJPDM";
// - conteúdo editado fora do app: ignorado (a cópia do cofre manda e é regravada), com aviso;
// - mudou no app e fora ao mesmo tempo: a mais recente vence; a outra vai para a lixeira do cofre;
// - pasta excluída só sai do cofre vazia (o que ficou nela a mantém): nenhum arquivo fica sem pasta.
//
// Cada cópia diz onde está de fato cada arquivo e cada pasta que o app gravou (Drive: pelo id;
// pendrive e pasta do dispositivo: pelo caminho e, se sumiu, pelo conteúdo). Aqui se compara o
// GRAVADO (o que o app escreveu da última vez), o VISTO (onde está agora) e o do COFRE. Pasta
// renomeada/movida leva junto o que está dentro (uma mudança só). Tudo puro e testável em Node
// (scripts/teste-sincronia.ts, scripts/teste-drive.ts).

import { estadoDe, extensao, nomeLivre, type Arquivo, type Pasta } from "./regras";
import { caminhoDoArquivo, type Indice } from "./sincronia";

const RAIZ = "raiz";

/** Um arquivo ou pasta que o app gravou na cópia, e onde está agora. */
export interface ItemVisto {
  /** id do arquivo ou da pasta no cofre */
  id: string;
  /** caminho que o app gravou da última vez (a partir de WJPDM/) */
  gravado: string[];
  /**
   * Onde está agora. null = numa pasta que o app não enxerga (Drive com drive.file: pasta criada à
   * mão); undefined = não achado (excluído à mão; no pendrive, pasta a descobrir pelos arquivos de dentro).
   */
  visto: string[] | null | undefined;
  /** quando a mudança foi feita, se a cópia souber (o Drive informa a data ao renomear e ao excluir) */
  quando?: string;
  /**
   * Pasta do cofre onde o app o pôs da última vez (arquivo: id da pasta ou "raiz"; pasta: id da mãe
   * ou null). Com ela, "o app também mudou" olha só o próprio item (renomear a pasta-mãe não conta).
   * Ausente em registros de antes de 12/11/2026: compara o caminho.
   */
  pai?: string | null;
}

/** O que uma cópia viu no espelho (todas as pastas e arquivos que o app gravou nela). */
export interface EspelhoVisto {
  copia: string;
  arquivos: ItemVisto[];
  pastas: ItemVisto[];
  /** arquivos visíveis com o conteúdo mudado fora do app (chave: id, ou `${id}#v${n}` da versão) */
  editados?: string[];
  /** o que a cópia pôs de volta na estrutura dela (WJPDM ou .wjpdm renomeada à mão), com o motivo */
  estrutura?: string[];
}

/** Uma mudança feita fora do app (de → para). */
export interface MudancaFora {
  /** estável entre sincronias (cópia, tipo, alvo e para onde foi) */
  id: string;
  copia: string;
  tipo: "arquivo" | "pasta";
  /** id do arquivo ou da pasta no cofre */
  alvo: string;
  /** nome no cofre */
  nome: string;
  /** caminho no cofre */
  de: string[];
  /** caminho no espelho; null = pasta criada fora do app (o Google não mostra o nome dela) ou excluído */
  para: string[] | null;
  quando: string;
}

/**
 * O que a sincronia fez com uma mudança feita fora do app (lista do "Ver detalhes"):
 * movido/renomeado/lixeira = aplicado no cofre; desfeito = a cópia volta ao cofre (motivo); fora =
 * numa pasta criada à mão (fica onde estava no cofre); mantida = pasta excluída que ainda tem
 * arquivos; editado = conteúdo mudado fora do app (regravado); conflito = mudou no app e fora.
 */
export type AcaoFora = "movido" | "renomeado" | "lixeira" | "desfeito" | "fora" | "mantida" | "editado" | "conflito";
export interface RelatoFora extends MudancaFora {
  acao: AcaoFora;
  /** por que foi desfeito, mantido ou o que venceu o conflito */
  motivo?: string;
}

/** O que a cópia faz com o espelho nesta sincronia. */
export interface DecisaoEspelho {
  /** fica onde está (numa pasta criada à mão no Drive): a cópia não mexe (arquivo: id; pasta: "pasta:<id>") */
  manter: Set<string>;
  /** o que só acompanha uma pasta mantida (a pasta local não tem id) */
  presos: Set<string>;
  /** pastas mantidas: caminho no cofre → caminho no espelho (o novo vai para lá) */
  trocas: [string[], string[]][];
  /** onde cada item que saiu do lugar gravado está agora (arquivo: id; pasta: "pasta:<id>") */
  onde: Map<string, string[]>;
  /** arquivos visíveis editados fora do app: a cópia regrava o conteúdo do cofre (chaves de EspelhoVisto.editados) */
  regravar: Set<string>;
}

export interface AnaliseEspelho extends DecisaoEspelho {
  /** o índice com as mudanças aplicadas */
  indice: Indice;
  relatos: RelatoFora[];
  conflitos: string[];
}

export const decisaoVazia = (): DecisaoEspelho => ({ manter: new Set(), presos: new Set(), trocas: [], onde: new Map(), regravar: new Set() });

const igual = (a?: string[] | null, b?: string[] | null) => a === b || (!!a && !!b && a.length === b.length && a.every((x, k) => x === b[k]));
const comeca = (c: string[], p: string[]) => p.length <= c.length && p.every((x, k) => x === c[k]);
const dir = (c: string[]) => c.slice(0, -1);
const tempo = (s?: string) => {
  const t = s ? Date.parse(s) : NaN;
  return Number.isFinite(t) ? t : 0;
};

/** "no Drive", "no pendrive", "na pasta do dispositivo" (texto do histórico e dos avisos). */
export const ondeNaCopia = (copia: string) => (copia === "Google Drive" ? "no Drive" : copia === "pendrive" ? "no pendrive" : `na ${copia}`);

/** Caminho legível de uma pasta do cofre (nomes das pastas desde a raiz). */
export const caminhoDaPasta = (i: Indice, id: string) => caminhoDoArquivo(i, { pasta: id, nome: "" } as Arquivo).slice(0, -1);

/** Troca o começo do caminho pela pasta renomeada/movida que servir (a mais funda). */
export function aplicarTrocas(c: string[], trocas: [string[], string[]][]): string[] {
  let melhor: [string[], string[]] | undefined;
  for (const t of trocas) if (comeca(c, t[0]) && (!melhor || t[0].length > melhor[0].length)) melhor = t;
  return melhor ? [...melhor[1], ...c.slice(melhor[0].length)] : c;
}

/**
 * Pastas que sumiram do lugar gravado (pendrive e pasta do dispositivo não têm id de pasta):
 * renomeada/movida para a pasta que não é do app onde está a maior parte do que estava dentro
 * (o que foi para outra pasta do app é arquivo movido, não a pasta). Sem nada achado: excluída.
 */
function inferirPastas(e: EspelhoVisto): Map<string, string[] | null | undefined> {
  const vistas = new Map(e.pastas.map((p) => [p.id, p.visto]));
  const doApp = e.pastas.filter((p) => p.visto !== undefined && igual(p.visto, p.gravado)).map((p) => p.gravado);
  for (let mudou = true; mudou; ) {
    mudou = false;
    for (const p of e.pastas) {
      if (vistas.get(p.id) !== undefined) continue;
      const votos = new Map<string, number>();
      const votar = (d: string[]) => {
        if (d.length && !igual(d, p.gravado) && !doApp.some((x) => igual(x, d))) votos.set(JSON.stringify(d), (votos.get(JSON.stringify(d)) ?? 0) + 1);
      };
      for (const a of e.arquivos) if (a.visto && igual(dir(a.gravado), p.gravado)) votar(dir(a.visto));
      for (const s of e.pastas) {
        const v = vistas.get(s.id);
        if (v && igual(dir(s.gravado), p.gravado) && v[v.length - 1] === s.gravado[s.gravado.length - 1]) votar(dir(v));
      }
      const [primeiro, segundo] = [...votos.entries()].sort((a, b) => b[1] - a[1]);
      if (!primeiro || (segundo && segundo[1] === primeiro[1])) continue; // nada achado, ou empate
      vistas.set(p.id, JSON.parse(primeiro[0]) as string[]);
      mudou = true;
    }
  }
  return vistas;
}

/** Cópia de um arquivo na lixeira do cofre (o lado que perdeu um conflito), com id fixo. */
function copiaNaLixeira(a: Arquivo, nome: string, pasta: string, dia: string, agora: string, sufixo: string, texto: string): Arquivo {
  const ext = extensao(nome);
  const base = ext ? nome.slice(0, -(ext.length + 1)) : nome;
  return {
    ...(JSON.parse(JSON.stringify(a)) as Arquivo),
    id: `${a.id}~${sufixo}`,
    nome: `${base} (conflito ${dia})${ext ? `.${ext}` : ""}`,
    pasta,
    checkout: undefined,
    lixeira: true,
    lixeiraData: agora,
    mod: agora,
    historico: [...a.historico, { data: agora, usuario: "WJPDM", texto }],
  };
}

/** Caminho de cada pasta do cofre como aparece no espelho (com as renomeações à espera). */
function caminhosNoEspelho(i: Indice, pendentes: MudancaFora[]): Map<string, string[]> {
  const trocas: [string[], string[]][] = [];
  for (const m of pendentes) if (m.tipo === "pasta" && m.para) trocas.push([caminhoDaPasta(i, m.alvo), m.para]);
  return new Map(i.pastas.map((p) => [p.id, aplicarTrocas(caminhoDaPasta(i, p.id), trocas)]));
}

/** Pasta do cofre que está em `c` no espelho (null = raiz; undefined = nenhuma). */
function pastaEm(i: Indice, c: string[], pendentes: MudancaFora[], fora = new Set<string>()): string | null | undefined {
  if (!c.length) return null;
  const mp = caminhosNoEspelho(i, pendentes);
  return i.pastas.find((p) => !fora.has(p.id) && igual(mp.get(p.id), c))?.id;
}

function descendentes(i: Indice, id: string): Set<string> {
  const r = new Set([id]);
  for (let mudou = true; mudou; ) {
    mudou = false;
    for (const p of i.pastas) if (p.pai && r.has(p.pai) && !r.has(p.id)) r.add(p.id), (mudou = true);
  }
  return r;
}

export interface Trazido {
  indice: Indice;
  /** pastas novas ou alteradas */
  pastas: Pasta[];
  /** arquivos alterados */
  arquivos: Arquivo[];
}

/**
 * A mudança feita fora do app vira Mover/Renomear no cofre, com histórico ("Movido no Drive de X
 * para Y"). `destino`: pasta do cofre escolhida quando o arquivo foi para uma pasta que o app não
 * enxerga. Pastas criadas à mão no pendrive ou na pasta do dispositivo (o nome é visível) entram no
 * cofre quando um arquivo do cofre é posto nelas.
 */
export function trazerParaOCofre(i: Indice, m: MudancaFora, pendentes: MudancaFora[], agora: string, usuario: string, novoId: () => string, destino?: string, extra = ""): Trazido | { erro: string } {
  const onde = ondeNaCopia(m.copia);
  const novo: Indice = { ...i, pastas: [...i.pastas], arquivos: [...i.arquivos] };
  const pastas: Pasta[] = [];
  const outras = pendentes.filter((x) => x.id !== m.id);
  const proprias = m.tipo === "pasta" ? descendentes(novo, m.alvo) : new Set<string>();
  let pai: string | null;
  if (destino !== undefined) pai = destino === RAIZ ? null : destino;
  else {
    if (!m.para) return { erro: `${m.nome} foi para uma pasta criada fora do app: o Google não mostra o nome dela ao app. Crie a pasta pelo WJPDM.` };
    // a pasta-mãe no espelho; o que faltar (pasta criada à mão no pendrive) entra no cofre
    const alvo = dir(m.para);
    let k = alvo.length;
    let achada: string | null | undefined;
    for (; k >= 0; k--) if ((achada = pastaEm(novo, alvo.slice(0, k), outras, proprias)) !== undefined) break;
    pai = achada ?? null;
    for (const nome of alvo.slice(k)) {
      const p: Pasta = { id: novoId(), nome, pai, mod: agora };
      novo.pastas.push(p);
      pastas.push(p);
      pai = p.id;
    }
  }
  const destinoTexto = (id: string | null) => (id ? caminhoDaPasta(novo, id).join("/") : "a raiz do cofre");
  if (m.tipo === "arquivo") {
    const k = novo.arquivos.findIndex((a) => a.id === m.alvo && !a.lixeira);
    if (k < 0) return { erro: `${m.nome} não está mais no cofre.` };
    const a0 = novo.arquivos[k];
    if (a0.checkout && a0.checkout.usuario !== usuario) return { erro: `${a0.nome} está em GO-OUT com ${a0.checkout.usuario}.` };
    const nomeNovo = m.para ? m.para[m.para.length - 1] : a0.nome;
    if (nomeNovo !== a0.nome && estadoDe(a0.estado).bloqueado) return { erro: `${a0.nome} está "${estadoDe(a0.estado).nome}": não pode ser renomeado.` };
    const pasta = pai ?? RAIZ;
    const nome = nomeLivre(nomeNovo, novo.arquivos.filter((x) => x !== a0 && x.pasta === pasta && !x.lixeira).map((x) => x.nome));
    const texto = !m.para
      ? `Movido ${onde} de ${m.de.join("/")} para uma pasta criada fora do app; levado para ${destinoTexto(pai)}`
      : igual(dir(m.para), dir(m.de))
        ? `Renomeado ${onde} de ${m.de[m.de.length - 1]} para ${m.para[m.para.length - 1]}`
        : `Movido ${onde} de ${m.de.join("/")} para ${m.para.join("/")}`;
    const a: Arquivo = { ...a0, nome, pasta, mod: agora, historico: [...a0.historico, { data: agora, usuario, texto: texto + extra }] };
    novo.arquivos[k] = a;
    return { indice: novo, pastas, arquivos: [a] };
  }
  const k = novo.pastas.findIndex((p) => p.id === m.alvo);
  if (k < 0) return { erro: `A pasta ${m.nome} não está mais no cofre.` };
  if (pai && proprias.has(pai)) return { erro: `A pasta ${m.nome} não pode ficar dentro dela mesma.` };
  const nomeNovo = m.para ? m.para[m.para.length - 1] : novo.pastas[k].nome;
  const irmas = new Set(novo.pastas.filter((p) => p.id !== m.alvo && (p.pai ?? null) === pai).map((p) => p.nome.toLowerCase()));
  let nome = nomeNovo;
  for (let n = 2; irmas.has(nome.toLowerCase()); n++) nome = `${nomeNovo} (${n})`;
  const p: Pasta = { ...novo.pastas[k], nome, pai, mod: agora };
  novo.pastas[k] = p;
  return { indice: novo, pastas: [...pastas, p], arquivos: [] };
}

export interface OpcoesEspelho {
  /** quem aparece no histórico das mudanças aplicadas */
  usuario?: string;
  novoId?: () => string;
}

/** Textos curtos do aviso: "2 movidos, 1 renomeado, 3 para a lixeira…". */
export function resumoFora(relatos: RelatoFora[]): string {
  const n = (a: AcaoFora) => relatos.filter((r) => r.acao === a).length;
  const partes = [
    [n("movido"), "movido", "movidos"],
    [n("renomeado"), "renomeado", "renomeados"],
    [n("lixeira"), "para a lixeira", "para a lixeira"],
    [n("desfeito"), "desfeito (ver motivo)", "desfeitos (ver motivo)"],
    [n("fora"), "numa pasta criada à mão (crie a pasta pelo WJPDM)", "em pastas criadas à mão (crie a pasta pelo WJPDM)"],
    [n("mantida"), "pasta mantida (ainda tem arquivos)", "pastas mantidas (ainda têm arquivos)"],
    [n("editado"), "editado fora do app (vale a cópia do cofre)", "editados fora do app (vale a cópia do cofre)"],
    [n("conflito"), "conflito (a mais recente venceu)", "conflitos (a mais recente venceu)"],
  ] as const;
  return partes.filter(([q]) => q).map(([q, um, varios]) => `${q} ${q === 1 ? um : varios}`).join(", ");
}

/**
 * Compara o que a cópia viu com o cofre e APLICA no índice o que o Johann mudou à mão (mover,
 * renomear, excluir), com as exceções desfeitas na cópia. Devolve o índice novo, o relato de cada
 * mudança e o que a cópia deve fazer com o espelho.
 */
export function analisarEspelho(i0: Indice, e: EspelhoVisto, agora: string, o: OpcoesEspelho = {}): AnaliseEspelho {
  let i = i0;
  const usuario = o.usuario ?? "WJPDM";
  const novoId = o.novoId ?? (() => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4));
  const onde_ = ondeNaCopia(e.copia);
  const vistasPastas = inferirPastas(e);
  const onde = new Map<string, string[]>();
  // 1. mudanças próprias (as que só acompanham uma pasta renomeada/movida não contam) e exclusões
  type Propria = { tipo: "arquivo" | "pasta"; it: ItemVisto; visto: string[] | null };
  const proprias: Propria[] = [];
  const apagadas: { tipo: "arquivo" | "pasta"; it: ItemVisto }[] = [];
  const mapa: { de: string[]; para: string[] | null; k: number }[] = [];
  const implicitas: { chave: string; k: number }[] = [];
  const aplicar = (c: string[], sem = -1) => {
    let melhor: (typeof mapa)[number] | undefined;
    for (const x of mapa) if (x.k !== sem && comeca(c, x.de) && (!melhor || x.de.length > melhor.de.length)) melhor = x;
    return melhor ? { novo: melhor.para && [...melhor.para, ...c.slice(melhor.de.length)], k: melhor.k } : { novo: c, k: -1 };
  };
  for (const p of [...e.pastas].sort((a, b) => a.gravado.length - b.gravado.length)) {
    const v = vistasPastas.get(p.id);
    if (v === undefined) {
      apagadas.push({ tipo: "pasta", it: p });
      continue;
    }
    const chave = `pasta:${p.id}`;
    if (v && !igual(v, p.gravado)) onde.set(chave, v);
    const t = aplicar(p.gravado);
    if (igual(t.novo, v)) {
      if (t.k >= 0) implicitas.push({ chave, k: t.k });
      continue;
    }
    proprias.push({ tipo: "pasta", it: p, visto: v });
    mapa.push({ de: p.gravado, para: v, k: proprias.length - 1 });
  }
  for (const a of e.arquivos) {
    if (a.visto === undefined) {
      apagadas.push({ tipo: "arquivo", it: a });
      continue;
    }
    if (a.visto && !igual(a.visto, a.gravado)) onde.set(a.id, a.visto);
    const t = aplicar(a.gravado);
    if (igual(t.novo, a.visto)) {
      if (t.k >= 0) implicitas.push({ chave: a.id, k: t.k });
      continue;
    }
    proprias.push({ tipo: "arquivo", it: a, visto: a.visto });
  }
  // 2. renomear/mover: aplicado no cofre (pastas primeiro, das mais rasas)
  const relatos: RelatoFora[] = [], conflitos: string[] = [];
  const mantida: boolean[] = [];
  const manter = new Set<string>(), presos = new Set<string>();
  const relatar = (m: MudancaFora, acao: AcaoFora, motivo?: string) => relatos.push({ ...m, id: `${m.id}|${acao}`, acao, ...(motivo ? { motivo } : {}) });
  const dia = (s: string) => s.slice(0, 10) || "sem data";
  for (const [k, { tipo, it, visto }] of proprias.entries()) {
    const reg = tipo === "pasta" ? i.pastas.find((p) => p.id === it.id) : i.arquivos.find((a) => a.id === it.id && !a.lixeira);
    if (!reg) continue;
    const noCofre = tipo === "pasta" ? caminhoDaPasta(i, it.id) : caminhoDoArquivo(i, reg as Arquivo);
    if (igual(noCofre, visto)) continue; // o app fez a mesma mudança
    const m: MudancaFora = { id: `${e.copia}|${tipo}|${it.id}|${visto ? visto.join("/") : "?"}`, copia: e.copia, tipo, alvo: it.id, nome: reg.nome, de: noCofre, para: visto, quando: it.quando ?? agora };
    if (!visto) {
      // numa pasta criada à mão no Drive: o app não sabe o nome dela; fica onde estava no cofre e a
      // cópia não mexe (tirar de lá criaria um arquivo repetido no Drive)
      mantida[k] = true;
      manter.add(tipo === "pasta" ? `pasta:${it.id}` : it.id);
      relatar(m, "fora", `posto numa pasta criada à mão ${onde_}: o app só enxerga as pastas que ele cria. Crie a pasta pelo WJPDM (Nova pasta) e mova para ela; até lá fica em ${noCofre.join("/")} no cofre.`);
      continue;
    }
    const a = tipo === "arquivo" ? (reg as Arquivo) : null;
    if (a?.checkout) {
      relatar(m, "desfeito", `em GO-OUT com ${a.checkout.usuario}: o app pôs de volta em ${noCofre.join("/")}. Mova depois do GO-IN.`);
      continue;
    }
    const paiNoCofre = tipo === "pasta" ? ((reg as Pasta).pai ?? null) : (reg as Arquivo).pasta;
    const appMudou = it.pai !== undefined ? paiNoCofre !== it.pai || reg.nome !== it.gravado[it.gravado.length - 1] : !igual(noCofre, aplicar(it.gravado, k).novo ?? it.gravado);
    const acao: AcaoFora = igual(dir(visto), dir(noCofre)) ? "renomeado" : "movido";
    if (!appMudou) {
      const t = trazerParaOCofre(i, m, [], agora, usuario, novoId);
      if ("erro" in t) relatar(m, "desfeito", `${t.erro} O app pôs de volta.`);
      else {
        i = t.indice;
        relatar(m, acao);
      }
      continue;
    }
    // conflito: mudou no app e fora dele → a mais recente vence; a outra vai para a lixeira do cofre
    conflitos.push(reg.nome);
    if (tempo(m.quando) > tempo(reg.mod)) {
      const t = trazerParaOCofre(i, m, [], agora, usuario, novoId, undefined, " (mais recente que a mudança feita no app)");
      if (!("erro" in t)) {
        if (a) {
          const c = copiaNaLixeira(a, a.nome, a.pasta, dia(a.mod ?? ""), agora, `app${tempo(a.mod)}`, `Mudança feita no app (${noCofre.join("/")}), mais antiga que a feita ${onde_} (guardada na lixeira)`);
          if (!t.indice.arquivos.some((x) => x.id === c.id)) t.indice.arquivos.push(c);
        }
        i = t.indice;
        relatar(m, "conflito", `a mudança feita ${onde_} é a mais recente e ficou${a ? "; a do app foi para a lixeira do cofre" : ""}.`);
        continue;
      }
    }
    // o app vence: o espelho volta ao lugar do cofre; onde o Johann pôs fica registrado na lixeira
    if (a) {
      const pasta = pastaEm(i, dir(visto), []);
      const c = copiaNaLixeira(a, visto[visto.length - 1], pasta === undefined ? a.pasta : (pasta ?? RAIZ), dia(m.quando), agora, `fora${tempo(m.quando)}`, `Mudança feita ${onde_} (${visto.join("/")}), mais antiga que a feita no app (guardada na lixeira)`);
      if (!i.arquivos.some((x) => x.id === c.id)) i = { ...i, arquivos: [...i.arquivos, c] };
    }
    relatar(m, "conflito", `a mudança feita no app é a mais recente e ficou${a ? `; a feita ${onde_} foi para a lixeira do cofre` : ""}.`);
  }
  for (const x of implicitas) if (mantida[x.k]) presos.add(x.chave);
  // 3. excluídos à mão: arquivos para a lixeira do cofre (versões preservadas), com as exceções
  for (const { tipo, it } of apagadas) {
    if (tipo !== "arquivo") continue;
    const a = i.arquivos.find((x) => x.id === it.id && !x.lixeira);
    if (!a) continue;
    const de = caminhoDoArquivo(i, a);
    const quando = it.quando ?? agora;
    const m: MudancaFora = { id: `${e.copia}|arquivo|${a.id}|-`, copia: e.copia, tipo: "arquivo", alvo: a.id, nome: a.nome, de, para: null, quando };
    const est = estadoDe(a.estado);
    if (a.checkout) relatar(m, "desfeito", `em GO-OUT com ${a.checkout.usuario}: não sai do cofre; o app o pôs de volta ${onde_}.`);
    else if (est.naoExcluir) relatar(m, "desfeito", `"${est.nome}" não deixa excluir (torne-o obsoleto antes): o app o pôs de volta ${onde_}.`);
    else if (tempo(a.mod) > tempo(quando)) {
      relatar(m, "conflito", `alterado no app depois de excluído ${onde_}: a alteração é a mais recente e ficou; o app o pôs de volta.`);
    } else {
      const texto = `Excluído ${onde_}: enviado para a lixeira do cofre (versões preservadas; restaurável por 30 dias)`;
      const novo: Arquivo = { ...a, checkout: undefined, lixeira: true, lixeiraData: agora, mod: agora, historico: [...a.historico, { data: agora, usuario, texto }] };
      i = { ...i, arquivos: i.arquivos.map((x) => (x === a ? novo : x)) };
      relatar(m, "lixeira");
    }
  }
  // pastas excluídas à mão (as mais fundas primeiro): saem do cofre só vazias — o que ficou nelas
  // (GO-OUT, estado protegido, arquivo ainda não publicado) as mantém, e nenhum arquivo fica sem pasta
  for (const { it } of apagadas.filter((x) => x.tipo === "pasta").sort((a, b) => b.it.gravado.length - a.it.gravado.length)) {
    const p = i.pastas.find((x) => x.id === it.id);
    if (!p) continue;
    const de = caminhoDaPasta(i, p.id);
    const m: MudancaFora = { id: `${e.copia}|pasta|${p.id}|-`, copia: e.copia, tipo: "pasta", alvo: p.id, nome: p.nome, de, para: null, quando: it.quando ?? agora };
    const ds = descendentes(i, p.id);
    const ficam = i.arquivos.filter((a) => !a.lixeira && ds.has(a.pasta));
    const subpastas = i.pastas.filter((x) => x.pai === p.id);
    if (ficam.length || subpastas.length) {
      const nomes = ficam.slice(0, 5).map((a) => a.nome).join(", ") + (ficam.length > 5 ? "…" : "");
      relatar(m, "mantida", ficam.length ? `ainda tem ${ficam.length} arquivo(s) que não saem do cofre (${nomes}): o app recriou a pasta ${onde_}.` : `ainda tem subpastas no cofre: o app recriou a pasta ${onde_}.`);
      continue;
    }
    i = { ...i, pastas: i.pastas.filter((x) => x.id !== p.id), exclusoes: [...i.exclusoes.filter((x) => x.id !== p.id), { id: p.id, tipo: "pasta", data: agora }] };
    relatar(m, "lixeira");
  }
  // 4. conteúdo editado fora do app: vale a cópia do cofre (a cópia regrava), com aviso
  const regravar = new Set(e.editados ?? []);
  const avisados = new Set<string>();
  for (const k of regravar) {
    const id = k.split("#")[0];
    const a = i.arquivos.find((x) => x.id === id);
    if (!a || avisados.has(id)) continue;
    avisados.add(id);
    const de = caminhoDoArquivo(i, a);
    relatar({ id: `${e.copia}|arquivo|${id}|editado`, copia: e.copia, tipo: "arquivo", alvo: id, nome: a.nome, de, para: de, quando: agora }, "editado",
      `conteúdo mudado ${onde_} fora do app: vale a cópia do cofre, que foi gravada de novo. Para mudar o arquivo, abra pelo app (GO-OUT) ou use "Adicionar" no WJPDM.`);
  }
  // 5. a estrutura do cofre na cópia (pasta WJPDM, .wjpdm) nunca aceita mudança de fora: o app a refez
  for (const [k, motivo] of (e.estrutura ?? []).entries())
    relatar({ id: `${e.copia}|estrutura|${k}`, copia: e.copia, tipo: "pasta", alvo: "", nome: motivo.includes(".wjpdm") ? ".wjpdm" : "WJPDM", de: [], para: null, quando: agora }, "desfeito", motivo);
  return { indice: i, relatos, conflitos, manter, presos, trocas: [], onde, regravar };
}
