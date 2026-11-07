// O WJPDM é o lugar de todos os arquivos do WJProMaster (decisões do Johann, 28/10/2026):
// - salvar num app grava a cópia de trabalho NO DISPOSITIVO (banco do app + pasta padrão do
//   dispositivo); o primeiro salvar pergunta a pasta do cofre e o arquivo entra em GO-OUT;
// - GO-IN cria a versão e PUBLICA no pendrive e no Google Drive (que só recebem o que passou por
//   GO-IN); painel lateral em cada app com GO-OUT/GO-IN e a lista dos arquivos em GO-OUT.
// Regras da sincronia em src/pdm/sincronia.ts; pastas de disco em repositorios.ts.

import { Armazem } from "./armazem";
import { permissao, RepositorioAparelho, RepositorioPasta, type PastaDisco } from "./repositorios";
import { sincronizar, type MetaCofre, type Repositorio, type ResultadoSincronia } from "../pdm/sincronia";
import { nuvemGoogle, type DestinoNuvem } from "./drive";
import { bloqueioDoCheckout, estadoDe, extensao, fluxoAtual, nomeLivre, trocarReferencias, usarFluxo, type Arquivo, type DadosModelo, type Pasta, type ReferenciaArquivo } from "../pdm/regras";
import { abrirEmNovaJanela, fixarNaJanela, gravarNaJanela, lerDaJanela, removerDaJanela } from "./janelas";

export type ChaveApp = "cad" | "asm" | "drw" | "plan" | "word" | "cron" | "apn" | "pdm" | "erp" | "flow" | "calc" | "joia";
export const NOME_APP: Record<ChaveApp, string> = {
  cad: "WJCAD", asm: "WJCAD (montagem)", drw: "WJCAD (desenho)", plan: "WJPlan", word: "WJWrite", cron: "WJCronProject", apn: "WJApresentation", pdm: "WJPDM", erp: "WJERP", flow: "WJFlow", calc: "WJCalcEng", joia: "WJGoldDiamond",
};
/** Pasta padrão de cada face na raiz do cofre. */
export const PASTA_DA_FACE: Record<ChaveApp, string> = {
  cad: "CAD", asm: "CAD", drw: "CAD", plan: "Planilhas", word: "Documentos", cron: "Cronogramas", apn: "Apresentações", pdm: "PDM", erp: "ERP", flow: "Escoamento", calc: "Cálculos", joia: "Joias",
};
/** Apps por extensão: chave do salvamento automático e endereço (abrir arquivo do cofre no app). */
export const APPS: Record<string, { app: string; chave: string; url: string; face: ChaveApp }> = {
  wjcad: { app: "WJCAD", chave: "jlscad:documento", url: "cad/#abrir-autosave", face: "cad" },
  jlscad: { app: "WJCAD", chave: "jlscad:documento", url: "cad/#abrir-autosave", face: "cad" },
  wjasm: { app: "WJCAD (montagem)", chave: "wjcad:montagem", url: "cad/montagem/#abrir-autosave", face: "asm" },
  wjdrw: { app: "WJCAD (desenho)", chave: "wjcad:desenho", url: "cad/desenho/#abrir-autosave", face: "drw" },
  wjpl: { app: "WJPlan", chave: "wjpl:documento", url: "planilha/", face: "plan" },
  wjdoc: { app: "WJWrite", chave: "wjdoc:documento", url: "documento/", face: "word" },
  wjapn: { app: "WJApresentation", chave: "wjapn:documento", url: "apresentacao/", face: "apn" },
  wjcron: { app: "WJCronProject", chave: "wjcron:documento", url: "cronograma/", face: "cron" },
  wjflow: { app: "WJFlow", chave: "wjflow:estudo", url: "flow/", face: "flow" },
  wjcalc: { app: "WJCalcEng", chave: "wjcalc:documento", url: "calceng/", face: "calc" },
  wjgd: { app: "WJGoldDiamond", chave: "wjgd:documento", url: "joia/", face: "joia" },
};
const EXT_DA_FACE: Record<ChaveApp, string[]> = { cad: ["wjcad", "jlscad"], asm: ["wjasm"], drw: ["wjdrw"], plan: ["wjpl"], word: ["wjdoc"], cron: ["wjcron"], apn: ["wjapn"], pdm: ["wjpdm"], erp: ["wjerp"], flow: ["wjflow"], calc: ["wjcalc"], joia: ["wjgd"] };

const agora = () => new Date().toISOString();
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

/** Google Drive (login do Google, escopo drive.file): cópia do cofre em Meu Drive/WJPDM. */
let nuvem: DestinoNuvem | null = nuvemGoogle;
export function registrarNuvem(d: DestinoNuvem | null) {
  nuvem = d;
}

/**
 * Acesso ao Drive vencido: pede a renovação JÁ (antes de qualquer espera), enquanto o toque do
 * usuário ainda vale — senão o navegador bloqueia a janela do Google.
 */
function renovarNuvem(pedir: boolean): Promise<boolean> {
  return pedir && nuvem ? nuvem.renovar().catch(() => false) : Promise.resolve(!!nuvem?.conectado());
}

// ---------- banco do cofre e pastas das cópias ----------

let cofreDb: Promise<Armazem> | null = null;
export const abrirCofre = () => (cofreDb ??= Armazem.abrir());
let locaisDb: Promise<Armazem> | null = null;
const locais = () => (locaisDb ??= Armazem.abrir("wjlocais", ["pastas"]));
type Copia = "pendrive" | "tablet";
/** Raiz escolhida para uma cópia do cofre (o cofre fica em <raiz>/WJPDM; outras faces usam pastas irmãs). */
export async function pastaDa(c: Copia): Promise<PastaDisco | undefined> {
  try {
    return (await (await locais()).ler<{ id: string; pasta: PastaDisco }>("pastas", `cofre:${c}`))?.pasta;
  } catch {
    return undefined;
  }
}
async function guardarPasta(c: Copia, p: PastaDisco | null) {
  const a = await locais();
  if (p) await a.por("pastas", { id: `cofre:${c}`, pasta: p } as { id: string });
  else await a.apagar("pastas", `cofre:${c}`);
}
type Janela = typeof window & { showDirectoryPicker?(o?: { id?: string; mode?: "readwrite"; startIn?: string }): Promise<PastaDisco> };
export const temPastas = () => typeof (window as Janela).showDirectoryPicker === "function";

/** Usuário do cofre; também passa a usar o fluxo de trabalho do cofre (estados e travas). */
const usuarioDo = async (db: Armazem) => {
  const meta = await db.ler<MetaCofre>("meta", "meta");
  usarFluxo(meta?.fluxo);
  return meta?.usuario || "Usuário";
};

// ---------- sincronia ----------

let ultima: { quando: string; texto: string } | null = null;
let fila: Promise<unknown> = Promise.resolve();

/** Situação de cada cópia do cofre na última sincronia. */
export type EstadoCopia = "ok" | "toque" | "desconectado" | "offline" | "nao";
export interface SituacaoCopias {
  quando: string;
  drive: EstadoCopia;
  tablet: EstadoCopia;
  pendrive: EstadoCopia;
}
let situacao: SituacaoCopias = { quando: "", drive: "nao", tablet: "nao", pendrive: "nao" };
/** Como estavam o Google Drive, a pasta do dispositivo e o pendrive na última sincronia. */
export const situacaoDasCopias = (): SituacaoCopias => ({ ...situacao });

export interface OpcoesSincronia {
  /** pode mostrar o "Permitir"/janela do Google (só logo depois de um toque do usuário) */
  pedir?: boolean;
  /** true: também pendrive e Drive (publicação, depois de um GO-IN); false: só o dispositivo */
  publicar?: boolean;
  /** renovação do Drive já pedida no toque (ver renovarNuvem) */
  renovacao?: Promise<boolean>;
}

/**
 * Iguala o cofre do aparelho com a pasta padrão do dispositivo e, ao publicar, com o pendrive e o
 * Google Drive. Uma sincronia por vez (as seguintes esperam na fila).
 */
export function sincronizarCofre(o: OpcoesSincronia = {}): Promise<string> {
  const pedir = o.pedir ?? true, publicar = o.publicar ?? true;
  const renovacao = publicar ? (o.renovacao ?? renovarNuvem(pedir)) : Promise.resolve(false);
  const tarefa = fila.then(async () => {
    const db = await abrirCofre();
    const repos: Repositorio[] = [new RepositorioAparelho(db)];
    const ausentes: string[] = [];
    const sit: SituacaoCopias = { ...situacao, quando: agora() };
    const copias = publicar ? ([["tablet", "pasta do dispositivo"], ["pendrive", "pendrive"]] as const) : ([["tablet", "pasta do dispositivo"]] as const);
    const repoDe = new Map<string, "tablet" | "pendrive" | "drive">();
    for (const [c, rot] of copias) {
      const p = await pastaDa(c);
      if (!p) {
        sit[c] = "nao";
        continue;
      }
      if (await permissao(p, pedir).catch(() => false)) {
        repos.push(new RepositorioPasta(rot, p, c === "pendrive"));
        repoDe.set(rot, c);
        sit[c] = "ok";
      } else {
        ausentes.push(`${rot} sem permissão`);
        sit[c] = "toque";
      }
    }
    if (publicar) {
      if (nuvem && navigator.onLine && ((await renovacao) || nuvem.conectado())) {
        const r = nuvem.repositorio();
        repos.push(r);
        repoDe.set(r.nome, "drive");
        sit.drive = "ok";
      } else if (nuvem && localStorage.getItem("wjgoogle:autorizado") === "1") {
        ausentes.push(navigator.onLine ? "Google Drive com acesso vencido (toque em Sincronizar agora)" : "Google Drive sem internet");
        sit.drive = navigator.onLine ? "toque" : "offline";
      } else sit.drive = "nao";
    }
    situacao = sit;
    if (repos.length === 1) {
      const t = ausentes.length ? `Só no banco do app · ${ausentes.join(", ")}.` : publicar ? "Nenhuma cópia conectada: conecte o pendrive ou o Google Drive (📁 Cópias do cofre)." : "Salvo só no banco do app: escolha a pasta padrão do dispositivo (📁 Cópias do cofre).";
      return (ultima = { quando: agora(), texto: t }).texto;
    }
    const r = await sincronizar(repos, agora());
    for (const f of r.falhas) {
      const c = repoDe.get(f.repo);
      if (c) situacao[c] = "desconectado";
    }
    return (ultima = { quando: agora(), texto: resumo(r, repos, ausentes) }).texto;
  });
  fila = tarefa.catch(() => {});
  return tarefa;
}

let abriu = false;
/**
 * Sincronia global ao abrir (cada abertura ou recarregar de qualquer página): dispositivo, pendrive
 * e Drive, sem pedir nada (não há toque). Se alguma cópia precisar de permissão ou de novo login do
 * Google, aparece a faixa "Sincronizar agora" no topo: um toque libera e iguala todas.
 * Roda depois de `espera` (o app termina de abrir antes) e só uma vez por página.
 */
export function sincronizarAoAbrir(espera: Promise<unknown> = Promise.resolve()): Promise<string> | undefined {
  if (abriu) return;
  abriu = true;
  return espera
    .catch(() => {})
    .then(() => new Promise((r) => setTimeout(r, 800)))
    .then(() => sincronizarCofre({ pedir: false, publicar: true }))
    .then((m) => {
      avisarMudanca();
      faixaConexoes(m);
      sincroniaAutomatica();
      return m;
    });
}

const AUTO_MS = 5 * 60 * 1000; // tentativa automática enquanto o app está aberto
const RENOVAR_ANTES = 10 * 60 * 1000; // o acesso do Google é renovado no toque 10 min antes de vencer
let ultimaAuto = 0;

/**
 * Tentativas automáticas com o Google Drive, o pendrive e a pasta do dispositivo, sem botão:
 * a cada 5 min com o app visível, ao voltar a internet e ao voltar para o app. O acesso do Google
 * (vale 1 h) é renovado sozinho no primeiro toque/tecla quando está perto de vencer — o navegador
 * só deixa abrir a janela do Google durante um gesto do usuário. Sem servidor (G5), não há como
 * renovar sem nenhum toque.
 */
function sincroniaAutomatica() {
  nuvem?.preparar?.();
  const tentar = (forcar = false) => {
    if (document.visibilityState !== "visible" || !navigator.onLine) return;
    if (!forcar && Date.now() - ultimaAuto < 60000) return;
    ultimaAuto = Date.now();
    void sincronizarCofre({ pedir: false, publicar: true }).then((m) => {
      avisarMudanca();
      // resolveu o que estava pendente: a faixa some; apareceu problema: ela volta
      const s = situacaoDasCopias();
      const pendente = ROTULO_COPIA.some(([k]) => s[k] !== "ok" && s[k] !== "nao");
      if (pendente) faixaConexoes(m);
      else document.querySelector(".wjc-faixa")?.remove();
    }, () => {});
  };
  setInterval(() => tentar(), AUTO_MS);
  addEventListener("online", () => tentar(true));
  document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && tentar());
  // renovação do Google no primeiro gesto com o acesso perto de vencer (uma tentativa a cada 10 min)
  let ultimoPedido = 0;
  const noGesto = () => {
    if (!nuvem?.vencendo?.(RENOVAR_ANTES) || !navigator.onLine || Date.now() - ultimoPedido < RENOVAR_ANTES) return;
    ultimoPedido = Date.now();
    void nuvem.renovarAgora?.().then((ok) => ok && tentar(true));
  };
  // eventos que o navegador aceita como gesto para abrir a janela do Google
  addEventListener("pointerup", noGesto, true);
  addEventListener("keydown", noGesto, true);
}

/** Evento na janela depois de uma sincronia com toque (outras bases, como as tarefas, aproveitam a permissão). */
export const EVENTO_SINCRONIZADO = "wj-sincronizado";

const ROTULO_COPIA: [keyof Omit<SituacaoCopias, "quando">, string][] = [["drive", "Google Drive"], ["tablet", "Pasta do dispositivo"], ["pendrive", "Pendrive"]];
const TEXTO_ESTADO: Record<EstadoCopia, [string, string]> = {
  ok: ["✓", "conectado e igual"],
  toque: ["!", "precisa de um toque para liberar o acesso"],
  desconectado: ["✕", "não encontrado (desconectado?)"],
  offline: ["✕", "sem internet"],
  nao: ["—", "não configurado"],
};

/**
 * Faixa no topo ao abrir qualquer app: situação de cada cópia do cofre (Google Drive, pasta do
 * dispositivo, pendrive). Tudo certo: some sozinha. Cópia configurada que ficou de fora: fica com
 * "Conectar agora" (um toque libera o acesso e iguala tudo) e "Cópias…" (configurar).
 */
function faixaConexoes(m: string) {
  document.querySelector(".wjc-faixa")?.remove();
  if (!document.getElementById("wjc-css")) document.head.append(Object.assign(document.createElement("style"), { id: "wjc-css", textContent: CSS }));
  const f = document.createElement("div");
  f.className = "wjc-faixa";
  f.setAttribute("role", "status");
  const desenhar = (texto: string) => {
    const s = situacaoDasCopias();
    const pendente = ROTULO_COPIA.some(([k]) => s[k] === "toque" || s[k] === "desconectado" || s[k] === "offline") || precisaToque(texto);
    const nenhuma = ROTULO_COPIA.every(([k]) => s[k] === "nao");
    f.classList.toggle("ok", !pendente && !nenhuma);
    f.innerHTML = `<span class="wjc-cops"><b>Cofre:</b> ${ROTULO_COPIA.map(([k, r]) => `<i class="wjc-cop ${s[k]}" title="${r}: ${TEXTO_ESTADO[s[k]][1]}">${TEXTO_ESTADO[s[k]][0]} ${r}</i>`).join("")}${nenhuma ? "<small>Nenhuma cópia: os arquivos ficam só no banco deste navegador.</small>" : ""}</span>
      ${pendente ? `<button class="destaque" data-s>Conectar agora</button>` : ""}<button data-c>Cópias…</button><button data-x title="Fechar" aria-label="Fechar">✕</button>`;
    f.querySelector<HTMLElement>("[data-x]")!.onclick = () => f.remove();
    f.querySelector<HTMLElement>("[data-c]")!.onclick = () => void abrirCopias(() => desenhar(ultima?.texto ?? ""));
    const b = f.querySelector<HTMLButtonElement>("[data-s]");
    if (b) b.onclick = async () => {
      b.disabled = true;
      b.textContent = "Conectando…";
      // a renovação do Google sai já, dentro do toque (senão o navegador bloqueia a janela)
      const r = await sincronizarCofre({ pedir: true, publicar: true }).catch((x: Error) => x.message);
      avisarMudanca();
      window.dispatchEvent(new Event(EVENTO_SINCRONIZADO));
      desenhar(r);
    };
    clearTimeout(Number(f.dataset.t));
    if (!pendente) f.dataset.t = String(setTimeout(() => f.remove(), nenhuma ? 8000 : 5000));
  };
  desenhar(m);
  document.body.append(f);
}
/** A sincronia ou outro salvar mudou o cofre (para recarregar listas). */
export const aoMudarCofre = (f: () => void) => ouvintes.add(f);
/** Mensagem da sincronia ao abrir que merece aviso: algo pede um toque ou houve conflito. */
export const precisaToque = (m: string) => /sem permissão|vencido|conflito|desconectado/.test(m);

function resumo(r: ResultadoSincronia, repos: Repositorio[], ausentes: string[]): string {
  const ok = repos.filter((x) => x.nome !== "aparelho" && !r.falhas.some((f) => f.repo === x.nome)).map((x) => x.nome);
  const partes = [ok.length ? `Igual em: ${ok.join(", ")}` : "Só no banco do app"];
  const fora = [...r.falhas.map((f) => `${f.repo} desconectado`), ...ausentes];
  if (fora.length) partes.push(fora.join(", "));
  if (r.conflitos.length) partes.push(`conflito em ${r.conflitos.join(", ")} (a mais recente ficou; a outra está na lixeira)`);
  if (r.faltando.length) partes.push(`${r.faltando.length} conteúdo(s) não encontrado(s) em nenhuma cópia`);
  return `${partes.join(" · ")}.`;
}

// ---------- salvar e abrir pelos apps ----------

const chaveVinculo = (app: ChaveApp) => `wjpdm:vinculo:${app}`;
// cada janela fica com o vínculo que tinha ao abrir (outra janela que abrir outro arquivo não troca)
for (const app of Object.keys(NOME_APP) as ChaveApp[]) fixarNaJanela(chaveVinculo(app));
/** Arquivo do cofre ligado ao documento aberto no app (salvar atualiza esse arquivo). */
export const vinculo = (app: ChaveApp) => lerDaJanela(chaveVinculo(app));
export const ligar = (app: ChaveApp, id: string) => gravarNaJanela(chaveVinculo(app), id);
/** Vínculo só na chave comum: passa o arquivo para a próxima janela que abrir, sem mexer nesta. */
const ligarParaOutraJanela = (app: ChaveApp, id: string) => localStorage.setItem(chaveVinculo(app), id);
/** Novo documento / aberto do aparelho: o próximo salvar cria um arquivo novo no cofre. */
export const desligar = (app: ChaveApp) => removerDaJanela(chaveVinculo(app));

const caminhoDaPasta = (ps: Pasta[], id: string) => {
  const n: string[] = [];
  const vistos = new Set<string>();
  for (let p = ps.find((x) => x.id === id); p && !vistos.has(p.id); p = p.pai ? ps.find((x) => x.id === p!.pai) : undefined) {
    vistos.add(p.id);
    n.unshift(p.nome);
  }
  return n.join("/");
};
const RAIZ = "raiz";
const ULTIMA_PASTA = (app: ChaveApp) => `wjpdm:ultimaPasta:${app}`;

/** Pasta da face na raiz do cofre (cria se faltar): onde o WJPDM e o WJERP guardam suas cópias. */
async function pastaDaFace(db: Armazem, app: ChaveApp): Promise<string> {
  const ps = await db.todos<Pasta>("pastas");
  const achada = ps.find((p) => p.pai === null && p.nome === PASTA_DA_FACE[app]);
  if (achada) return achada.id;
  const nova: Pasta = { id: uid(), nome: PASTA_DA_FACE[app], pai: null, mod: agora() };
  await db.por("pastas", nova);
  return nova.id;
}

// ---------- explorador do cofre (salvar, abrir, escolher): como o explorador de arquivos ----------

/** Rótulo do tipo de arquivo pela extensão (coluna "Tipo" e filtro). */
const TIPO_EXT: Record<string, string> = {
  wjcad: "Peça (WJCAD)", jlscad: "Peça (WJCAD)", wjasm: "Montagem (WJCAD)", wjdrw: "Desenho (WJCAD)", wjpl: "Planilha (WJPlan)", wjdoc: "Documento (WJWrite)",
  wjapn: "Apresentação (WJApresentation)", wjcron: "Cronograma (WJCronProject)", wjflow: "Estudo (WJFlow)", wjcalc: "Cálculo (WJCalcEng)", wjgd: "Joia (WJGoldDiamond)", wjpdm: "Cópia do cofre (WJPDM)", wjerp: "Dados (WJERP)",
};
const tipoDe = (nome: string) => TIPO_EXT[extensao(nome)] ?? (extensao(nome) ? `Arquivo ${extensao(nome).toUpperCase()}` : "Arquivo");
const IC_PASTA = `<svg viewBox="0 0 24 24" width="22" height="22"><path d="M2.5 6.5a1.5 1.5 0 0 1 1.5-1.5h5l2 2.2h9a1.5 1.5 0 0 1 1.5 1.5V18a1.5 1.5 0 0 1-1.5 1.5H4A1.5 1.5 0 0 1 2.5 18z" fill="#f2c14e" stroke="#c99a1e"/></svg>`;
const icArquivo = (ext: string, deste: boolean) => `<svg viewBox="0 0 24 24" width="22" height="22"><path d="M6 2.5h8l4.5 4.5v14.5H6z" fill="${deste ? "#e3effb" : "#f3f5f7"}" stroke="${deste ? "#2f7fd0" : "#9aa6b2"}"/><path d="M14 2.5V7h4.5" fill="none" stroke="${deste ? "#2f7fd0" : "#9aa6b2"}"/><text x="12.2" y="17.5" font-size="5" text-anchor="middle" fill="${deste ? "#1f4e79" : "#5e6b78"}" font-family="system-ui,sans-serif" font-weight="700">${esc(ext.slice(0, 4).toUpperCase())}</text></svg>`;

interface OpcoesExplorador {
  titulo: string;
  modo: "salvar" | "abrir";
  /** extensões do filtro "deste app" (as outras aparecem com "Todos os arquivos") */
  exts: string[];
  rotuloFiltro: string;
  /** pasta inicial (id ou RAIZ) */
  inicio: string;
  /** salvar: nome sugerido (sem extensão) e extensão */
  nome?: string;
  ext?: string;
  /** salvar: rodapé com a pasta padrão do dispositivo */
  infoDispositivo?: boolean;
  botao?: string;
}
type Escolha = { pasta: string; nome: string; arquivo?: Arquivo };

/**
 * Explorador do cofre: barra (Voltar, Pasta acima, caminho clicável, Nova pasta), lista em
 * detalhes com pastas e arquivos da pasta atual (nome, modificado, tipo, GO-OUT), duplo clique ou
 * duplo toque entra na pasta ou escolhe o arquivo; embaixo, nome do arquivo (salvar) e filtro de
 * tipo. Pastas novas vão logo para as cópias do cofre (Drive, pendrive, pasta do dispositivo).
 */
async function explorarCofre(o: OpcoesExplorador): Promise<Escolha | null> {
  const db = await abrirCofre();
  const meta = await db.ler<MetaCofre>("meta", "meta");
  let ps = await db.todos<Pasta>("pastas");
  const arqs = (await db.todos<Arquivo>("arquivos")).filter((a) => !a.lixeira);
  let atual = o.inicio === RAIZ || ps.some((p) => p.id === o.inicio) ? o.inicio : RAIZ;
  const historico: string[] = [];
  let soDeste = true;
  let sel: string | null = null; // "p:<id>" ou "a:<id>"
  let novaAberta = false;
  let msg = "";
  return new Promise((fim) => {
    const { caixa, fechar } = janela(o.titulo);
    caixa.parentElement!.classList.add("wjc-explorador");
    let feito = false;
    // a sincronia trouxe arquivos de outro aparelho: a lista se atualiza sozinha
    const recarregar = async () => {
      if (feito) return;
      ps = await db.todos<Pasta>("pastas");
      arqs.splice(0, arqs.length, ...(await db.todos<Arquivo>("arquivos")).filter((a) => !a.lixeira));
      if (!novaAberta && !feito) void desenhar();
    };
    ouvintes.add(recarregar);
    const terminar = (r: Escolha | null) => {
      if (feito) return;
      feito = true;
      ouvintes.delete(recarregar);
      fechar();
      fim(r);
    };
    if (o.modo === "abrir") void sincronizarCofre({ pedir: false, publicar: true }).then(() => avisarMudanca(), () => {});
    new MutationObserver((_, ob) => {
      if (!caixa.isConnected) {
        ob.disconnect();
        terminar(null);
      }
    }).observe(document.body, { childList: true });
    const paiDe = (id: string) => (id === RAIZ ? null : (ps.find((p) => p.id === id)?.pai ?? RAIZ));
    const trilha = (id: string) => {
      const out: { id: string; nome: string }[] = [];
      for (let p = ps.find((x) => x.id === id); p; p = p.pai ? ps.find((x) => x.id === p!.pai) : undefined) out.unshift({ id: p.id, nome: p.nome });
      return [{ id: RAIZ, nome: meta?.nome || "Cofre" }, ...out];
    };
    const irPara = (id: string, guardar = true) => {
      if (id === atual) return;
      if (guardar) historico.push(atual);
      atual = id;
      sel = null;
      msg = "";
      void desenhar();
    };
    let campoNome = o.nome ?? "";
    const desenhar = async () => {
      const pai = atual === RAIZ ? null : atual;
      const pastas = ps.filter((p) => p.pai === pai).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
      const arquivos = arqs.filter((a) => (a.pasta === atual || (atual === RAIZ && !ps.some((p) => p.id === a.pasta))) && (!soDeste || o.exts.includes(extensao(a.nome))))
        .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
      const tab = o.infoDispositivo ? await pastaDa("tablet") : undefined;
      const linhas = [
        ...pastas.map((p) => `<li data-k="p:${p.id}" tabindex="0" class="${sel === `p:${p.id}` ? "sel" : ""}"><span class="wje-n">${IC_PASTA}<span>${esc(p.nome)}</span></span><span class="wje-d">${p.mod ? quando(p.mod) : ""}</span><span class="wje-t">Pasta</span></li>`),
        ...arquivos.map((a) => {
          const deste = o.exts.includes(extensao(a.nome));
          return `<li data-k="a:${a.id}" tabindex="0" class="${sel === `a:${a.id}` ? "sel" : ""}${deste ? "" : " outro"}"><span class="wje-n">${icArquivo(extensao(a.nome), deste)}<span>${esc(a.nome)}${a.checkout ? `<small>GO-OUT ${esc(a.checkout.usuario)}</small>` : ""}${a.soLocal ? `<small>não publicado</small>` : ""}</span></span><span class="wje-d">${a.mod ? quando(a.mod) : ""}</span><span class="wje-t">${esc(tipoDe(a.nome))}</span></li>`;
        }),
      ];
      caixa.innerHTML = `
        <div class="wje-barra">
          <button data-a="voltar" title="Voltar" aria-label="Voltar" ${historico.length ? "" : "disabled"}>←</button>
          <button data-a="acima" title="Pasta acima" aria-label="Pasta acima" ${atual === RAIZ ? "disabled" : ""}>↑</button>
          <nav class="wje-trilha" aria-label="Caminho">${trilha(atual).map((t, k, l) => `<button data-t="${t.id}" ${k === l.length - 1 ? 'aria-current="page"' : ""}>${esc(t.nome)}</button>`).join("<span>›</span>")}</nav>
          <button data-a="nova" title="Nova pasta">+ Nova pasta</button>
        </div>
        ${novaAberta ? `<div class="wje-nova">${IC_PASTA}<input data-nova value="Nova pasta" aria-label="Nome da nova pasta" /><button data-a="criar" class="destaque">Criar</button><button data-a="semNova">Cancelar</button></div>` : ""}
        <div class="wje-cab"><span>Nome</span><span class="wje-d">Modificado</span><span class="wje-t">Tipo</span></div>
        <ul class="wje-lista" role="listbox" aria-label="Pastas e arquivos">${linhas.join("") || `<li class="vazia">Esta pasta está vazia.</li>`}</ul>
        <div class="wje-rodape">
          ${o.modo === "salvar" ? `<label class="wjc-nome"><span>Nome do arquivo</span><input data-nome value="${esc(campoNome)}" aria-label="Nome do arquivo" />${o.ext ? `<b>.${esc(o.ext)}</b>` : ""}</label>` : ""}
          <label class="wje-filtro"><span>Tipo</span><select data-filtro><option value="1"${soDeste ? " selected" : ""}>${esc(o.rotuloFiltro)}</option><option value="0"${soDeste ? "" : " selected"}>Todos os arquivos</option></select></label>
          ${o.infoDispositivo ? `<p>O arquivo fica <b>em GO-OUT</b> no dispositivo (banco do app${tab ? ` e pasta <b>${esc(tab.name)}</b>/WJPDM` : ""}); o primeiro salvar já publica a versão 1 no pendrive e no Google Drive.${tab ? "" : temPastas() ? ` <button data-a="tab">Escolher pasta do dispositivo…</button>` : ""}</p>` : ""}
          <p class="wje-msg ${/não|Já existe/.test(msg) ? "wjc-nao" : "wjc-ok"}">${esc(msg)}</p>
        </div>
        <footer><button data-a="cancelar">Cancelar</button><button data-a="ok" class="destaque">${esc(o.botao ?? (o.modo === "salvar" ? "Salvar" : "Abrir"))}</button></footer>`;
      const campo = caixa.querySelector<HTMLInputElement>("[data-nome]");
      if (campo) {
        campo.oninput = () => (campoNome = campo.value);
        campo.onkeydown = (e) => {
          if (e.key === "Enter") void confirmar();
        };
      }
      const nova = caixa.querySelector<HTMLInputElement>("[data-nova]");
      if (nova) {
        nova.onkeydown = (e) => {
          if (e.key === "Enter") void criarPasta();
          else if (e.key === "Escape") (e.stopPropagation(), (novaAberta = false), void desenhar());
        };
        nova.focus();
        nova.select();
      } else if (campo && !sel) {
        campo.focus();
        campo.select();
      }
      caixa.querySelector<HTMLSelectElement>("[data-filtro]")!.onchange = (e) => ((soDeste = (e.target as HTMLSelectElement).value === "1"), void desenhar());
      caixa.querySelectorAll<HTMLButtonElement>("[data-t]").forEach((b) => (b.onclick = () => irPara(b.dataset.t!)));
      caixa.querySelectorAll<HTMLButtonElement>("[data-a]").forEach((b) => (b.onclick = () => void acoes[b.dataset.a!]?.()));
      // um toque/clique seleciona; dois seguidos (duplo clique ou duplo toque) abrem
      let ultimo = { k: "", t: 0 };
      caixa.querySelectorAll<HTMLElement>(".wje-lista li[data-k]").forEach((li) => {
        li.onpointerup = (e) => {
          if (e.pointerType === "mouse" && e.button !== 0) return;
          const k = li.dataset.k!, t = performance.now();
          const duplo = ultimo.k === k && t - ultimo.t < 450;
          ultimo = { k, t };
          if (duplo) return void ativar(k);
          selecionar(k);
        };
        li.onkeydown = (e) => {
          if (e.key === "Enter") (e.preventDefault(), void ativar(li.dataset.k!));
          else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            const alvo = (e.key === "ArrowDown" ? li.nextElementSibling : li.previousElementSibling) as HTMLElement | null;
            if (alvo?.dataset.k) (selecionar(alvo.dataset.k), alvo.focus());
          } else if (e.key === "Backspace" && atual !== RAIZ) (e.preventDefault(), irPara(paiDe(atual) ?? RAIZ));
        };
      });
    };
    const selecionar = (k: string) => {
      sel = k;
      caixa.querySelectorAll(".wje-lista li").forEach((x) => x.classList.toggle("sel", (x as HTMLElement).dataset.k === k));
      const a = k.startsWith("a:") ? arqs.find((x) => x.id === k.slice(2)) : undefined;
      const campo = caixa.querySelector<HTMLInputElement>("[data-nome]");
      // salvar: tocar um arquivo usa o nome dele (como no explorador)
      if (a && campo && o.exts.includes(extensao(a.nome))) campo.value = campoNome = a.nome.replace(/\.[^.]+$/, "");
    };
    const ativar = async (k: string) => {
      if (k.startsWith("p:")) return irPara(k.slice(2));
      const a = arqs.find((x) => x.id === k.slice(2));
      if (!a) return;
      if (o.modo === "abrir") return terminar({ pasta: a.pasta, nome: a.nome, arquivo: a });
      selecionar(k);
      await confirmar();
    };
    const confirmar = async () => {
      if (o.modo === "abrir") {
        if (sel?.startsWith("p:")) return irPara(sel.slice(2));
        const a = sel ? arqs.find((x) => x.id === sel!.slice(2)) : undefined;
        if (!a) return ((msg = "Escolha um arquivo (duplo clique abre)."), void desenhar());
        return terminar({ pasta: a.pasta, nome: a.nome, arquivo: a });
      }
      if (sel?.startsWith("p:") && document.activeElement?.closest(".wje-lista")) return irPara(sel.slice(2));
      const n = campoNome.trim().replace(/[\\/:*?"<>|]/g, "_");
      if (!n) return ((msg = "Digite o nome do arquivo."), void desenhar());
      const nome = o.ext ? `${n}.${o.ext}` : n;
      const irmaos = arqs.filter((a) => a.pasta === atual).map((a) => a.nome);
      if (irmaos.some((x) => x.toLowerCase() === nome.toLowerCase())) {
        const livre = nomeLivre(nome, irmaos);
        if (!confirm(`"${nome}" já existe nesta pasta.\n\nOK: salvar este documento como "${livre}".\nCancelar: escolher outro nome.`)) return;
      }
      terminar({ pasta: atual, nome });
    };
    const criarPasta = async () => {
      const nome = caixa.querySelector<HTMLInputElement>("[data-nova]")?.value.trim().replace(/[\\/:*?"<>|]/g, "_");
      if (!nome) return;
      const pai = atual === RAIZ ? null : atual;
      if (ps.some((p) => p.pai === pai && p.nome.toLowerCase() === nome.toLowerCase())) return ((msg = "Já existe uma pasta com esse nome aqui."), void desenhar());
      // a janela do Google (se o acesso venceu) abre já, dentro do toque
      const renovacao = renovarNuvem(true);
      const p: Pasta = { id: uid(), nome, pai, mod: agora() };
      await db.por("pastas", p);
      ps = await db.todos<Pasta>("pastas");
      novaAberta = false;
      // entra na pasta nova (o comum é criar a pasta para salvar dentro dela)
      historico.push(atual);
      atual = p.id;
      sel = null;
      msg = `Pasta "${nome}" criada (você está nela). Levando para as cópias do cofre…`;
      await desenhar();
      // a pasta nova vai logo para o Drive, o pendrive e a pasta do dispositivo
      void sincronizarCofre({ pedir: true, publicar: true, renovacao }).then((r) => {
        avisarMudanca();
        if (feito) return;
        msg = `Pasta "${nome}" criada. ${r}`;
        void desenhar();
      });
    };
    const acoes: Record<string, () => void | Promise<void>> = {
      ok: confirmar,
      cancelar: () => terminar(null),
      voltar: () => {
        const v = historico.pop();
        if (v !== undefined) irPara(ps.some((p) => p.id === v) || v === RAIZ ? v : RAIZ, false);
      },
      acima: () => {
        if (atual !== RAIZ) irPara(paiDe(atual) ?? RAIZ);
      },
      nova: () => ((novaAberta = true), void desenhar()),
      semNova: () => ((novaAberta = false), void desenhar()),
      criar: criarPasta,
      tab: async () => {
        try {
          await guardarPasta("tablet", await (window as Janela).showDirectoryPicker!({ id: "wjpdm-tablet", mode: "readwrite", startIn: "documents" }));
        } catch {
          /* desistiu */
        }
        await desenhar();
      },
    };
    void desenhar();
  });
}

/** Pasta onde o explorador abre: a última usada neste app, senão a pasta da face. */
async function pastaInicial(app: ChaveApp): Promise<string> {
  const db = await abrirCofre();
  const ps = await db.todos<Pasta>("pastas");
  const lembrada = localStorage.getItem(ULTIMA_PASTA(app));
  if (lembrada && (lembrada === RAIZ || ps.some((p) => p.id === lembrada))) return lembrada;
  return ps.find((p) => p.pai === null && p.nome === PASTA_DA_FACE[app])?.id ?? RAIZ;
}

const filtroDaFace = (app: ChaveApp) => `${NOME_APP[app].replace(/ \(.*\)$/, "")}: ${EXT_DA_FACE[app].map((e) => `.${e}`).join(", ")}`;

/**
 * Primeiro salvar de um documento: explorador do cofre para escolher a pasta (com "Nova pasta")
 * e o nome. null = cancelado.
 */
async function escolherLocal(app: ChaveApp, nomeArquivo: string): Promise<{ pasta: string; nome: string } | null> {
  const db = await abrirCofre();
  if (app === "pdm" || app === "erp") return { pasta: await pastaDaFace(db, app), nome: nomeArquivo };
  const ext = extensao(nomeArquivo);
  const r = await explorarCofre({
    titulo: `Salvar no cofre — ${NOME_APP[app]}`, modo: "salvar", exts: EXT_DA_FACE[app], rotuloFiltro: filtroDaFace(app),
    inicio: await pastaInicial(app), nome: ext ? nomeArquivo.slice(0, -(ext.length + 1)) : nomeArquivo, ext, infoDispositivo: true,
  });
  if (r) localStorage.setItem(ULTIMA_PASTA(app), r.pasta);
  return r ? { pasta: r.pasta, nome: r.nome } : null;
}

/**
 * Escolhe um arquivo do cofre pelo explorador (ex.: peça a inserir, modelo do desenho).
 * `exts`: tipos aceitos (o filtro "Todos os arquivos" mostra os outros, sem aceitá-los).
 */
export async function escolherDoCofre(app: ChaveApp, titulo: string, exts: string[], rotuloFiltro: string, botao = "Escolher"): Promise<Arquivo | null> {
  for (;;) {
    const r = await explorarCofre({ titulo, modo: "abrir", exts, rotuloFiltro, inicio: await pastaInicial(app), botao });
    if (!r?.arquivo) return null;
    localStorage.setItem(ULTIMA_PASTA(app), r.pasta);
    if (exts.includes(extensao(r.arquivo.nome))) return r.arquivo;
    alert(`${r.arquivo.nome} não serve aqui (aceitos: ${exts.map((e) => `.${e}`).join(", ")}).`);
  }
}

/**
 * Salva o documento do app no cofre, no dispositivo. Arquivo ligado: atualiza a cópia de trabalho
 * (faz o GO-OUT se o arquivo estiver livre). Primeira vez: pergunta a pasta do cofre e o nome; o
 * arquivo entra em GO-OUT e já publica a versão 1; todo salvar vai também para as cópias do cofre.
 */
export interface ExtrasSalvar {
  /** o que o arquivo usa (componentes da montagem, modelo do desenho): tabela de referências */
  referencias?: Omit<ReferenciaArquivo, "id" | "pai" | "mod">[];
  /** dados do modelo (tipo, configurações, material, massa, volume) */
  modelo?: DadosModelo;
  /**
   * Grava neste arquivo do cofre (ex.: peça alterada dentro da montagem), sem trocar o vínculo
   * do app (a página da Peça continua ligada ao documento dela). Arquivo travado em GO-OUT por
   * outra pessoa, ou que não existe mais: não grava e devolve o motivo (nunca pergunta pasta).
   */
  arquivo?: string;
}

export async function salvarNoCofre(app: ChaveApp, nomeArquivo: string, dados: Blob, renomear?: (nome: string) => void, extras: ExtrasSalvar = {}): Promise<string> {
  const db = await abrirCofre();
  const usuario = await usuarioDo(db);
  const alvo = extras.arquivo ?? vinculo(app);
  let a = alvo ? await db.ler<Arquivo>("arquivos", alvo) : undefined;
  if (extras.arquivo) {
    if (!a || a.lixeira) return `${nomeArquivo}: não salvo (o arquivo não está mais no cofre).`;
    const b = a.checkout?.usuario !== usuario ? bloqueioDoCheckout(a, usuario) : null;
    if (b) return `${a.nome}: não salvo (${b})`;
  }
  let aviso = "";
  if (a?.lixeira) a = undefined;
  if (a && a.checkout?.usuario !== usuario) {
    const b = bloqueioDoCheckout(a, usuario);
    if (b) {
      aviso = ` (${a.nome}: ${b} Salve como arquivo novo.)`;
      a = undefined;
    }
  }
  let local: { pasta: string; nome: string } | null = null;
  let primeiro = false;
  if (!a) {
    local = await escolherLocal(app, nomeArquivo);
    if (!local) return "Salvamento cancelado.";
  }
  const t = agora();
  const blob = uid();
  await db.porBlob(blob, dados);
  if (a) {
    if (a.checkout?.usuario !== usuario) {
      a.checkout = { usuario, data: t };
      a.historico.push({ data: t, usuario, texto: `GO-OUT (ao salvar no ${NOME_APP[app]})` });
    }
    let velho = a.trabalho?.blob;
    if (a.soLocal && a.versoes.length === 1) {
      // nunca publicado: o conteúdo novo substitui a versão 1 (o primeiro GO-IN publica a versão 1)
      velho = a.versoes[0].blob;
      a.versoes[0] = { ...a.versoes[0], blob, tamanho: dados.size, data: t };
      a.trabalho = undefined;
    } else a.trabalho = { blob, tamanho: dados.size, data: t, autor: usuario };
    // renomeado no app: o arquivo do cofre acompanha (sem repetir nome na pasta)
    if (a.nome !== nomeArquivo && !extras.arquivo) {
      const irmaos = (await db.todos<Arquivo>("arquivos")).filter((x) => x.pasta === a!.pasta && x.id !== a!.id && !x.lixeira).map((x) => x.nome);
      a.nome = nomeLivre(nomeArquivo, irmaos);
    }
    a.mod = t;
    await db.por("arquivos", a);
    if (velho && velho !== a.trabalho?.blob && !a.versoes.some((v) => v.blob === velho)) await db.apagar("blobs", velho);
  } else {
    const irmaos = (await db.todos<Arquivo>("arquivos")).filter((x) => x.pasta === local!.pasta && !x.lixeira).map((x) => x.nome);
    const nome = nomeLivre(local!.nome, irmaos);
    a = {
      id: uid(), nome, pasta: local!.pasta, revisao: "", estado: fluxoAtual().inicial, cartao: { descricao: nome.replace(/\.[^.]+$/, ""), projetista: usuario },
      checkout: { usuario, data: t }, mod: t,
      versoes: [{ n: 1, blob, tamanho: dados.size, autor: usuario, data: t, comentario: `Criado no ${NOME_APP[app]}`, revisao: "", estado: fluxoAtual().inicial }],
      historico: [{ data: t, usuario, texto: `Criado no ${NOME_APP[app]}: versão 1 publicada (GO-IN automático), segue em GO-OUT` }],
    };
    primeiro = true;
    await db.por("arquivos", a);
    // o documento aberto passa a ter o nome escolhido (senão o próximo salvar renomearia de volta)
    if (nome !== nomeArquivo) renomear?.(nome.replace(/\.[^.]+$/, ""));
  }
  if (extras.modelo) {
    a.modelo = extras.modelo;
    // material do CAD preenche o cartão vazio
    if (extras.modelo.material && !a.cartao.material) a.cartao.material = extras.modelo.material;
    await db.por("arquivos", a);
  }
  if (extras.referencias) await gravarReferencias(db, a.id, extras.referencias);
  if (!extras.arquivo) ligar(app, a.id);
  avisarMudanca();
  // todo salvar vai para todas as cópias (06/11/2026): abre em qualquer aparelho. Os arquivos
  // visíveis do pendrive/Drive só mudam no GO-IN (o primeiro salvar já publica a versão 1)
  const sinc = await sincronizarCofre({ pedir: true, publicar: true });
  const onde = caminhoDaPasta(await db.todos<Pasta>("pastas"), a.pasta);
  const destino = ondeChegou(sinc);
  if (destino.faltou) faixaConexoes(sinc); // fica à vista até chegar (tenta de novo sozinho)
  const caminho = `${onde ? `${onde}/` : ""}${a.nome}`;
  if (primeiro) return `✓ Salvo e publicado (versão 1): ${caminho}. ${destino.texto} Segue em GO-OUT com você; o GO-IN publica as próximas versões.${aviso}`;
  return `✓ Salvo: ${caminho} (cópia de trabalho, em GO-OUT). ${destino.texto} O GO-IN publica a versão.${aviso}`;
}

/** Onde o último salvar chegou (pela situação das cópias na sincronia que acabou de rodar). */
function ondeChegou(sinc: string): { texto: string; faltou: boolean } {
  const s = situacaoDasCopias();
  const chegou = ["este aparelho", ...ROTULO_COPIA.filter(([k]) => s[k] === "ok").map(([, r]) => r)];
  const faltou = ROTULO_COPIA.filter(([k]) => s[k] === "toque" || s[k] === "desconectado" || s[k] === "offline").map(([, r]) => r);
  let texto = `Chegou em: ${chegou.join(", ")}.`;
  if (faltou.length) texto += ` ⚠ Ainda NÃO chegou em: ${faltou.join(", ")} — vai sozinho quando a conexão voltar (ou toque em Conectar agora).`;
  else if (s.drive === "nao") texto += " Google Drive não conectado: para abrir em outros aparelhos, conecte em Cópias do cofre.";
  if (/conflito/.test(sinc)) texto += ` ${sinc}`;
  return { texto, faltou: faltou.length > 0 };
}

/** Troca as referências do arquivo (montagem/desenho) na tabela; as que saíram viram exclusão. */
async function gravarReferencias(db: Armazem, pai: string, novas: Omit<ReferenciaArquivo, "id" | "pai" | "mod">[]) {
  const t = agora();
  const { gravar, sair } = trocarReferencias(await db.todos<ReferenciaArquivo>("referencias"), pai, novas, t);
  for (const r of gravar) await db.por("referencias", r);
  for (const id of sair) {
    await db.apagar("referencias", id);
    await db.por("exclusoes", { id, tipo: "referencia", data: t } as { id: string });
  }
}

/** Arquivos do cofre com estas extensões (fora da lixeira), mais recentes primeiro, com o caminho. */
export async function documentosDoCofre(exts: string[]): Promise<{ arquivo: Arquivo; caminho: string }[]> {
  const db = await abrirCofre();
  usarFluxo((await db.ler<MetaCofre>("meta", "meta"))?.fluxo);
  const ps = await db.todos<Pasta>("pastas");
  return (await db.todos<Arquivo>("arquivos"))
    .filter((a) => !a.lixeira && exts.includes(extensao(a.nome)))
    .sort((a, b) => (b.mod ?? "").localeCompare(a.mod ?? ""))
    .map((arquivo) => ({ arquivo, caminho: caminhoDaPasta(ps, arquivo.pasta) || "(raiz)" }));
}

/** Conteúdo atual de um arquivo do cofre (cópia de trabalho ou última versão). */
export async function lerDoCofre(id: string): Promise<{ arquivo: Arquivo; texto: string; versao: number } | null> {
  const db = await abrirCofre();
  const a = await db.ler<Arquivo>("arquivos", id);
  if (!a || a.lixeira) return null;
  const blob = a.trabalho?.blob ?? a.versoes[a.versoes.length - 1]?.blob;
  const b = blob ? await db.blob(blob) : undefined;
  if (!b) return null;
  return { arquivo: a, texto: await b.text(), versao: a.versoes[a.versoes.length - 1]?.n ?? 1 };
}

/** Referências da tabela: o que o arquivo contém e onde ele é usado. */
export async function referenciasDe(id: string): Promise<{ contem: ReferenciaArquivo[]; usadoEm: ReferenciaArquivo[] }> {
  const rs = await (await abrirCofre()).todos<ReferenciaArquivo>("referencias");
  return { contem: rs.filter((r) => r.pai === id), usadoEm: rs.filter((r) => r.filho === id) };
}

// ---------- GO-OUT / GO-IN (painel lateral e WJPDM) ----------

const ouvintes = new Set<() => void>();
/** Avisa os painéis abertos que o cofre mudou. */
function avisarMudanca() {
  for (const f of ouvintes) f();
}

/** GO-OUT: retira o arquivo para editar (trava com o seu nome). */
export async function goOut(id: string): Promise<string> {
  const db = await abrirCofre();
  const usuario = await usuarioDo(db);
  const a = await db.ler<Arquivo>("arquivos", id);
  if (!a) return "Arquivo não encontrado no cofre.";
  const b = bloqueioDoCheckout(a, usuario);
  if (b) return b;
  const t = agora();
  a.checkout = { usuario, data: t };
  a.historico.push({ data: t, usuario, texto: "GO-OUT" });
  a.mod = t;
  await db.por("arquivos", a);
  avisarMudanca();
  await sincronizarCofre({ pedir: true, publicar: false });
  return `${a.nome} em GO-OUT com você.`;
}

/**
 * GO-IN: a cópia de trabalho vira a próxima versão (uma cópia do arquivo, sem comentário), o
 * arquivo nunca publicado ganha a versão e tudo aparece publicado no pendrive e no Drive. `manter`:
 * continua em GO-OUT. `renovacao`: pedida no toque (janela do Google).
 */
export async function goIn(ids: string[], manter: boolean, renovacao?: Promise<boolean>): Promise<string> {
  renovacao ??= renovarNuvem(true);
  const db = await abrirCofre();
  const usuario = await usuarioDo(db);
  const feitos: string[] = [], recusados: string[] = [];
  for (const id of ids) {
    const a = await db.ler<Arquivo>("arquivos", id);
    if (!a) continue;
    if (a.checkout?.usuario !== usuario) {
      recusados.push(`${a.nome} (${a.checkout ? `GO-OUT de ${a.checkout.usuario}` : "não está em GO-OUT"})`);
      continue;
    }
    const t = agora();
    if (a.trabalho) {
      const n = a.versoes[a.versoes.length - 1].n + 1;
      a.versoes.push({ n, blob: a.trabalho.blob, tamanho: a.trabalho.tamanho, autor: usuario, data: t, comentario: "", revisao: a.revisao, estado: a.estado });
      a.historico.push({ data: t, usuario, texto: `Versão ${n}` });
      a.trabalho = undefined;
    }
    if (a.soLocal) a.historico.push({ data: t, usuario, texto: "Publicado (primeiro GO-IN)" });
    a.soLocal = undefined;
    if (!manter) {
      delete a.checkout;
      a.historico.push({ data: t, usuario, texto: "GO-IN" });
    }
    a.mod = t;
    await db.por("arquivos", a);
    feitos.push(a.nome);
  }
  avisarMudanca();
  const sinc = feitos.length ? await sincronizarCofre({ pedir: true, publicar: true, renovacao }) : "";
  avisarMudanca();
  return [feitos.length ? `GO-IN: ${feitos.join(", ")}. ${sinc}` : "", recusados.length ? `Sem GO-IN: ${recusados.join("; ")}.` : ""].filter(Boolean).join(" ");
}

/** Desfaz o GO-OUT: descarta a cópia de trabalho (o arquivo volta à última versão publicada). */
export async function desfazerGoOut(id: string): Promise<string> {
  const db = await abrirCofre();
  const usuario = await usuarioDo(db);
  const a = await db.ler<Arquivo>("arquivos", id);
  if (!a?.checkout) return "O arquivo não está em GO-OUT.";
  if (a.checkout.usuario !== usuario) return `O GO-OUT é de ${a.checkout.usuario}.`;
  if (a.soLocal) return "Arquivo novo (nunca publicado): faça o GO-IN para publicar ou exclua-o no WJPDM.";
  const t = agora();
  if (a.trabalho) await db.apagar("blobs", a.trabalho.blob);
  a.trabalho = undefined;
  delete a.checkout;
  a.historico.push({ data: t, usuario, texto: "GO-OUT desfeito (cópia de trabalho descartada)" });
  a.mod = t;
  await db.por("arquivos", a);
  avisarMudanca();
  await sincronizarCofre({ pedir: true, publicar: false });
  return `GO-OUT de ${a.nome} desfeito: voltou à versão ${a.versoes[a.versoes.length - 1].n}.`;
}

/** Abre um arquivo do cofre no app (grava o salvamento automático do app e recarrega a página). */
export async function abrirArquivoNoApp(a: Arquivo, db?: Armazem, novaJanela = false): Promise<string | null> {
  const app = APPS[extensao(a.nome)];
  if (!app) return "Este arquivo não abre em nenhum app do WJProMaster.";
  db ??= await abrirCofre();
  const blob = a.trabalho?.blob ?? a.versoes[a.versoes.length - 1]?.blob;
  const b = blob ? await db.blob(blob) : undefined;
  if (!b) return "Conteúdo não encontrado no cofre.";
  let texto = await b.text();
  try {
    const d = JSON.parse(texto);
    d.nome = a.nome.replace(/\.[^.]+$/, "");
    texto = JSON.stringify(d);
  } catch {
    return `O arquivo não é um documento válido do ${app.app}.`;
  }
  localStorage.setItem(app.chave, texto);
  const destino = new URL(`${import.meta.env.BASE_URL}${app.url}`, location.href);
  if (novaJanela) {
    // a janela atual continua com o documento dela; a nova lê o comum (documento e vínculo)
    ligarParaOutraJanela(app.face, a.id);
    abrirEmNovaJanela(destino.href);
    return null;
  }
  ligar(app.face, a.id);
  if (destino.pathname === location.pathname) {
    // já está no app: troca o endereço e recarrega (só o "#" não recarregaria)
    history.replaceState(null, "", destino.href);
    location.reload();
  } else location.href = destino.href;
  return null;
}

// ---------- janelas ----------

const CSS = `
.wjc-fundo{position:fixed;inset:0;z-index:1000;display:grid;place-items:center;background:rgba(20,30,40,.35);padding:12px}
.wjc-janela{width:min(600px,100%);max-height:calc(100% - 24px);overflow:auto;background:#fff;color:#1d2733;border-radius:12px;box-shadow:0 10px 40px rgba(0,0,0,.25);font:15px system-ui,sans-serif}
.wjc-janela header{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid #dfe5ec;font-weight:700}
.wjc-janela section{padding:12px 16px;border-bottom:1px solid #eef1f5}
.wjc-janela h3{margin:0 0 4px;font-size:15px}
.wjc-janela p{margin:4px 0 8px;color:#55606d;font-size:13px}
.wjc-botoes{display:flex;flex-wrap:wrap;gap:8px}
.wjc-janela button{min-height:44px;padding:0 14px;border:1px solid #c9d3de;border-radius:8px;background:#f6f8fa;font:inherit;cursor:pointer}
.wjc-janela button.destaque{background:#2f7fd0;border-color:#2f7fd0;color:#fff}
.wjc-ok{color:#24883f;font-weight:600}.wjc-nao{color:#b3401f;font-weight:600}
.wjc-lista{list-style:none;margin:0;padding:0}
.wjc-lista li button{width:100%;display:flex;justify-content:space-between;gap:8px;text-align:left;border:0;border-bottom:1px solid #eef1f5;border-radius:0;background:#fff}
.wjc-lista small{color:#55606d}
.wjc-janela footer{display:flex;justify-content:flex-end;gap:8px;padding:12px 16px}
.wjc-arvore{max-height:40vh;overflow:auto;border:1px solid #dfe5ec;border-radius:8px}
.wjc-arvore li button{justify-content:flex-start}
.wjc-arvore li button.sel{background:#e3effb;font-weight:600}
.wjc-nome{display:flex;align-items:center;gap:6px}.wjc-nome input{flex:1;min-height:44px;padding:0 10px;border:1px solid #c9d3de;border-radius:8px;font:inherit}
.wjc-aba{position:fixed;right:0;top:calc(50% - 48px);z-index:900;width:30px;min-height:96px;padding:8px 0;border:1px solid #c9d3de;border-right:0;border-radius:10px 0 0 10px;background:#fff;color:#1d2733;font:600 13px system-ui,sans-serif;writing-mode:vertical-rl;cursor:pointer;box-shadow:-2px 2px 8px rgba(0,0,0,.12)}
.wjc-aba b{display:inline-block;margin-top:6px;min-width:18px;border-radius:9px;background:#c98a12;color:#fff;writing-mode:horizontal-tb;font-size:11px;padding:1px 4px}
body.disp-celular .wjc-aba{width:26px;min-height:72px;font-size:12px}
.wjc-gaveta{position:fixed;inset:0;z-index:950}
.wjc-painel{position:absolute;right:0;top:0;bottom:0;width:min(380px,100%);overflow:auto;background:#fff;color:#1d2733;box-shadow:-6px 0 24px rgba(0,0,0,.2);font:14px system-ui,sans-serif}
.wjc-painel header{position:sticky;top:0;background:#fff;display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border-bottom:1px solid #dfe5ec;font-weight:700;font-size:15px}
.wjc-painel section{padding:10px 14px;border-bottom:1px solid #eef1f5}
.wjc-painel h3{margin:0 0 6px;font-size:14px}
.wjc-painel p{margin:4px 0;color:#55606d;font-size:13px}
.wjc-painel dl{display:grid;grid-template-columns:auto 1fr;gap:3px 10px;margin:0 0 8px}.wjc-painel dt{color:#55606d}.wjc-painel dd{margin:0;font-weight:600;overflow-wrap:anywhere}
.wjc-painel button{min-height:44px;padding:0 12px;border:1px solid #c9d3de;border-radius:8px;background:#f6f8fa;font:inherit;cursor:pointer}
.wjc-painel button.destaque{background:#2f7fd0;border-color:#2f7fd0;color:#fff}
.wjc-painel button:disabled{opacity:.45;cursor:default}
.wjc-painel input[type=text]{width:100%;box-sizing:border-box;min-height:40px;margin:4px 0;padding:0 10px;border:1px solid #c9d3de;border-radius:8px;font:inherit}
.wjc-tag{display:inline-block;padding:1px 6px;border-radius:9px;background:#fff3dc;color:#8a5a00;font-size:11px;font-weight:600}
.wjc-go{list-style:none;margin:6px 0;padding:0}
.wjc-go li{display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid #eef1f5}
.wjc-go li input{width:22px;height:22px}.wjc-go li span{flex:1;min-width:0;overflow-wrap:anywhere}.wjc-go small{color:#55606d}
.wjc-msg{min-height:1em}
.wjc-faixa{position:fixed;left:50%;top:calc(8px + env(safe-area-inset-top));transform:translateX(-50%);z-index:980;display:flex;align-items:center;gap:8px;width:min(720px,calc(100% - 16px));padding:8px 8px 8px 14px;background:#fff8e6;color:#4a3500;border:1px solid #e0b44a;border-radius:10px;box-shadow:0 4px 16px rgba(0,0,0,.18);font:14px system-ui,sans-serif}
.wjc-faixa span{flex:1;min-width:0}
.wjc-faixa button{flex:none;min-height:40px;padding:0 12px;border:1px solid #c9d3de;border-radius:8px;background:#fff;font:inherit;cursor:pointer}
.wjc-faixa button.destaque{background:#2f7fd0;border-color:#2f7fd0;color:#fff}
.wjc-faixa.ok{background:#eef8f0;border-color:#9fd1ab;color:#1f4d2b}
.wjc-cops{display:flex;flex-wrap:wrap;align-items:center;gap:4px 10px}.wjc-cops small{flex-basis:100%;color:#6b5a2a}
.wjc-cop{font-style:normal;white-space:nowrap;padding:2px 8px;border-radius:12px;background:#fff;border:1px solid #d7dde4}
.wjc-cop.ok{color:#1e7d34;border-color:#9fd1ab}.wjc-cop.toque{color:#8a5a00;border-color:#e0b44a;background:#fff3dc}
.wjc-cop.desconectado,.wjc-cop.offline{color:#b3261e;border-color:#e6a49e;background:#fdecea}.wjc-cop.nao{color:#7a8590}
.wjc-explorador{width:min(880px,100%)}
.wje-barra{display:flex;align-items:center;gap:6px;padding:8px 12px;border-bottom:1px solid #dfe5ec;flex-wrap:wrap}
.wjc-janela .wje-barra>button{min-width:44px;padding:0 10px}
.wjc-janela .wje-barra>button:disabled{opacity:.4;cursor:default}
.wje-trilha{flex:1;min-width:160px;display:flex;align-items:center;flex-wrap:wrap;gap:2px;padding:2px 6px;border:1px solid #dfe5ec;border-radius:8px;background:#fafbfc}
.wjc-janela .wje-trilha button{min-height:36px;padding:0 6px;border:0;background:none;font-weight:500}
.wjc-janela .wje-trilha button[aria-current]{font-weight:700}
.wje-trilha span{color:#8a96a3}
.wje-nova{display:flex;align-items:center;gap:8px;padding:8px 12px;background:#fffbea;border-bottom:1px solid #f0e2a8}
.wje-nova input{flex:1;min-height:40px;padding:0 10px;border:1px solid #c9d3de;border-radius:8px;font:inherit}
.wje-cab,.wje-lista li{display:grid;grid-template-columns:minmax(0,1fr) 140px 170px;align-items:center;gap:8px;padding:0 12px}
.wje-cab{min-height:30px;font-size:12px;font-weight:600;color:#55606d;border-bottom:1px solid #dfe5ec;background:#f6f8fa}
.wje-lista{list-style:none;margin:0;padding:0;height:min(36vh,380px);overflow:auto}
.wje-lista li{min-height:44px;border-bottom:1px solid #f0f2f5;cursor:default;user-select:none;-webkit-user-select:none;touch-action:manipulation}
.wje-lista li:hover{background:#f3f8fd}.wje-lista li.sel{background:#d8e9fa}.wje-lista li:focus{outline:2px solid #2f7fd0;outline-offset:-2px}
.wje-lista li.outro{color:#7a8590}.wje-lista li.vazia{display:block;padding:20px 12px;color:#7a8590;text-align:center}
.wje-n{display:flex;align-items:center;gap:10px;min-width:0}.wje-n svg{flex:none}.wje-n span{min-width:0;overflow-wrap:anywhere}
.wje-n small{display:block;font-size:11px;color:#8a5a00}
.wje-d,.wje-t{font-size:13px;color:#55606d;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.wje-rodape{padding:10px 12px;border-top:1px solid #dfe5ec;display:flex;flex-direction:column;gap:8px}
.wje-rodape .wjc-nome span,.wje-filtro span{min-width:120px;font-size:13px;color:#55606d}
.wje-filtro{display:flex;align-items:center;gap:6px}.wje-filtro select{flex:1;min-height:40px;font:inherit;padding:0 8px;border:1px solid #c9d3de;border-radius:8px;background:#fff}
.wje-rodape p{margin:0;font-size:13px;color:#55606d}.wje-msg:empty{display:none}
body.disp-celular .wje-cab,body.disp-celular .wje-lista li{grid-template-columns:minmax(0,1fr)}
body.disp-celular .wje-d,body.disp-celular .wje-t{display:none}
@media (max-width:600px){.wje-cab,.wje-lista li{grid-template-columns:minmax(0,1fr) 110px}.wje-t{display:none}}`;

function janela(titulo: string): { caixa: HTMLElement; fechar: () => void } {
  if (!document.getElementById("wjc-css")) document.head.append(Object.assign(document.createElement("style"), { id: "wjc-css", textContent: CSS }));
  const fundo = document.createElement("div");
  fundo.className = "wjc-fundo";
  fundo.innerHTML = `<div class="wjc-janela" role="dialog" aria-modal="true"><header><span></span><button data-fechar title="Fechar">✕</button></header><div data-corpo></div></div>`;
  fundo.querySelector("header span")!.textContent = titulo;
  const fechar = () => fundo.remove();
  fundo.addEventListener("pointerdown", (e) => e.target === fundo && fechar());
  fundo.addEventListener("keydown", (e) => e.key === "Escape" && fechar());
  fundo.querySelector<HTMLElement>("[data-fechar]")!.onclick = fechar;
  document.body.append(fundo);
  return { caixa: fundo.querySelector<HTMLElement>("[data-corpo]")!, fechar };
}
const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const quando = (s: string) => `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)} ${s.slice(11, 16)}`;

/** Pastas que cada app grava na raiz escolhida (o cofre e as pastas irmãs dele). */
const PASTAS_DOS_APPS = ["WJPDM", "WJTaskPlan"];
const DISPOSITIVOS: [string, string][] = [["celular", "Celular"], ["tablet", "Tablet"], ["computador", "Computador"]];

/**
 * Tela "Cópias do cofre": pendrive, pasta do tablet, Google Drive e sincronizar agora.
 * `mestre`: configurações gerais do WJProMaster (página inicial, ⚙): também o perfil do
 * dispositivo e as pastas de todos os apps dentro de cada cópia.
 */
export async function abrirCopias(aoSincronizar?: () => void, mestre = false) {
  const { caixa, fechar } = janela(mestre ? "Configurações do WJProMaster" : "Cópias do cofre (WJPDM)");
  const lerPrefs = (): Record<string, unknown> => {
    try {
      return JSON.parse(localStorage.getItem("jlscad:interface") ?? "{}");
    } catch {
      return {};
    }
  };
  const pastas = (raiz: string) => PASTAS_DOS_APPS.map((p) => `<code>${esc(raiz)}/${p}</code>`).join(" e ");
  const desenhar = async (msg = "") => {
    const pen = await pastaDa("pendrive"), tab = await pastaDa("tablet");
    const sitPen = pen ? ((await permissao(pen, false).catch(() => false)) ? "conectado" : "toque Sincronizar para permitir o acesso") : "";
    const disp = String(lerPrefs().dispositivo ?? (matchMedia("(pointer: coarse)").matches ? (Math.min(screen.width, screen.height) < 600 ? "celular" : "tablet") : "computador"));
    caixa.innerHTML = `
      ${mestre ? `<section><h3>Dispositivo</h3><p>Adapta todos os apps ao aparelho: celular (ícones sem texto, painéis em gaveta), tablet (caneta e dedo, alvos grandes) ou computador (mouse e atalhos).</p>
        <div class="wjc-botoes"><select data-disp aria-label="Perfil do dispositivo" style="min-height:40px;min-width:200px;font:inherit;padding:4px 8px;border:1px solid #c9d2dc;border-radius:8px">${DISPOSITIVOS.map(([v, r]) => `<option value="${v}"${v === disp ? " selected" : ""}>${r}</option>`).join("")}</select></div></section>
      <section><h3>Onde ficam os dados</h3><p>Em cada cópia abaixo (pasta padrão do dispositivo, pendrive e Google Drive), os apps gravam na mesma estrutura: <b>WJPDM/</b> (cofre com os arquivos de todos os apps: peças, montagens, desenhos, planilhas, documentos…) e <b>WJTaskPlan/</b> (tarefas). O navegador informa só o nome da pasta escolhida, não o caminho completo.</p></section>` : ""}
      <section><p>Todos os arquivos dos apps ficam no cofre do WJPDM. <b>Salvar</b> grava no dispositivo (banco do app e pasta padrão do dispositivo), em GO-OUT. <b>GO-IN</b> publica no pendrive e no Google Drive, que recebem só o que passou por GO-IN. Entre as cópias, a alteração mais recente vence (a outra vai para a lixeira).</p></section>
      <section><h3>Pendrive</h3>
        <p>${pen ? `Pasta: ${pastas(pen.name)} (${sitPen})` : "Nenhum pendrive escolhido."} Conecte o pendrive (USB-C no tablet) e escolha a pasta raiz dele: o cofre fica em WJPDM/.</p>
        <div class="wjc-botoes">${temPastas() ? `<button data-b="pen" class="destaque">Escolher pendrive…</button>${pen ? `<button data-b="tirarPen">Remover</button>` : ""}` : "<span class='wjc-nao'>Este navegador não permite escolher pastas: use o Chrome atualizado.</span>"}</div></section>
      <section><h3>Pasta padrão do dispositivo</h3>
        <p>${tab ? `Pasta: ${pastas(tab.name)}` : "Nenhuma pasta escolhida: escolha uma pasta do aparelho (ex.: Documentos)."}</p>
        ${temPastas() ? `<div class="wjc-botoes"><button data-b="tab">${tab ? "Trocar pasta…" : "Escolher pasta…"}</button></div>` : ""}</section>
      <section><h3>Google Drive</h3><p>${nuvem ? esc(nuvem.situacao()) : "Aguardando a configuração do acesso ao Google (cliente OAuth)."}${mestre ? ` Pastas: ${pastas("Meu Drive")}.` : ""}</p>
        ${nuvem && !nuvem.conectado() ? `<div class="wjc-botoes"><button data-b="drive" class="destaque">${localStorage.getItem("wjgoogle:autorizado") === "1" ? "Reconectar" : "Conectar ao Google Drive"}</button></div>` : ""}</section>
      <section><div class="wjc-botoes"><button data-b="sinc" class="destaque">Sincronizar agora</button></div>
        <p data-r class="${/desconectado|não encontrado|sem permissão|vencido|recusou|não liberou/.test(msg) ? "wjc-nao" : msg ? "wjc-ok" : ""}">${esc(msg || (ultima ? `Última: ${quando(ultima.quando)} — ${ultima.texto}` : ""))}</p></section>
      <footer><button data-b="fechar" class="destaque">Fechar</button></footer>`;
    const escolher = async (c: Copia) => {
      try {
        const p = await (window as Janela).showDirectoryPicker!({ id: `wjpdm-${c}`, mode: "readwrite", startIn: c === "tablet" ? "documents" : undefined });
        await guardarPasta(c, p);
      } catch {
        return desenhar();
      }
      await desenhar("Sincronizando…");
      await desenhar(await sincronizarCofre({ publicar: true }));
      aoSincronizar?.();
    };
    const acoes: Record<string, () => Promise<void> | void> = {
      fechar,
      pen: () => escolher("pendrive"),
      tab: () => escolher("tablet"),
      tirarPen: async () => {
        await guardarPasta("pendrive", null);
        await desenhar();
      },
      drive: async () => {
        try {
          await nuvem?.conectar();
        } catch (e) {
          return desenhar((e as Error).message);
        }
        await desenhar("Conectado ao Google Drive. Sincronizando…");
        await desenhar(await sincronizarCofre({ pedir: false, publicar: true }));
        aoSincronizar?.();
      },
      sinc: async () => {
        const renovacao = renovarNuvem(true);
        caixa.querySelector<HTMLElement>("[data-r]")!.textContent = "Sincronizando…";
        await desenhar(await sincronizarCofre({ publicar: true, renovacao }));
        aoSincronizar?.();
      },
    };
    caixa.querySelectorAll<HTMLButtonElement>("[data-b]").forEach((b) => (b.onclick = () => void acoes[b.dataset.b!]?.()));
    const sel = caixa.querySelector<HTMLSelectElement>("[data-disp]");
    if (sel)
      sel.onchange = () => {
        const p = lerPrefs();
        p.dispositivo = sel.value;
        localStorage.setItem("jlscad:interface", JSON.stringify(p));
      };
  };
  await desenhar();
}

/**
 * Abrir do cofre: explorador na última pasta usada (pastas e arquivos; duplo clique entra/abre).
 * Arquivo de outro app (filtro "Todos os arquivos") abre no app dele. `novaJanela`: o app já tem
 * um documento aberto — o escolhido abre noutra janela.
 */
export async function abrirDoCofre(app: ChaveApp, novaJanela = false) {
  const r = await explorarCofre({ titulo: `Abrir do cofre — ${NOME_APP[app]}`, modo: "abrir", exts: EXT_DA_FACE[app], rotuloFiltro: filtroDaFace(app), inicio: await pastaInicial(app) });
  if (!r?.arquivo) return;
  localStorage.setItem(ULTIMA_PASTA(app), r.pasta);
  const erro = await abrirArquivoNoApp(r.arquivo, await abrirCofre(), novaJanela);
  if (erro) alert(erro);
}

// ---------- painel lateral do cofre (GO-OUT / GO-IN em cada app) ----------

/**
 * Aba fixa na lateral direita do app que abre o painel do cofre: dados do documento aberto
 * (pasta, estado, revisão, versão, GO-OUT), botões GO-OUT / GO-IN / Desfazer GO-OUT e a lista de
 * todos os seus arquivos em GO-OUT (de todos os apps) para publicar. `salvar` grava o documento
 * aberto antes do GO-IN dele.
 */
export function instalarPainelCofre(app: ChaveApp, salvar: () => Promise<unknown>) {
  if (!document.getElementById("wjc-css")) document.head.append(Object.assign(document.createElement("style"), { id: "wjc-css", textContent: CSS }));
  const aba = document.createElement("button");
  aba.className = "wjc-aba";
  aba.title = "Cofre: GO-OUT / GO-IN e arquivos em GO-OUT";
  document.body.append(aba);
  let gaveta: HTMLElement | null = null;
  let msg = "";
  let ocupado = false;

  const meusGoOut = async (db: Armazem) => {
    const usuario = await usuarioDo(db);
    return { usuario, lista: (await db.todos<Arquivo>("arquivos")).filter((a) => !a.lixeira && a.checkout?.usuario === usuario).sort((a, b) => (b.mod ?? "").localeCompare(a.mod ?? "")) };
  };
  const contar = async () => {
    const n = (await meusGoOut(await abrirCofre())).lista.length;
    aba.innerHTML = `Cofre${n ? `<b>${n}</b>` : ""}`;
  };

  const desenhar = async () => {
    if (!gaveta) return;
    const db = await abrirCofre();
    const { usuario, lista } = await meusGoOut(db);
    const ps = await db.todos<Pasta>("pastas");
    const id = vinculo(app);
    const a = id ? await db.ler<Arquivo>("arquivos", id) : undefined;
    const atual = a && !a.lixeira ? a : undefined;
    const ultimaV = atual?.versoes[atual.versoes.length - 1];
    const meu = atual?.checkout?.usuario === usuario;
    const onde = (x: Arquivo) => caminhoDaPasta(ps, x.pasta) || "(raiz)";
    const appDe = (x: Arquivo) => APPS[extensao(x.nome)]?.app ?? extensao(x.nome).toUpperCase();
    // o painel pode ter sido fechado enquanto o banco respondia
    if (!gaveta) return;
    const corpo = gaveta.querySelector<HTMLElement>(".wjc-painel")!;
    corpo.innerHTML = `
      <header><span>Cofre — ${NOME_APP[app]}</span><button data-b="fechar" title="Fechar">✕</button></header>
      <section><h3>Documento aberto</h3>${atual ? `
        <dl><dt>Arquivo</dt><dd>${esc(atual.nome)}</dd>
          <dt>Pasta</dt><dd>${esc(onde(atual))}</dd>
          <dt>Estado</dt><dd style="color:${estadoDe(atual.estado).cor}">${esc(estadoDe(atual.estado).nome)}</dd>
          <dt>Revisão</dt><dd>${esc(atual.revisao || "—")}</dd>
          <dt>Versão</dt><dd>${atual.soLocal ? "nunca publicado" : `${ultimaV?.n ?? "—"}${ultimaV ? ` (${quando(ultimaV.data)})` : ""}`}</dd>
          <dt>GO-OUT</dt><dd>${atual.checkout ? (meu ? `com você desde ${quando(atual.checkout.data)}` : `com ${esc(atual.checkout.usuario)}`) : "livre (publicado)"}</dd>
          <dt>Trabalho</dt><dd>${atual.trabalho ? `salvo em ${quando(atual.trabalho.data)} (não publicado)` : atual.soLocal ? "nunca publicado" : "igual à última versão"}</dd></dl>
        ${atual.soLocal ? `<p><span class="wjc-tag">não publicado</span> já está nas cópias do cofre (abre em outros aparelhos); o GO-IN publica a versão.</p>` : ""}
        <div class="wjc-botoes">
          ${!atual.checkout ? `<button data-b="goout" class="destaque">GO-OUT</button>` : ""}
          ${meu ? `<button data-b="goin" class="destaque">GO-IN (publicar)</button>` : ""}
          ${meu && !atual.soLocal ? `<button data-b="desfazer">Desfazer GO-OUT</button>` : ""}
          <button data-b="salvar">Salvar</button>
        </div>
        ${meu ? `<label><input type="checkbox" data-manter /> Manter em GO-OUT depois do GO-IN</label>` : ""}`
      : `<p>Este documento ainda não está no cofre. Ao salvar, você escolhe a pasta: a versão 1 é publicada no dispositivo, no pendrive e no Drive e ele segue em GO-OUT com você.</p>
        <div class="wjc-botoes"><button data-b="salvar" class="destaque">Salvar no cofre…</button></div>`}
      </section>
      <section><h3>Meus arquivos em GO-OUT (${lista.length})</h3>
        ${lista.length ? `<ul class="wjc-go">${lista.map((x) => `<li><input type="checkbox" data-x="${x.id}" checked aria-label="Marcar ${esc(x.nome)}" /><span>${esc(x.nome)}${x.id === atual?.id ? " <small>(aberto)</small>" : ""}<br><small>${esc(appDe(x))} · ${esc(onde(x))}${x.trabalho ? ` · salvo ${quando(x.trabalho.data)}` : ""}</small> ${x.soLocal ? `<span class="wjc-tag">não publicado</span>` : ""}</span><button data-i="${x.id}">GO-IN</button></li>`).join("")}</ul>
          <div class="wjc-botoes"><button data-b="goinMarcados" class="destaque">GO-IN dos marcados</button></div>
          <p>O GO-IN cria a versão e publica no pendrive e no Google Drive.</p>`
        : "<p>Nenhum arquivo em GO-OUT com você.</p>"}
      </section>
      <section><p class="wjc-msg ${/desconectado|não encontrado|sem permissão|vencido|Sem GO-IN|Não foi|cancelado|Nenhuma cópia|conflito/.test(msg) ? "wjc-nao" : msg ? "wjc-ok" : ""}">${esc(msg || (ultima ? `Última sincronia: ${quando(ultima.quando)} — ${ultima.texto}` : ""))}</p>
        <div class="wjc-botoes"><button data-b="sinc">Sincronizar agora</button><button data-b="copias">Cópias do cofre…</button><button data-b="pdm">Abrir o WJPDM</button></div></section>`;

    const executar = async (f: () => Promise<unknown>) => {
      if (ocupado) return;
      ocupado = true;
      corpo.querySelectorAll("button").forEach((b) => b.dataset.b !== "fechar" && (b.disabled = true));
      corpo.querySelector<HTMLElement>(".wjc-msg")!.textContent = "Trabalhando…";
      try {
        const r = await f();
        msg = typeof r === "string" ? r : "";
      } catch (e) {
        msg = `Não foi possível: ${(e as Error).message}`;
      }
      ocupado = false;
      await desenhar();
      await contar();
    };
    /** GO-IN: a janela do Google precisa abrir no toque, antes de qualquer espera. */
    const publicar = (ids: string[]) => {
      const renovacao = renovarNuvem(true);
      const manter = !!corpo.querySelector<HTMLInputElement>("[data-manter]")?.checked;
      return executar(async () => {
        if (atual && ids.includes(atual.id)) await salvar(); // publica o que está na tela
        return goIn(ids, manter, renovacao);
      });
    };
    const acoes: Record<string, () => unknown> = {
      fechar: fecharPainel,
      salvar: () => executar(salvar),
      goout: () => atual && executar(() => goOut(atual.id)),
      goin: () => atual && publicar([atual.id]),
      desfazer: () => atual && confirm(`Desfazer o GO-OUT de ${atual.nome}? A cópia de trabalho é descartada e o arquivo volta à última versão publicada (o que está na tela não muda; salve de novo para retomar).`) && executar(() => desfazerGoOut(atual.id)),
      goinMarcados: () => {
        const ids = [...corpo.querySelectorAll<HTMLInputElement>("[data-x]:checked")].map((x) => x.dataset.x!);
        if (!ids.length) return void (msg = "Marque ao menos um arquivo.", desenhar());
        return publicar(ids);
      },
      sinc: () => {
        const renovacao = renovarNuvem(true); // janela do Google no toque
        return executar(() => sincronizarCofre({ publicar: true, renovacao }));
      },
      copias: () => void abrirCopias(() => void desenhar()),
      pdm: () => (location.href = new URL(`${import.meta.env.BASE_URL}pdm/`, location.href).href),
    };
    corpo.querySelectorAll<HTMLButtonElement>("[data-b]").forEach((b) => (b.onclick = () => void acoes[b.dataset.b!]?.()));
    corpo.querySelectorAll<HTMLButtonElement>("[data-i]").forEach((b) => (b.onclick = () => void publicar([b.dataset.i!])));
  };

  function fecharPainel() {
    gaveta?.remove();
    gaveta = null;
  }
  aba.onclick = () => {
    if (gaveta) return fecharPainel();
    gaveta = document.createElement("div");
    gaveta.className = "wjc-gaveta";
    gaveta.innerHTML = `<div class="wjc-painel" role="dialog" aria-label="Cofre"></div>`;
    gaveta.addEventListener("pointerdown", (e) => e.target === gaveta && fecharPainel());
    gaveta.addEventListener("keydown", (e) => e.key === "Escape" && fecharPainel());
    document.body.append(gaveta);
    msg = "";
    void desenhar();
  };
  const atualizar = () => {
    void contar();
    if (gaveta && !ocupado) void desenhar();
  };
  ouvintes.add(atualizar);
  addEventListener("focus", atualizar);
  document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && atualizar());
  void contar();
}
