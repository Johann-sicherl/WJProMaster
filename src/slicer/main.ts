// WJSlicer3D: orçamento de tempo de impressão e de material por fatiamento real, sem gerar G-code e
// sem mandar para a impressora. Duas impressoras (P1S e Kobra 3, bico 0,4 mm, perfis de fábrica),
// várias peças na mesa com cópias, prévia das camadas, tempo por tipo de caminho e calibração do tempo
// por impressora. O fatiamento roda no worker (a tela do tablet não trava).
// Especificação em docs/global/wjslicer3d.md.

import "../comum/comum.css";
import "./slicer.css";
import { aplicarDispositivo, escapar, escolherArquivo, janela, menu } from "../comum/casca";
import { escolherDoCofre, lerBytesDoCofre, sincronizarAoAbrir } from "../comum/cofre";
import { botaoDiagnostico } from "../comum/diagnostico";
import { registrarComAtualizacao } from "../comum/atualizacao";
import { IC } from "../comum/icones";
import { pegar } from "../comum/transferir";
import { ajustesPadrao, formatarTempo, NOMES_PARTES, PARTES, type Ajustes, type Parte, type Resultado } from "./fatiar";
import { MAQUINAS, maquinaPorId, materiaisDa, materialDa, NOMES_PADROES, type IdMaterial, type Padrao, type TipoSuporte } from "./perfis";
import { VistaMesa } from "./vista";
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
}
const CHAVE = "wjslicer:preferencias";

function lerPreferencias(): Preferencias {
  const padrao: Preferencias = { maquina: MAQUINAS[0].id, material: "pla", precos: {}, ajustes: ajustesPadrao(MAQUINAS[0].processo), calibracao: {} };
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
    return { ...padrao, ...p, maquina, ajustes: aj, precos: p.precos ?? {}, calibracao: p.calibracao ?? {} };
  } catch {
    return padrao;
  }
}
const pref = lerPreferencias();
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

// ---------- worker e vista ----------

const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
const pedir = (p: PedidoSlicer, t: Transferable[] = []) => worker.postMessage(p, t);
aplicarDispositivo();
const vista = new VistaMesa($("sl-vista"));
vista.aoEscolher = (id) => {
  if (id !== null) escolher(id);
};

const CORES: Record<Parte, string> = {
  paredeExt: "#2f7fd0", paredeInt: "#6aa7e3", solido: "#e08a2e", topo: "#d0582f", ponte: "#a35d9e",
  esparso: "#e2b13c", suporte: "#8a96a3", interface: "#5e6b78", borda: "#4bb39b", deslocamento: "#b9c2cc", resfriamento: "#38424d",
};
const CORES_HEX = PARTES.map((p) => parseInt(CORES[p].slice(1), 16));

worker.onmessage = (e: MessageEvent<RespostaSlicer>) => {
  const r = e.data;
  if (r.tipo === "pecas") {
    for (const m of r.malhas) vista.definirMalha(m.id, m.pos, m.tri);
    pecas = r.lista;
    if (r.malhas.length) escolhida = r.malhas[r.malhas.length - 1].id;
    if (!pecas.some((p) => p.id === escolhida)) escolhida = pecas[0]?.id ?? null;
    ultimo = null;
    desenharPecas();
    mostrarLista();
    $("sl-vazio").hidden = pecas.length > 0;
    if (pecas.length) recalcular(0);
    else {
      $("sl-resultado").hidden = true;
      $("sl-previa").hidden = true;
      ligarPrevia(false);
    }
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
const desenharPecas = () => vista.definirPecas(pecas, escolhida, foraDaMesa());

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

const menuAbrir = (b: HTMLElement) => {
  const r = b.getBoundingClientRect();
  menu(r.left, r.bottom + 4, [
    { rotulo: "STL do cofre (WJPDM)…", icone: "pasta", acao: () => void abrirDoCofreSTL() },
    { rotulo: "STL do aparelho…", icone: "abrir", acao: () => void abrirDoAparelho() },
  ]);
};
$("sl-abrir").onclick = () => menuAbrir($("sl-abrir"));
$("sl-adicionar").onclick = () => menuAbrir($("sl-adicionar"));
$("sl-vazio-abrir").onclick = () => menuAbrir($("sl-vazio-abrir"));

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

// ---------- painel: impressora, material, ajustes ----------

const selMaq = $<HTMLSelectElement>("sl-maquina");
for (const m of MAQUINAS) selMaq.append(new Option(`${m.marca} ${m.modelo}`, m.id));
const selMat = $<HTMLSelectElement>("sl-material");
const preco = $<HTMLInputElement>("sl-preco");
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

function preencherPainel() {
  const m = maquina();
  selMaq.value = m.id;
  const mats = materiaisDa(m);
  selMat.innerHTML = "";
  for (const x of mats) selMat.append(new Option(x.nome, x.id));
  if (!mats.some((x) => x.id === pref.material)) pref.material = mats[0].id;
  selMat.value = pref.material;
  const mat = materialDa(m, pref.material);
  preco.value = String(pref.precos[pref.material] ?? mat.precoKg);
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
}

const inteiro = (inp: HTMLInputElement, min: number, max: number) => Math.max(min, Math.min(max, Math.round(Number(inp.value) || 0)));

function lerPainel() {
  pref.material = selMat.value as IdMaterial;
  const p = Number(preco.value.replace(",", "."));
  if (p > 0) pref.precos[pref.material] = p;
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
}

selMaq.onchange = () => {
  // outra impressora: valores de fábrica dela (o perfil muda paredes, cascas e o padrão)
  const { suporte, borda, saia, preenchimento } = pref.ajustes;
  pref.maquina = selMaq.value;
  pref.ajustes = { ...ajustesPadrao(maquina().processo), suporte, borda, saia, preenchimento };
  vista.definirMesa(...maquina().mesa);
  vista.enquadrar();
  preencherPainel();
  guardar();
  avisarMesa(); // reorganiza na mesa nova e recalcula
};
selMat.onchange = () => {
  lerPainel();
  preencherPainel();
  recalcular();
};
for (const inp of [preco, selAltura, ...Object.values(campos)])
  inp.addEventListener(inp === campos.preenchimento ? "input" : "change", () => {
    $("sl-preench-v").textContent = `${campos.preenchimento.value}%`;
    const borda = pref.ajustes.borda;
    lerPainel();
    if (pref.ajustes.borda !== borda) avisarMesa(); // a borda precisa de mais folga entre as peças
    else recalcular();
  });
for (const b of document.querySelectorAll<HTMLButtonElement>("[data-passo]"))
  b.onclick = () => {
    const inp = $<HTMLInputElement>(b.dataset.alvo!);
    inp.value = String(Number(inp.value) + Number(b.dataset.passo));
    inp.dispatchEvent(new Event("change"));
  };
$("sl-padrao").onclick = () => {
  const { suporte, borda, saia } = pref.ajustes;
  pref.ajustes = { ...ajustesPadrao(maquina().processo), suporte, borda, saia };
  preencherPainel();
  guardar();
  recalcular();
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
    const mat = materialDa(maquina(), pref.material);
    pedir({ tipo: "estimar", seq, maquina: pref.maquina, material: pref.material, precoKg: pref.precos[pref.material] ?? mat.precoKg, ajustes: pref.ajustes });
  }, atraso);
}

function mostrarResultado() {
  const r = ultimo!;
  $("sl-ocupado").hidden = true;
  const fator = pref.calibracao[pref.maquina] ?? 1;
  const tempo = r.tempoS * fator;
  $("sl-resultado").hidden = false;
  $("sl-tempo").textContent = formatarTempo(tempo);
  $("sl-massa").textContent = `${num(r.massaG, 1)} g`;
  $("sl-dados").innerHTML = `
    <div><dt>Filamento (1,75 mm)</dt><dd>${num(r.comprimentoM, 2)} m</dd></div>
    <div><dt>Custo do material</dt><dd>R$ ${num(r.custo, 2)}</dd></div>
    <div><dt>Preparo típico (aquecer, nivelar)</dt><dd>+ ${formatarTempo(r.preparoS)}</dd></div>
    <div><dt>Total com preparo</dt><dd>${formatarTempo(tempo + r.preparoS)}</dd></div>
    <div><dt>Camadas</dt><dd>${num(r.camadas)}</dd></div>
    <div><dt>${r.copias > 1 ? `Volume das ${r.copias} peças` : "Volume da peça"}</dt><dd>${r.volumePeca === null ? "—" : `${num(r.volumePeca / 1000, 2)} cm³`}</dd></div>`;
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
}

// ---------- prévia das camadas ----------

const deslizante = $<HTMLInputElement>("sl-camada");
function prepararPrevia() {
  const r = ultimo!;
  $("sl-previa").hidden = false;
  const max = r.camadas - 1;
  const ia = Number(deslizante.value);
  deslizante.max = String(max);
  if (!previaLigada || ia > max) deslizante.value = String(max);
  if (previaLigada) pedirCamada();
  $("sl-legenda").innerHTML = PARTES.filter((k) => k !== "deslocamento" && k !== "resfriamento" && r.partes[k].volume > 0.5)
    .map((k) => `<span><i style="background:${CORES[k]}"></i>${NOMES_PARTES[k]}</span>`)
    .join("");
}
let pedidoCamada = 0;
function pedirCamada() {
  cancelAnimationFrame(pedidoCamada);
  pedidoCamada = requestAnimationFrame(() => pedir({ tipo: "camada", seq, i: Number(deslizante.value) }));
}
function ligarPrevia(on: boolean) {
  previaLigada = on;
  $("sl-camadas").setAttribute("aria-pressed", String(on));
  $("sl-deslizante").hidden = !on;
  $("sl-legenda").hidden = !on;
  if (on) pedirCamada();
  else vista.mostrarCamada(null);
}
$("sl-camadas").onclick = () => ligarPrevia(!previaLigada);
deslizante.addEventListener("input", pedirCamada);
for (const b of document.querySelectorAll<HTMLButtonElement>("[data-camada]"))
  b.onclick = () => {
    deslizante.value = String(Math.max(0, Math.min(Number(deslizante.max), Number(deslizante.value) + Number(b.dataset.camada))));
    pedirCamada();
  };

// ---------- calibração do tempo ----------

$("sl-calibrar").onclick = () => {
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
};

// ---------- início ----------

$("sl-versao").textContent = `v${__VERSAO__}`;
const diag = botaoDiagnostico("wj-ic");
if (diag) $("sl-direita").append(diag);
$("sl-abrir").insertAdjacentHTML("afterbegin", IC.abrir);
vista.definirMesa(...maquina().mesa);
vista.enquadrar();
preencherPainel();
mostrarLista();
avisarMesa();
registrarComAtualizacao();
void sincronizarAoAbrir()?.catch(() => {});
if (location.hash === "#peca-do-cad") void pecaDoCad();
