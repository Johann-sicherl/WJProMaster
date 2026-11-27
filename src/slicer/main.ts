// WJSlicer3D: orçamento de tempo de impressão e de material por fatiamento real, sem gerar G-code e
// sem mandar para a impressora. Duas impressoras (P1S e Kobra 3, bico 0,4 mm, perfis de fábrica),
// várias peças na mesa com cópias, prévia das camadas, tempo por tipo de caminho e calibração do tempo
// por impressora. O fatiamento roda no worker (a tela do tablet não trava).
// Especificação em docs/global/wjslicer3d.md.

import "../comum/comum.css";
import "./slicer.css";
import { aplicarDispositivo, escapar, escolherArquivo, janela, menu } from "../comum/casca";
import { abrirDoCofre, escolherDoCofre, instalarPainelCofre, lerBytesDoCofre, salvarNoCofre, sincronizarAoAbrir } from "../comum/cofre";
import { botaoDiagnostico } from "../comum/diagnostico";
import { registrarComAtualizacao } from "../comum/atualizacao";
import { pegar } from "../comum/transferir";
import { ajustesDe, diferencas, diferencasDeAjustes, PERFIL_PADRAO, PERFIS_SISTEMA, perfilSistema, resolver } from "./camadas";
import type { Plano } from "./esquema";
import type { PerfilUsuario } from "./camadas";
import { empacotarPerfis, excluirPerfil, juntarPerfis, lerPerfis, novoPerfil, perfisAtivos, perfisVazios, salvarPerfil, sincronizarPerfis, type BibliotecaPerfis } from "./perfisUsuario";
import { pintarIcones } from "./icones";
import { ajustesPadrao, formatarTempo, NOMES_PARTES, PARTES, type Ajustes, type Parte, type Resultado } from "./fatiar";
import { MAQUINAS, maquinaPorId, materiaisDa, materialDa, NOMES_PADROES, type ConfigTroca, type IdMaterial, type Padrao, type TipoSuporte } from "./perfis";
import { balde, filamentosPadrao, MAX_CORES, pincel, pintarCorpo, topologia, type Filamento, type Topologia } from "./cores";
import { desempacotar, empacotar, EXTENSAO_PROJETO, type ProjetoSlicer } from "./projeto";
import { VistaMesa } from "./vista";
import { vistaIsometrica } from "./isometrica";
import { iniciarOrcamento } from "./orcamentoUi";
import type { PecaInfo, PedidoSlicer, RespostaSlicer } from "./worker";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const num = (x: number, casas = 0) => x.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });

// ---------- estado (lembrado no aparelho) ----------

interface Preferencias {
  maquina: string;
  material: IdMaterial;
  /** preço por material (R$/kg) */
  precos: Partial<Record<IdMaterial, number>>;
  ajustes: Ajustes;
  /** fator de calibração do tempo por impressora (tempo real ÷ estimado) */
  calibracao: Record<string, number>;
  /** cores e filamentos (o material e o preço do primeiro vêm de "Impressora e material") */
  filamentos: Filamento[];
  /** troca de cor editada por impressora (o que falta usa o de fábrica) */
  trocas: Record<string, Partial<ConfigTroca>>;
  /** perfil de processo escolhido: "s:<id>" (sistema) ou "u:<id>" (do usuário); o selo ↺ compara os ajustes com ele */
  perfil: string;
}
const CHAVE = "wjslicer:preferencias";

// ---------- perfis de processo (camadas.ts): o que a tela mostra no selo ↺ ----------

/** Os campos de processo que a tela edita hoje (suporte, borda e saia são do projeto: não entram no selo ↺). */
const CHAVES_PROCESSO = ["altura", "paredes", "topo", "fundo", "preenchimento", "padrao"] as const;
const planoProcesso = (a: Ajustes): Plano => Object.fromEntries(CHAVES_PROCESSO.map((k) => [k, a[k]]));
/** Perfil de sistema cujos valores batem com os ajustes (preferências e projetos antigos): o sem "Alta qualidade" primeiro. */
function adivinharPerfil(maquina: string, aj: Ajustes): string {
  const atual = planoProcesso(aj);
  const iguais = (id: string) => Object.keys(diferencas(planoProcesso(ajustesDe(resolver({ maquina, sistema: id }))), atual)).length === 0;
  const lista = [...PERFIS_SISTEMA].sort((a, b) => Number(a.altaQualidade) - Number(b.altaQualidade));
  return lista.find((p) => iguais(p.id))?.id ?? PERFIL_PADRAO;
}

function lerPreferencias(): Preferencias {
  const padrao: Preferencias = { maquina: MAQUINAS[0].id, material: "pla", precos: {}, ajustes: ajustesPadrao(MAQUINAS[0].processo), calibracao: {}, filamentos: filamentosPadrao(), trocas: {}, perfil: `s:${PERFIL_PADRAO}` };
  try {
    const p = JSON.parse(localStorage.getItem(CHAVE) ?? "null") as (Partial<Preferencias> & { ajustes?: Partial<Ajustes> & { suporte?: unknown } }) | null;
    if (!p) return padrao;
    // impressora que saiu da lista (só P1S e Kobra 3 desde 15/11/2026): volta à primeira
    const maquina = MAQUINAS.some((m) => m.id === p.maquina) ? p.maquina! : padrao.maquina;
    const base = ajustesPadrao(maquinaPorId(maquina).processo);
    const aj = { ...base, ...p.ajustes } as Ajustes;
    // versões antigas guardavam o suporte como sim/não
    if (typeof (p.ajustes?.suporte as unknown) === "boolean") aj.suporte = p.ajustes!.suporte ? maquinaPorId(maquina).processo.suporteTipo : "nenhum";
    if (!(aj.padrao in NOMES_PADROES)) aj.padrao = base.padrao;
    const fil = Array.from({ length: MAX_CORES }, (_, k) => ({ ...padrao.filamentos[k], ...(p.filamentos?.[k] ?? {}) }));
    const perfil = typeof p.perfil === "string" && /^[su]:./.test(p.perfil) ? p.perfil : `s:${adivinharPerfil(maquina, aj)}`;
    return { ...padrao, ...p, maquina, ajustes: aj, precos: p.precos ?? {}, calibracao: p.calibracao ?? {}, filamentos: fil, trocas: p.trocas ?? {}, perfil };
  } catch {
    return padrao;
  }
}
const pref = lerPreferencias();
/** Os ajustes da tela viram o perfil do projeto: só as diferenças sobre o 0,20 mm Padrão da impressora (camadas.ts). */
const perfilDoProjeto = () => diferencasDeAjustes(pref.maquina, pref.ajustes);
const guardar = () => {
  try {
    localStorage.setItem(CHAVE, JSON.stringify(pref));
  } catch {
    /* sem espaço: segue sem lembrar */
  }
};

let pecas: PecaInfo[] = [];
let escolhida: number | null = null;
let ultimo: Resultado | null = null;
let seq = 0;
let previaLigada = false;
let pintando = false;
interface DadosPeca {
  pos: Float32Array;
  tri: Uint32Array;
  cores: Uint8Array;
  top?: Topologia;
}
const malhas = new Map<number, DadosPeca>();
let desfazerPilha: { id: number; cores: Uint8Array }[] = [];
let refazerPilha: { id: number; cores: Uint8Array }[] = [];
type Aba = "inicio" | "preparar" | "previa" | "bancada";
let aba: Aba = "preparar";
let resolverExportar: ((p: { nome: string; copias: number; pos: Float32Array; tri: Uint32Array; cores: Uint8Array }[]) => void) | null = null;
let nomeProjeto = "";

// ---------- worker e vista ----------

const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
const pedir = (p: PedidoSlicer, t: Transferable[] = []) => worker.postMessage(p, t);
aplicarDispositivo();
const vista = new VistaMesa($("sl-vista"));
vista.aoEscolher = (id) => {
  if (id !== null) escolher(id);
};

const CORES: Record<Parte, string> = {
  paredeExt: "#2f7fd0", paredeInt: "#6aa7e3", vaos: "#1f9e5a", solido: "#e08a2e", topo: "#d0582f", ponte: "#a35d9e",
  esparso: "#e2b13c", suporte: "#8a96a3", interface: "#5e6b78", borda: "#4bb39b", troca: "#c0507a", torre: "#8f6fd0", deslocamento: "#b9c2cc", resfriamento: "#38424d",
};
const CORES_HEX = PARTES.map((p) => parseInt(CORES[p].slice(1), 16));

worker.onmessage = (e: MessageEvent<RespostaSlicer>) => {
  const r = e.data;
  if (r.tipo === "pecas") {
    for (const m of r.malhas) {
      vista.definirMalha(m.id, m.pos, m.tri, m.cores);
      malhas.set(m.id, { pos: m.pos, tri: m.tri, cores: m.cores });
      desfazerPilha = desfazerPilha.filter((x) => x.id !== m.id);
      refazerPilha = refazerPilha.filter((x) => x.id !== m.id);
    }
    for (const id of [...malhas.keys()]) if (!r.lista.some((p) => p.id === id)) malhas.delete(id);
    atualizarDesfazer();
    pecas = r.lista;
    if (r.malhas.length) {
      escolhida = r.malhas[r.malhas.length - 1].id;
      if (aba === "inicio") irPara("preparar"); // peça adicionada pelo Início: vai para a mesa
    }
    if (!pecas.some((p) => p.id === escolhida)) escolhida = pecas[0]?.id ?? null;
    ultimo = null;
    desenharPecas();
    mostrarLista();
    $("sl-vazio").hidden = pecas.length > 0;
    if (pecas.length) recalcular(0);
    else {
      $("sl-resultado").hidden = true;
      $("sl-previa").hidden = true;
      $("sl-previa-vazia").hidden = false;
      ligarPrevia(false);
    }
    atualizarMini();
    if (aba === "inicio") desenharInicio();
  } else if (r.tipo === "projetoPecas") {
    resolverExportar?.(r.pecas);
    resolverExportar = null;
  } else if (r.tipo === "progresso" && r.seq === seq) {
    $("sl-barra").style.width = `${Math.round(r.f * 100)}%`;
  } else if (r.tipo === "resultado" && r.seq === seq) {
    ultimo = r.r;
    mostrarResultado();
    prepararPrevia();
  } else if (r.tipo === "camada" && r.seq === seq) {
    $("sl-camada-v").textContent = `${r.i + 1} / ${ultimo?.camadas ?? 0} · ${num(r.z, 2)} mm`;
    if (previaLigada) vista.mostrarCamada({ z: r.z, seg: r.seg, parte: r.parte, cores: CORES_HEX });
  } else if (r.tipo === "erro" && (r.seq === undefined || r.seq === seq)) {
    $("sl-ocupado").hidden = true;
    atualizarMini();
    avisar(r.msg);
  }
};

const maquina = () => maquinaPorId(pref.maquina);
/** peças que não cabem ou passam da borda da mesa (vermelhas) */
function foraDaMesa(): Set<number> {
  const m = maquina(), fora = new Set<number>();
  for (const p of pecas)
    for (const [x, y] of p.posicoes)
      if (Math.abs(x) + p.dims[0] / 2 > m.mesa[0] / 2 + 1e-6 || Math.abs(y) + p.dims[1] / 2 > m.mesa[1] / 2 + 1e-6 || p.dims[2] > m.alturaMax) fora.add(p.id);
  return fora;
}
const temPintura = (id: number) => !!malhas.get(id)?.cores.some((c) => c > 0);
/** peças mostradas com as cores dos filamentos: as pintadas (todas, enquanto se pinta) */
const coloridas = () => new Set(pecas.filter((p) => pintando || temPintura(p.id)).map((p) => p.id));
const desenharPecas = () => vista.definirPecas(pecas, escolhida, foraDaMesa(), coloridas());

let avisoT = 0;
function avisar(msg: string, ms = 5000) {
  const a = $("sl-aviso");
  a.textContent = msg;
  a.hidden = false;
  clearTimeout(avisoT);
  avisoT = window.setTimeout(() => (a.hidden = true), ms);
}

// ---------- abrir / adicionar ----------

function abrirBytes(nome: string, bytes: Uint8Array) {
  pedir({ tipo: "stl", nome: nome.replace(/\.stl$/i, ""), bytes }, [bytes.buffer]);
}

async function abrirDoAparelho() {
  const a = await escolherArquivo(true);
  if (!a?.dados) return;
  if (!/\.stl$/i.test(a.nome)) return avisar(`${a.nome} não é um arquivo STL.`);
  abrirBytes(a.nome, new Uint8Array(a.dados));
}

async function abrirDoCofreSTL() {
  const arq = await escolherDoCofre("cad", "Adicionar STL do cofre — WJSlicer3D", ["stl"], "Malhas STL: .stl", "Adicionar");
  if (!arq) return;
  const r = await lerBytesDoCofre(arq.id);
  if (!r) return avisar("Não foi possível ler o arquivo do cofre.");
  abrirBytes(arq.nome, r.bytes);
}

/** Peça mandada pelo WJCAD (Peça → menu → Estimar impressão 3D). */
async function pecaDoCad() {
  const p = await pegar<{ nome: string; vertices: Float32Array; triangulos: Uint32Array }>("slicer:peca").catch(() => null);
  history.replaceState(null, "", location.pathname);
  if (!p) return avisar("Nenhuma peça recebida do WJCAD. No WJCAD, use o menu → Estimar impressão 3D.");
  pedir({ tipo: "cad", nome: p.nome, vertices: p.vertices, triangulos: p.triangulos });
}

/** Menu junto do botão: para baixo se o botão está na metade de cima da tela, para cima se está embaixo (barra de ferramentas). */
const menuEm = (b: HTMLElement, itens: Parameters<typeof menu>[2]) => {
  const r = b.getBoundingClientRect();
  menu(r.left, r.top > innerHeight / 2 ? r.top - itens.length * 48 - 12 : r.bottom + 4, itens);
};
const menuAbrir = (b: HTMLElement) =>
  menuEm(b, [
    { rotulo: "STL do cofre (WJPDM)…", icone: "pasta", acao: () => void abrirDoCofreSTL() },
    { rotulo: "STL do aparelho…", icone: "abrir", acao: () => void abrirDoAparelho() },
  ]);
$("sl-adicionar").onclick = () => menuAbrir($("sl-adicionar"));
$("sl-vazio-abrir").onclick = () => menuAbrir($("sl-vazio-abrir"));
$("sl-ini-adicionar").onclick = () => menuAbrir($("sl-ini-adicionar"));
$("sl-organizar").onclick = () => (pecas.length ? avisarMesa() : avisar("Ponha uma peça na mesa primeiro."));

// ---------- peças na mesa ----------

function escolher(id: number) {
  escolhida = id;
  desenharPecas();
  mostrarLista();
}

function mostrarLista() {
  const ul = $("sl-lista");
  ul.innerHTML = pecas.length
    ? pecas
        .map((p) => {
          const n = p.posicoes.length;
          return `<li data-id="${p.id}" class="${p.id === escolhida ? "sel" : ""}">
            <button class="sl-nome" data-acao="escolher" title="Escolher esta peça">${escapar(p.nome || "Peça")}<small>${num(p.dims[0], 1)} × ${num(p.dims[1], 1)} × ${num(p.dims[2], 1)} mm</small></button>
            <span class="sl-copias" title="Cópias desta peça na mesa"><button data-acao="menos" aria-label="Menos uma cópia" ${n <= 1 ? "disabled" : ""}>−</button><b>${n}×</b><button data-acao="mais" aria-label="Mais uma cópia">+</button></span>
            <button data-acao="remover" class="sl-remover" aria-label="Tirar da mesa" title="Tirar da mesa">✕</button>
          </li>`;
        })
        .join("")
    : `<li class="sl-nota">Nenhuma peça. Use “+ Peça”.</li>`;
  const tot = pecas.reduce((s, p) => s + p.posicoes.length, 0);
  const p = pecas.find((x) => x.id === escolhida);
  $("sl-peca").innerHTML = p
    ? `<strong>${escapar(p.nome || "Peça")}${pecas.length > 1 || tot > 1 ? ` <small>· ${tot} peça${tot > 1 ? "s" : ""} na mesa</small>` : ""}</strong>
       <span>${num(p.dims[0], 1)} × ${num(p.dims[1], 1)} × ${num(p.dims[2], 1)} mm (X × Y × Z) · ${num(p.triangulos)} triângulos</span>`
    : "<strong>Nenhuma peça na mesa</strong>";
  for (const b of document.querySelectorAll<HTMLButtonElement>("[data-girar], #sl-apoio")) b.disabled = !p;
}

$("sl-lista").onclick = (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-acao]");
  const li = b?.closest<HTMLElement>("li[data-id]");
  if (!b || !li) return;
  const id = Number(li.dataset.id), p = pecas.find((x) => x.id === id)!;
  const acao = b.dataset.acao;
  if (acao === "escolher") escolher(id);
  else if (acao === "mais" || acao === "menos") pedir({ tipo: "copias", id, n: p.posicoes.length + (acao === "mais" ? 1 : -1) });
  else if (acao === "remover") pedir({ tipo: "remover", id });
};

for (const b of document.querySelectorAll<HTMLButtonElement>("[data-girar]"))
  b.onclick = () => escolhida !== null && pedir({ tipo: "girar", id: escolhida, eixo: b.dataset.girar as "x" | "y" | "z", quartos: 1 });
$("sl-apoio").onclick = () => escolhida !== null && pedir({ tipo: "apoio", id: escolhida });

// ---------- barra lateral: impressora, processo (perfis, ajustes) ----------

const selMaq = $<HTMLSelectElement>("sl-maquina");
for (const m of MAQUINAS) selMaq.append(new Option(`${m.marca} ${m.modelo}`, m.id));
const selAltura = $<HTMLSelectElement>("sl-altura");
for (const h of [0.08, 0.12, 0.16, 0.2, 0.24, 0.28]) selAltura.append(new Option(`${num(h, 2)} mm`, String(h)));
const selDesenho = $<HTMLSelectElement>("sl-desenho");
for (const [id, nome] of Object.entries(NOMES_PADROES)) selDesenho.append(new Option(nome, id));
const campos = {
  paredes: $<HTMLInputElement>("sl-paredes"),
  topo: $<HTMLInputElement>("sl-topo"),
  fundo: $<HTMLInputElement>("sl-fundo"),
  preenchimento: $<HTMLInputElement>("sl-preench"),
  padrao: selDesenho,
  suporte: $<HTMLSelectElement>("sl-suporte"),
  borda: $<HTMLInputElement>("sl-borda"),
  saia: $<HTMLInputElement>("sl-saia"),
};

/** folga entre as peças na organização (a borda precisa de espaço) */
const folgaMesa = () => 6 + (pref.ajustes.borda ? 2 * maquina().processo.bordaLargura : 0);
const avisarMesa = () => pedir({ tipo: "mesa", mesa: maquina().mesa, folga: folgaMesa() });

// ---- perfis do usuário (.wjprf): lista no aparelho, igual no cofre (perfisUsuario.ts) ----
const CHAVE_PERFIS = "wjslicer:perfis";
function lerPerfisLocais(): BibliotecaPerfis {
  try {
    const t = localStorage.getItem(CHAVE_PERFIS);
    return t ? lerPerfis(t) : perfisVazios();
  } catch {
    return perfisVazios();
  }
}
let perfis = lerPerfisLocais();
const guardarPerfis = () => {
  try {
    localStorage.setItem(CHAVE_PERFIS, empacotarPerfis(perfis));
  } catch {
    /* sem espaço: segue sem lembrar */
  }
};
const perfilUsuario = (id: string) => perfisAtivos(perfis).find((p) => p.id === id);
const perfilExiste = (id: string) => (id.startsWith("s:") ? PERFIS_SISTEMA.some((p) => p.id === id.slice(2)) : !!perfilUsuario(id.slice(2)));

/** Valores do perfil escolhido (sistema, ou usuário sobre o seu perfil de sistema) para a impressora de agora. */
function ajustesDoPerfil(id: string): Ajustes {
  const sistema = id.startsWith("s:") ? perfilSistema(id.slice(2)).id : undefined;
  return ajustesDe(resolver({ maquina: pref.maquina, sistema, usuario: id.startsWith("u:") ? perfilUsuario(id.slice(2)) : undefined }));
}

function desenharPerfis() {
  if (!perfilExiste(pref.perfil)) pref.perfil = `s:${PERFIL_PADRAO}`; // perfil do usuário que foi excluído
  const usu = perfisAtivos(perfis);
  $<HTMLSelectElement>("sl-perfil").innerHTML =
    `<optgroup label="Perfis do usuário">${usu.length ? usu.map((p) => `<option value="u:${p.id}">${escapar(p.nome)}</option>`).join("") : `<option disabled>Nenhum ainda — use 💾 para salvar</option>`}</optgroup>` +
    `<optgroup label="Perfis do sistema">${PERFIS_SISTEMA.map((p) => `<option value="s:${p.id}">${escapar(p.nome)}</option>`).join("")}</optgroup>`;
  $<HTMLSelectElement>("sl-perfil").value = pref.perfil;
}

const ABA_DO_CAMPO: Record<string, string> = { altura: "qualidade", paredes: "resistencia", topo: "resistencia", fundo: "resistencia", preenchimento: "resistencia", padrao: "resistencia" };
/** Selo ↺ de alterado: o que difere do perfil escolhido (`diferencas()` de camadas.ts). */
function atualizarSelos() {
  const dif = diferencas(planoProcesso(ajustesDoPerfil(pref.perfil)), planoProcesso(pref.ajustes));
  for (const b of document.querySelectorAll<HTMLElement>("[data-voltar]")) b.hidden = !(b.dataset.voltar! in dif);
  $("sl-perfil-voltar").hidden = !Object.keys(dif).length;
  const abas = new Set(Object.keys(dif).map((k) => ABA_DO_CAMPO[k]));
  for (const b of document.querySelectorAll<HTMLElement>("#sl-pabs [data-pab]")) b.classList.toggle("alterada", abas.has(b.dataset.pab!));
}

/** Volta os campos ao valor do perfil escolhido (suporte, borda e saia são do projeto e não mudam). */
function voltarAoPerfil(chaves: readonly string[]) {
  const alvo = ajustesDoPerfil(pref.perfil) as unknown as Record<string, unknown>;
  const novo = { ...pref.ajustes } as unknown as Record<string, unknown>;
  for (const k of chaves) novo[k] = alvo[k];
  pref.ajustes = novo as unknown as Ajustes;
  guardar();
  preencherPainel();
  recalcular();
}

function aplicarPerfil(id: string) {
  pref.perfil = id;
  const { suporte, borda, saia } = pref.ajustes;
  pref.ajustes = { ...ajustesDoPerfil(id), suporte, borda, saia };
  guardar();
  preencherPainel();
  recalcular();
}

let sincPerfis: Promise<void> = Promise.resolve();
/** Junta a lista do aparelho com a do cofre, em fila (um aparelho sem cofre agora só segue no aparelho). */
function sincronizarPerfisCofre() {
  sincPerfis = sincPerfis.then(async () => {
    try {
      const r = await sincronizarPerfis(perfis);
      const novo = juntarPerfis(perfis, r.lista);
      if (empacotarPerfis(novo) !== empacotarPerfis(perfis)) {
        perfis = novo;
        guardarPerfis();
        desenharPerfis();
        atualizarSelos();
      }
    } catch {
      /* sem cofre agora */
    }
  });
}

function difDoPerfil(herdaDe: string): Plano {
  return diferencas(planoProcesso(ajustesDe(resolver({ maquina: pref.maquina, sistema: herdaDe }))), planoProcesso(pref.ajustes));
}
function gravarPerfil(p: PerfilUsuario, msg: string) {
  perfis = salvarPerfil(perfis, p);
  guardarPerfis();
  pref.perfil = `u:${p.id}`;
  guardar();
  desenharPerfis();
  atualizarSelos();
  avisar(msg);
  sincronizarPerfisCofre();
}
function pedirNome(titulo: string, inicial: string, ok: (nome: string) => void) {
  janela(titulo, `<label class="sl-campo">Nome do perfil <input id="sl-nome-perfil" type="text" maxlength="40" value="${escapar(inicial)}" /></label>`, [
    { rotulo: "Cancelar" },
    {
      rotulo: "Salvar", destaque: true, acao: (corpo: HTMLElement) => {
        const n = corpo.querySelector<HTMLInputElement>("#sl-nome-perfil")!.value.trim();
        if (!n) {
          avisar("Dê um nome ao perfil.");
          return false;
        }
        ok(n);
      },
    },
  ]);
}
$("sl-perfil-menu").onclick = () => {
  const u = pref.perfil.startsWith("u:") ? perfilUsuario(pref.perfil.slice(2)) : undefined;
  const herda = u?.herdaDe ?? pref.perfil.slice(2);
  menuEm($("sl-perfil-menu"), [
    ...(u ? [{ rotulo: `Salvar alterações em “${u.nome}”`, acao: () => gravarPerfil({ ...u, diferencas: difDoPerfil(u.herdaDe) }, `Perfil “${u.nome}” salvo.`) }] : []),
    { rotulo: "Salvar como novo perfil…", acao: () => pedirNome("Salvar perfil do usuário", "", (nome) => { const n = novoPerfil(nome, herda); gravarPerfil({ ...n, diferencas: difDoPerfil(n.herdaDe) }, `Perfil “${n.nome}” salvo.`); }) },
    ...(u ? [
      { rotulo: "Renomear…", acao: () => pedirNome("Renomear perfil", u.nome, (nome) => gravarPerfil({ ...u, nome }, `Perfil renomeado para “${nome}”.`)) },
      {
        rotulo: "Excluir perfil", acao: () =>
          janela("Excluir perfil", `<p>Excluir o perfil “${escapar(u.nome)}”? Os ajustes de agora ficam como estão.</p>`, [
            { rotulo: "Cancelar" },
            {
              rotulo: "Excluir", destaque: true, acao: () => {
                perfis = excluirPerfil(perfis, u.id);
                guardarPerfis();
                pref.perfil = `s:${u.herdaDe}`;
                guardar();
                desenharPerfis();
                atualizarSelos();
                sincronizarPerfisCofre();
              },
            },
          ]),
      },
    ] : []),
  ]);
};
$("sl-perfil").onchange = () => aplicarPerfil($<HTMLSelectElement>("sl-perfil").value);
$("sl-perfil-voltar").onclick = () => voltarAoPerfil(CHAVES_PROCESSO);
for (const b of document.querySelectorAll<HTMLButtonElement>("[data-voltar]")) b.onclick = () => voltarAoPerfil([b.dataset.voltar!]);

/** abas do Processo (Qualidade … Outros) */
$("sl-pabs").onclick = (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>("[data-pab]");
  if (!b) return;
  for (const t of document.querySelectorAll<HTMLElement>("#sl-pabs [data-pab]")) t.setAttribute("aria-selected", String(t === b));
  for (const pn of document.querySelectorAll<HTMLElement>(".sl-pab")) pn.hidden = pn.dataset.pab !== b.dataset.pab;
};

function preencherPainel() {
  const m = maquina();
  selMaq.value = m.id;
  const mats = materiaisDa(m);
  if (!mats.some((x) => x.id === pref.material)) pref.material = mats[0].id;
  const mat = materialDa(m, pref.material);
  const a = pref.ajustes;
  selAltura.value = String(a.altura);
  campos.paredes.value = String(a.paredes);
  campos.topo.value = String(a.topo);
  campos.fundo.value = String(a.fundo);
  campos.preenchimento.value = String(Math.round(a.preenchimento * 100));
  $("sl-preench-v").textContent = `${Math.round(a.preenchimento * 100)}%`;
  campos.padrao.value = a.padrao;
  campos.suporte.value = a.suporte;
  campos.borda.checked = a.borda;
  campos.saia.checked = a.saia;
  const pr = m.processo;
  $("sl-maq-info").textContent = `Mesa ${m.mesa[0]} × ${m.mesa[1]} × ${m.alturaMax} mm · bico 0,4 mm · paredes ${pr.vParedeExt}/${pr.vParedeInt} mm/s, até ${num(m.aMax)} mm/s² · ${mat.nome}: ${num(mat.densidade, 2)} g/cm³, até ${num(mat.vazaoMax, 1)} mm³/s, camada mínima ${mat.tempoCamada} s`;
  const f = pref.calibracao[m.id];
  $("sl-calibrado").textContent = f ? `Tempo calibrado para esta impressora: × ${num(f, 2)}` : "";
  desenharFilamentos();
  preencherTroca();
  desenharPerfis();
  atualizarSelos();
}

const inteiro = (inp: HTMLInputElement, min: number, max: number) => Math.max(min, Math.min(max, Math.round(Number(inp.value) || 0)));

function lerPainel() {
  pref.ajustes = {
    altura: Number(selAltura.value),
    paredes: inteiro(campos.paredes, 1, 10),
    topo: inteiro(campos.topo, 0, 20),
    fundo: inteiro(campos.fundo, 0, 20),
    preenchimento: inteiro(campos.preenchimento, 0, 100) / 100,
    padrao: campos.padrao.value as Padrao,
    suporte: campos.suporte.value as TipoSuporte,
    borda: campos.borda.checked,
    saia: campos.saia.checked,
  };
  guardar();
  atualizarSelos();
}

selMaq.onchange = () => {
  // outra impressora: valores do perfil escolhido para ela (o perfil muda paredes, cascas e o padrão)
  const { suporte, borda, saia, preenchimento } = pref.ajustes;
  pref.maquina = selMaq.value;
  pref.ajustes = { ...ajustesDoPerfil(pref.perfil), suporte, borda, saia, preenchimento };
  vista.definirMesa(...maquina().mesa);
  vista.enquadrar();
  preencherPainel();
  guardar();
  avisarMesa(); // reorganiza na mesa nova e recalcula
};
for (const inp of [selAltura, ...Object.values(campos)])
  inp.addEventListener(inp === campos.preenchimento ? "input" : "change", () => {
    $("sl-preench-v").textContent = `${campos.preenchimento.value}%`;
    const borda = pref.ajustes.borda;
    lerPainel();
    desenharFilamentos();
    if (pref.ajustes.borda !== borda) avisarMesa(); // a borda precisa de mais folga entre as peças
    else recalcular();
  });
for (const b of document.querySelectorAll<HTMLButtonElement>("[data-passo]"))
  b.onclick = () => {
    const inp = $<HTMLInputElement>(b.dataset.alvo!);
    inp.value = String(Number(inp.value) + Number(b.dataset.passo));
    inp.dispatchEvent(new Event("change"));
  };

// ---------- orçamento ----------

let espera = 0;
function recalcular(atraso = 250) {
  if (!pecas.length) return;
  clearTimeout(espera);
  espera = window.setTimeout(() => {
    seq++;
    $("sl-ocupado").hidden = false;
    $("sl-barra").style.width = "0%";
    atualizarMini();
    const mat = materialDa(maquina(), pref.material);
    pedir({ tipo: "estimar", seq, maquina: pref.maquina, material: pref.material, precoKg: pref.precos[pref.material] ?? mat.precoKg, perfil: perfilDoProjeto(), filamentos: filamentosEfetivos(), troca: trocaAtual() });
  }, atraso);
}

function mostrarResultado() {
  const r = ultimo!;
  $("sl-ocupado").hidden = true;
  const fator = pref.calibracao[pref.maquina] ?? 1;
  const tempo = r.tempoS * fator;
  $("sl-resultado").hidden = false;
  $("sl-previa-vazia").hidden = true;
  $("sl-tempo").textContent = formatarTempo(tempo);
  $("sl-massa").textContent = `${num(r.massaG, 1)} g`;
  $("sl-dados").innerHTML = `
    <div><dt>Filamento (1,75 mm)</dt><dd>${num(r.comprimentoM, 2)} m</dd></div>
    <div><dt>Custo do material</dt><dd>R$ ${num(r.custo, 2)}</dd></div>
    <div><dt>Preparo típico (aquecer, nivelar)</dt><dd>+ ${formatarTempo(r.preparoS)}</dd></div>
    <div><dt>Total com preparo</dt><dd>${formatarTempo(tempo + r.preparoS)}</dd></div>
    <div><dt>Camadas</dt><dd>${num(r.camadas)}</dd></div>
    <div><dt>${r.copias > 1 ? `Volume das ${r.copias} peças` : "Volume da peça"}</dt><dd>${r.volumePeca === null ? "—" : `${num(r.volumePeca / 1000, 2)} cm³`}</dd></div>`;
  mostrarCores(r, fator);
  const total = r.tempoS || 1;
  const dens = materialDa(maquina(), pref.material).densidade;
  const linhas = PARTES.filter((k) => r.partes[k].tempo > 0.5 || r.partes[k].volume > 0.5).map((k) => {
    const p = r.partes[k], pct = (p.tempo / total) * 100;
    const g = (p.volume / 1000) * dens;
    return `<tr><td><i style="background:${CORES[k]}"></i>${NOMES_PARTES[k]}</td><td>${formatarTempo(p.tempo * fator)}</td><td>${num(pct, 0)}%</td><td>${g > 0.05 ? `${num(g, 1)} g` : ""}</td></tr>`;
  });
  $("sl-partes").innerHTML = `<thead><tr><th>Caminho</th><th>Tempo</th><th></th><th>Material</th></tr></thead><tbody>${linhas.join("")}</tbody>`;
  $("sl-faixa").innerHTML = PARTES.map((k) => `<span style="flex:${r.partes[k].tempo};background:${CORES[k]}" title="${NOMES_PARTES[k]}"></span>`).join("");
  const av = $("sl-avisos");
  av.innerHTML = r.avisos.map((a) => `<p>⚠ ${escapar(a)}</p>`).join("");
  av.hidden = !r.avisos.length;
  desenharPecas();
  atualizarMini();
  if (aba === "inicio") desenharInicio();
  orcamento.impressaoMudou();
}

/** Resumo flutuante na mesa (aba Preparar): tempo e material sem sair da mesa. */
function atualizarMini() {
  const m = $("sl-mini");
  const ocupado = !$("sl-ocupado").hidden;
  if (ocupado) m.textContent = "Fatiando…";
  else if (ultimo) m.textContent = `${formatarTempo(ultimo.tempoS * (pref.calibracao[pref.maquina] ?? 1))} · ${num(ultimo.massaG, 1)} g${ultimo.trocas.total > 0 ? ` · ${ultimo.trocas.total} trocas de cor` : ""}`;
  m.hidden = !pecas.length || (!ocupado && !ultimo);
}

// ---------- cores: filamentos, trocas, pintura ----------

const selFil = (i: number) => pref.filamentos[i] ?? filamentosPadrao()[i];
/** filamentos do orçamento: o primeiro usa o material e o preço de "Impressora e material" */
function filamentosEfetivos(): Filamento[] {
  const mat = materialDa(maquina(), pref.material);
  return pref.filamentos.map((f, i) => (i === 0 ? { ...f, material: pref.material, precoKg: pref.precos[pref.material] ?? mat.precoKg } : f));
}
const trocaAtual = (): ConfigTroca => ({ ...maquina().troca, ...pref.trocas[pref.maquina] });
const hexCores = () => pref.filamentos.map((f) => f.cor);

function desenharFilamentos() {
  const mats = materiaisDa(maquina());
  const fil = filamentosEfetivos();
  $("sl-filamentos").innerHTML = fil
    .map((f, i) => {
      const opcoes = mats.map((m) => `<option value="${m.id}"${m.id === f.material ? " selected" : ""}>${escapar(m.nome)}</option>`).join("");
      return `<div class="sl-filamento" data-i="${i}">
        <input type="color" data-c="cor" value="${f.cor}" aria-label="Cor do filamento ${i + 1}" />
        <input type="text" data-c="nome" value="${escapar(f.nome)}" maxlength="24" aria-label="Nome do filamento ${i + 1}" />
        <select data-c="material" aria-label="Material do filamento ${i + 1}">${opcoes}</select>
        <input type="number" data-c="preco" min="0" step="1" inputmode="decimal" value="${f.precoKg}" aria-label="Preço por kg do filamento ${i + 1}" />
      </div>`;
    })
    .join("");
  desenharPaleta();
  vista.definirFilamentos(hexCores());
}

$("sl-filamentos").addEventListener("change", (e) => {
  const campo = e.target as HTMLInputElement | HTMLSelectElement;
  const linha = campo.closest<HTMLElement>(".sl-filamento");
  if (!linha) return;
  const i = Number(linha.dataset.i), f = selFil(i);
  const c = campo.dataset.c;
  if (c === "cor") f.cor = campo.value;
  else if (c === "nome") f.nome = campo.value.trim() || `Filamento ${i + 1}`;
  else if (c === "material") {
    f.material = campo.value as IdMaterial;
    if (i === 0) {
      // a posição 1 manda no material do orçamento
      pref.material = f.material;
      guardar();
      preencherPainel();
      recalcular();
      return;
    }
  } else if (c === "preco") {
    const v = Number(campo.value.replace(",", "."));
    if (!(v >= 0)) return;
    f.precoKg = v;
    if (i === 0) {
      pref.precos[pref.material] = v;
      guardar();
      recalcular();
      return;
    }
  }
  guardar();
  vista.definirFilamentos(hexCores());
  desenharPaleta();
  if (c === "cor" || c === "nome") {
    if (ultimo) mostrarCores(ultimo, pref.calibracao[pref.maquina] ?? 1);
  } else recalcular();
});

let corAtual = 0;
function desenharPaleta() {
  $("sl-paleta").innerHTML = pref.filamentos
    .map((f, i) => `<button data-cor="${i}" role="radio" aria-checked="${i === corAtual}" style="background:${f.cor};color:${luminosa(f.cor) ? "#1d2733" : "#fff"}" title="${escapar(f.nome)}" aria-label="Cor ${i + 1}: ${escapar(f.nome)}">${i + 1}</button>`)
    .join("");
}
function luminosa(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  return 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255) > 150;
}
$("sl-paleta").onclick = (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-cor]");
  if (!b) return;
  corAtual = Number(b.dataset.cor);
  desenharPaleta();
  if (ferramenta === "borracha") escolherFerramenta("pincel");
};

const trocaCampos = {
  purga: $<HTMLInputElement>("sl-purga"),
  tempo: $<HTMLInputElement>("sl-tempo-troca"),
  torre: $<HTMLInputElement>("sl-torre"),
  largura: $<HTMLInputElement>("sl-torre-l"),
};
function preencherTroca() {
  const t = trocaAtual(), m = maquina();
  trocaCampos.purga.value = String(t.purgaMm3);
  trocaCampos.tempo.value = String(t.tempoS);
  trocaCampos.torre.checked = t.torre;
  trocaCampos.largura.value = String(t.larguraTorre);
  trocaCampos.largura.disabled = !t.torre;
  $("sl-troca-info").textContent = `De fábrica (${m.modelo}): purga ${m.troca.purgaMm3} mm³, troca ${m.troca.tempoS} s, torre ${m.troca.larguraTorre} mm. São valores típicos do sistema de 4 filamentos: ajuste com a sua medida.`;
}
for (const inp of Object.values(trocaCampos))
  inp.addEventListener("change", () => {
    const n = (x: HTMLInputElement, min: number, max: number, d: number) => Math.min(max, Math.max(min, Number(x.value.replace(",", ".")) || d));
    const base = maquina().troca;
    pref.trocas[pref.maquina] = {
      purgaMm3: n(trocaCampos.purga, 0, 5000, base.purgaMm3), tempoS: n(trocaCampos.tempo, 0, 600, base.tempoS),
      torre: trocaCampos.torre.checked, larguraTorre: n(trocaCampos.largura, 10, 80, base.larguraTorre),
    };
    guardar();
    preencherTroca();
    recalcular();
  });
$("sl-troca-padrao").onclick = () => {
  delete pref.trocas[pref.maquina];
  guardar();
  preencherTroca();
  recalcular();
};

/** material por cor e o custo das trocas no resultado */
function mostrarCores(r: Resultado, fator: number) {
  const usadas = r.cores.map((c, i) => ({ c, i })).filter((x) => x.c.usada);
  const caixa = $("sl-por-cor");
  caixa.hidden = usadas.length < 2 && r.trocas.total === 0;
  if (caixa.hidden) return;
  const fil = filamentosEfetivos();
  const dens = materialDa(maquina(), pref.material).densidade;
  caixa.innerHTML = `<table class="wj-tabela"><thead><tr><th>Cor</th><th>Material</th><th>Filamento</th><th>Custo</th></tr></thead><tbody>${usadas
    .map(({ c, i }) => `<tr><td><i style="background:${fil[i].cor}"></i>${escapar(fil[i].nome)}</td><td>${num(c.massaG, 1)} g</td><td>${num(c.comprimentoM, 2)} m</td><td>R$ ${num(c.custo, 2)}</td></tr>`)
    .join("")}</tbody></table>`;
  if (r.trocas.total > 0) {
    const t = r.trocas;
    caixa.innerHTML += `<dl class="sl-dados">
      <div><dt>Trocas de cor</dt><dd>${num(t.total)} em ${num(t.camadas)} camada${t.camadas > 1 ? "s" : ""} (até ${t.maximoPorCamada} por camada)</dd></div>
      <div><dt>Tempo das trocas (troca + purga)</dt><dd>${formatarTempo(t.tempoS * fator)}</dd></div>
      <div><dt>Purga</dt><dd>${num(t.purgaMm3, 0)} mm³ · ${num((t.purgaMm3 / 1000) * dens, 1)} g</dd></div>
      <div><dt>Torre de purga</dt><dd>${t.torreCamadas ? `${num(t.torreCamadas)} camadas · ${num((t.torreMm3 / 1000) * dens, 1)} g · ${formatarTempo(t.torreTempoS * fator)}` : "desligada"}</dd></div>
    </dl><p class="sl-nota">O material e o tempo acima já incluem a purga e a torre.</p>`;
  }
}

// ---- pintura ----
type Ferramenta = "pincel" | "face" | "regiao" | "angulo" | "corpo" | "borracha";
let ferramenta: Ferramenta = "pincel";
let traco: { id: number; antes: Uint8Array; mudou: boolean; aplicado: boolean } | null = null;
const campoPincel = $("sl-campo-pincel"), campoAngulo = $("sl-campo-angulo");
const rPincel = $<HTMLInputElement>("sl-pincel"), rAngulo = $<HTMLInputElement>("sl-angulo");

function escolherFerramenta(f: Ferramenta) {
  ferramenta = f;
  for (const b of document.querySelectorAll<HTMLButtonElement>("[data-ferr]")) b.setAttribute("aria-pressed", String(b.dataset.ferr === f));
  const ponta = f === "pincel" || f === "borracha";
  campoPincel.hidden = !ponta;
  campoAngulo.hidden = f !== "angulo";
  vista.mostrarPincel = ponta;
}
$("sl-ferramentas").onclick = (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-ferr]");
  if (b) escolherFerramenta(b.dataset.ferr as Ferramenta);
};
function lerPincel() {
  vista.raioPincel = Number(rPincel.value);
  $("sl-pincel-v").textContent = `${num(Number(rPincel.value), 1)} mm`;
  $("sl-angulo-v").textContent = `${rAngulo.value}°`;
}
rPincel.addEventListener("input", lerPincel);
rAngulo.addEventListener("input", lerPincel);

function ligarPintura(on: boolean) {
  if (on && !pecas.length) return avisar("Ponha uma peça na mesa para pintar.");
  pintando = on;
  $("sl-pintar").setAttribute("aria-pressed", String(on));
  $("sl-bloco-pintura").hidden = !on;
  if (on && escolhida === null) escolhida = pecas[0]?.id ?? null;
  if (on) escolherFerramenta(ferramenta);
  aplicarPintura();
  desenharPecas();
  mostrarLista();
  if (on && aba === "preparar") $("sl-bloco-pintura").scrollIntoView({ block: "nearest" });
}
/** A vista só pinta na aba Preparar (na Prévia a caneta só olha). */
function aplicarPintura() {
  const vale = pintando && aba === "preparar";
  vista.pintando = vale;
  if (!vale) {
    vista.mostrarPincel = false;
    vista.moverCursor(null);
  } else vista.mostrarPincel = ferramenta === "pincel" || ferramenta === "borracha";
}
$("sl-pintar").onclick = () => ligarPintura(!pintando);
$("sl-pintar-fechar").onclick = () => ligarPintura(false);

function atualizarDesfazer() {
  $<HTMLButtonElement>("sl-desfazer-cor").disabled = !desfazerPilha.length;
  $<HTMLButtonElement>("sl-refazer-cor").disabled = !refazerPilha.length;
}
function empilhar(id: number, antes: Uint8Array) {
  desfazerPilha.push({ id, cores: antes });
  if (desfazerPilha.length > 40) desfazerPilha.shift();
  refazerPilha = []; // pintura nova: o que se desfez não volta mais
  atualizarDesfazer();
}
/** manda a pintura da peça ao worker e recalcula o orçamento */
function pintouPeca(id: number) {
  const d = malhas.get(id);
  if (!d) return;
  vista.definirCores(id, d.cores);
  pedir({ tipo: "cores", id, cores: d.cores.slice() });
  desenharPecas();
  recalcular(700);
}

vista.aoPintar = (a) => {
  if (a.fase === "fim") {
    const t = traco;
    traco = null;
    if (t?.mudou) {
      empilhar(t.id, t.antes);
      pintouPeca(t.id);
    }
    return;
  }
  const d = malhas.get(a.id);
  if (!d) return;
  if (a.fase === "inicio") {
    if (a.id !== escolhida) escolher(a.id);
    traco = { id: a.id, antes: d.cores.slice(), mudou: false, aplicado: false };
  }
  if (!traco || traco.id !== a.id) return;
  d.top ??= topologia({ pos: d.pos, tri: d.tri });
  const cor = ferramenta === "borracha" ? 0 : corAtual;
  let n = 0;
  if (ferramenta === "pincel" || ferramenta === "borracha") n = pincel(d.top, d.cores, a.ponto, a.normal, vista.raioPincel, cor);
  else if (!traco.aplicado) {
    traco.aplicado = true;
    if (ferramenta === "corpo") n = pintarCorpo(d.top, d.cores, a.tri, cor);
    else n = balde(d.top, d.cores, a.tri, cor, ferramenta === "face" ? { tipo: "face" } : ferramenta === "regiao" ? { tipo: "regiao" } : { tipo: "angulo", graus: Number(rAngulo.value) });
  }
  if (n) {
    traco.mudou = true;
    vista.definirCores(a.id, d.cores);
  }
};
$("sl-desfazer-cor").onclick = () => {
  const u = desfazerPilha.pop();
  const d = u && malhas.get(u.id);
  if (u && d) {
    refazerPilha.push({ id: u.id, cores: d.cores.slice() });
    d.cores.set(u.cores);
    pintouPeca(u.id);
  }
  atualizarDesfazer();
};
$("sl-refazer-cor").onclick = () => {
  const u = refazerPilha.pop();
  const d = u && malhas.get(u.id);
  if (u && d) {
    desfazerPilha.push({ id: u.id, cores: d.cores.slice() });
    d.cores.set(u.cores);
    pintouPeca(u.id);
  }
  atualizarDesfazer();
};
$("sl-limpar-cor").onclick = () => {
  const d = escolhida !== null ? malhas.get(escolhida) : null;
  if (!d || !d.cores.some((c) => c > 0)) return avisar("A peça escolhida não tem pintura.");
  empilhar(escolhida!, d.cores.slice());
  d.cores.fill(0);
  pintouPeca(escolhida!);
};
lerPincel();

// ---------- orçamento e biblioteca de custos ----------

/** volume de uma malha fechada (mm³), pela soma dos tetraedros com a origem */
function volumeDe(d: DadosPeca) {
  let v = 0;
  for (let t = 0; t < d.tri.length; t += 3) {
    const a = d.tri[t] * 3, b = d.tri[t + 1] * 3, c = d.tri[t + 2] * 3;
    v += (d.pos[a] * (d.pos[b + 1] * d.pos[c + 2] - d.pos[b + 2] * d.pos[c + 1]) - d.pos[a + 1] * (d.pos[b] * d.pos[c + 2] - d.pos[b + 2] * d.pos[c]) + d.pos[a + 2] * (d.pos[b] * d.pos[c + 1] - d.pos[b + 1] * d.pos[c])) / 6;
  }
  return Math.abs(v);
}

const orcamento = iniciarOrcamento({
  impressao: () => {
    if (!ultimo) return null;
    const fil = filamentosEfetivos();
    const fator = pref.calibracao[pref.maquina] ?? 1;
    return {
      horasMesa: (ultimo.tempoS * fator) / 3600,
      cores: ultimo.cores.map((c, i) => ({ c, i })).filter((x) => x.c.usada).map(({ c, i }) => ({ indice: i, nome: fil[i].nome, material: fil[i].material, massaG: c.massaG })),
    };
  },
  pecas: () =>
    pecas.map((p) => {
      const d = malhas.get(p.id);
      return {
        nome: p.nome, copias: Math.max(1, p.posicoes.length), peso: d ? volumeDe(d) : 1,
        isometrica: () => (d ? vistaIsometrica(d.pos, d.tri, d.cores, hexCores()) : null),
      };
    }),
  resumo: () => {
    const fil = filamentosEfetivos();
    const usadas = ultimo ? ultimo.cores.map((c, i) => ({ c, i })).filter((x) => x.c.usada).map((x) => fil[x.i]) : [];
    const mats = [...new Set((usadas.length ? usadas : [fil[0]]).map((f) => materialDa(maquina(), f.material).nome))];
    const dim = ultimo ? `${ultimo.dimensoes.map((x) => num(x, 0)).join(" × ")} mm` : "";
    return { cores: usadas.map((f) => f.nome).join(", "), material: mats.join(", "), dimensoes: dim };
  },
  avisar: (m, ms) => avisar(m, ms),
  raiz: () => $("sl-bancada-area"), // as telas abrem dentro da aba Bancada
});
$("sl-orcamento").onclick = () => orcamento.abrirOrcamento();
$("sl-biblioteca").onclick = () => orcamento.abrirBiblioteca();
$("sl-proposta").onclick = () => void orcamento.abrirProposta();

// ---------- projeto no cofre (.wjslc) ----------

function pecasDoWorker() {
  return new Promise<{ nome: string; copias: number; pos: Float32Array; tri: Uint32Array; cores: Uint8Array }[]>((ok) => {
    resolverExportar = ok;
    pedir({ tipo: "exportar" });
  });
}

/** Salva o projeto (peças, pintura, filamentos, trocas e ajustes) no cofre do WJPDM. */
async function salvarProjeto(): Promise<string> {
  const lista = await pecasDoWorker();
  if (!lista.length) {
    const m = "Ponha uma peça na mesa antes de salvar o projeto.";
    avisar(m);
    return m;
  }
  const trocas: Record<string, ConfigTroca> = {};
  for (const m of MAQUINAS) if (pref.trocas[m.id]) trocas[m.id] = { ...m.troca, ...pref.trocas[m.id] };
  const nome = nomeProjeto || lista[0].nome || "Projeto de impressão";
  const texto = await empacotar({ nome, maquina: pref.maquina, material: pref.material, perfil: perfilDoProjeto(), precos: pref.precos, filamentos: filamentosEfetivos(), trocas, orcamento: orcamento.obter(), pecas: lista });
  avisar("Salvando no cofre…");
  const msg = await salvarNoCofre("slicer", `${nome}.${EXTENSAO_PROJETO}`, new Blob([texto], { type: "application/json" }), (n) => (nomeProjeto = n));
  avisar(msg, 7000);
  return msg;
}

/** Põe um projeto aberto na tela: impressora, filamentos, trocas, ajustes e as peças pintadas. */
function aplicarProjeto(p: ProjetoSlicer) {
  nomeProjeto = p.nome;
  pref.maquina = p.maquina;
  pref.material = p.material;
  pref.precos = { ...pref.precos, ...p.precos };
  pref.ajustes = ajustesDe(resolver({ maquina: p.maquina, projeto: p.perfil }));
  pref.perfil = `s:${adivinharPerfil(p.maquina, pref.ajustes)}`; // o projeto guarda só as diferenças: o selo ↺ mostra o que fugir do perfil
  pref.filamentos = p.filamentos;
  pref.trocas = { ...pref.trocas, ...p.trocas };
  guardar();
  orcamento.definir(p.orcamento as never);
  vista.definirMesa(...maquina().mesa);
  vista.enquadrar();
  preencherPainel();
  desfazerPilha = [];
  refazerPilha = [];
  atualizarDesfazer();
  pedir({ tipo: "mesa", mesa: maquina().mesa, folga: folgaMesa() });
  const pecasP = p.pecas.map((x) => ({ ...x }));
  pedir({ tipo: "projeto", pecas: pecasP }, pecasP.flatMap((x) => [x.pos.buffer, x.tri.buffer, x.cores.buffer]));
  avisar(`Projeto “${p.nome}” aberto (${p.pecas.length} peça${p.pecas.length > 1 ? "s" : ""}).`);
}

async function abrirDoAutosave() {
  history.replaceState(null, "", location.pathname);
  try {
    const texto = localStorage.getItem("wjslc:documento");
    if (!texto) return avisar("Nenhum projeto para abrir.");
    aplicarProjeto(await desempacotar(texto));
  } catch (e) {
    avisar((e as Error).message || "Não foi possível abrir o projeto.", 7000);
  }
}
const abrirProjeto = () => void abrirDoCofre("slicer", pecas.length > 0);
$("sl-salvar").onclick = () => void salvarProjeto();
$("sl-bancada-salvar").onclick = () => void salvarProjeto();
$("sl-abrir-projeto").onclick = abrirProjeto;
$("sl-cofre").onclick = () => document.querySelector<HTMLElement>(".wjc-aba")?.click();
$("sl-arquivo").onclick = () =>
  menuEm($("sl-arquivo"), [
    { rotulo: "Adicionar STL do cofre (WJPDM)…", icone: "pasta", acao: () => void abrirDoCofreSTL() },
    { rotulo: "Adicionar STL do aparelho…", icone: "abrir", acao: () => void abrirDoAparelho() },
    "-",
    { rotulo: "Abrir projeto do cofre…", acao: abrirProjeto },
    { rotulo: "Salvar projeto", acao: () => void salvarProjeto() },
    "-",
    { rotulo: "Bancada (orçamento e proposta)", acao: () => irPara("bancada") },
  ]);

// ---------- prévia das camadas ----------

const deslizante = $<HTMLInputElement>("sl-camada");
function prepararPrevia() {
  const r = ultimo!;
  $("sl-previa").hidden = false;
  const max = r.camadas - 1;
  $("sl-previa-vazia").hidden = true;
  const ia = Number(deslizante.value);
  deslizante.max = String(max);
  if (!previaLigada || ia > max) deslizante.value = String(max);
  if (previaLigada) pedirCamada();
  $("sl-legenda").innerHTML = PARTES.filter((k) => k !== "deslocamento" && k !== "resfriamento" && k !== "troca" && k !== "torre" && r.partes[k].volume > 0.5)
    .map((k) => `<span><i style="background:${CORES[k]}"></i>${NOMES_PARTES[k]}</span>`)
    .join("");
  if (aba === "previa" && !previaLigada) ligarPrevia(true); // na aba Prévia as camadas aparecem sozinhas
}
let pedidoCamada = 0;
function pedirCamada() {
  cancelAnimationFrame(pedidoCamada);
  pedidoCamada = requestAnimationFrame(() => pedir({ tipo: "camada", seq, i: Number(deslizante.value) }));
}
function ligarPrevia(on: boolean) {
  previaLigada = on;
  $("sl-deslizante").hidden = !on;
  $("sl-legenda").hidden = !on;
  if (on) pedirCamada();
  else vista.mostrarCamada(null);
}
deslizante.addEventListener("input", pedirCamada);
for (const b of document.querySelectorAll<HTMLButtonElement>("[data-camada]"))
  b.onclick = () => {
    deslizante.value = String(Math.max(0, Math.min(Number(deslizante.max), Number(deslizante.value) + Number(b.dataset.camada))));
    pedirCamada();
  };

// ---------- calibração do tempo ----------

$("sl-calibrar").onclick = () =>
  menuEm($("sl-calibrar"), [
    { rotulo: "Calibrar tempo…", acao: calibrarTempo },
    ...(pref.calibracao[pref.maquina] ? [{ rotulo: "Remover calibração", acao: () => { delete pref.calibracao[pref.maquina]; guardar(); preencherPainel(); if (ultimo) mostrarResultado(); atualizarMini(); } }] : []),
  ]);

function calibrarTempo() {
  if (!ultimo) return avisar("Ponha uma peça na mesa primeiro.");
  const m = maquina();
  const f = pref.calibracao[m.id];
  janela(
    `Calibrar o tempo — ${m.marca} ${m.modelo}`,
    `<p>Para deixar a estimativa igual à sua realidade: com esta mesma mesa e estes ajustes, informe o tempo que a impressora levou de fato (ou o que o seu fatiador mostrou). O fator fica guardado para esta impressora.</p>
     <p>Estimativa sem calibração: <strong>${formatarTempo(ultimo.tempoS)}</strong>${f ? ` · fator atual × ${num(f, 2)}` : ""}</p>
     <div class="sl-cal"><label>Horas <input id="sl-cal-h" type="number" min="0" step="1" value="0" inputmode="numeric"></label>
     <label>Minutos <input id="sl-cal-m" type="number" min="0" max="59" step="1" value="0" inputmode="numeric"></label></div>`,
    [
      { rotulo: "Cancelar" },
      ...(f
        ? [{
            rotulo: "Remover calibração", acao: () => {
              delete pref.calibracao[m.id];
              guardar();
              preencherPainel();
              mostrarResultado();
            },
          }]
        : []),
      {
        rotulo: "Calibrar", destaque: true, acao: (corpo: HTMLElement) => {
          const h = Number(corpo.querySelector<HTMLInputElement>("#sl-cal-h")!.value) || 0;
          const mi = Number(corpo.querySelector<HTMLInputElement>("#sl-cal-m")!.value) || 0;
          const real = (h * 60 + mi) * 60;
          if (real <= 0) {
            avisar("Informe o tempo real (horas e minutos).");
            return false;
          }
          const fator = real / ultimo!.tempoS;
          if (fator < 0.3 || fator > 3) {
            avisar("O tempo informado difere demais da estimativa (mais de 3 vezes): confira as peças e os ajustes.");
            return false;
          }
          pref.calibracao[m.id] = fator;
          guardar();
          preencherPainel();
          mostrarResultado();
        },
      },
    ],
  );
}

// ---------- abas: Início · Preparar · Prévia · Bancada ----------

function irPara(a: Aba) {
  aba = a;
  document.body.dataset.aba = a;
  for (const b of document.querySelectorAll<HTMLElement>("#sl-abas [data-aba]")) b.setAttribute("aria-selected", String(b.dataset.aba === a));
  $("sl-pagina-vista").hidden = a === "inicio" || a === "bancada";
  $("sl-pagina-inicio").hidden = a !== "inicio";
  $("sl-pagina-bancada").hidden = a !== "bancada";
  $("sl-painel-preparar").hidden = a !== "preparar";
  $("sl-painel-previa").hidden = a !== "previa";
  fecharGaveta();
  $("sl-lateral").scrollTop = 0;
  aplicarPintura();
  ligarPrevia(a === "previa" && !!ultimo);
  if (a === "inicio") desenharInicio();
}
$("sl-abas").addEventListener("click", (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>("button[data-aba]");
  if (b) irPara(b.dataset.aba as Aba);
});

/** celular: a barra lateral é uma gaveta */
function fecharGaveta() {
  document.body.classList.remove("sl-gaveta-aberta");
  $("sl-gaveta").setAttribute("aria-expanded", "false");
}
$("sl-gaveta").onclick = () => {
  const aberta = document.body.classList.toggle("sl-gaveta-aberta");
  $("sl-gaveta").setAttribute("aria-expanded", String(aberta));
};
$("sl-pagina-vista").addEventListener("pointerdown", fecharGaveta);

function desenharInicio() {
  const tot = pecas.reduce((s, p) => s + p.posicoes.length, 0);
  const r = ultimo;
  $("sl-ini-resumo").innerHTML = pecas.length
    ? `<strong>${escapar(nomeProjeto || pecas[0].nome || "Mesa atual")}</strong>
       <p class="sl-nota">${tot} peça${tot > 1 ? "s" : ""} na mesa · ${escapar(maquina().marca)} ${escapar(maquina().modelo)}${r ? ` · ${formatarTempo(r.tempoS * (pref.calibracao[pref.maquina] ?? 1))} · ${num(r.massaG, 1)} g` : ""}</p>`
    : `<p class="sl-nota">A mesa está vazia. Adicione um STL ou abra um projeto para começar.</p>`;
}
$("sl-ini-abrir").onclick = abrirProjeto;
$("sl-ini-preparar").onclick = () => irPara("preparar");
$("sl-ini-previa").onclick = () => irPara("previa");
$("sl-ini-bancada").onclick = () => irPara("bancada");

// ---------- início ----------

pintarIcones();
$("sl-versao").textContent = `v${__VERSAO__}`;
const diag = botaoDiagnostico("wj-ic");
if (diag) $("sl-direita").append(diag);
escolherFerramenta("pincel");
vista.definirMesa(...maquina().mesa);
vista.enquadrar();
preencherPainel();
mostrarLista();
irPara("preparar");
avisarMesa();
registrarComAtualizacao();
void sincronizarAoAbrir()?.catch(() => {});
instalarPainelCofre("slicer", salvarProjeto);
sincronizarPerfisCofre();
if (location.hash === "#peca-do-cad") void pecaDoCad();
else if (location.hash === "#abrir-autosave") void abrirDoAutosave();
