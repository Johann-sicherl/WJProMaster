// WJSlicer3D: estimativa de tempo de impressão e de material de uma peça STL, sem gerar G-code e
// sem mandar para a impressora. Perfis de fábrica (bico 0,4 mm, 0,20 mm padrão) das impressoras
// Bambu Lab e Anycubic; ajustes básicos (camada, paredes, cascas, preenchimento, suporte, borda).
// Especificação em docs/global/wjslicer3d.md.

import "../comum/comum.css";
import "./slicer.css";
import { aplicarDispositivo, el, escapar, escolherArquivo, janela, menu } from "../comum/casca";
import { escolherDoCofre, lerBytesDoCofre, sincronizarAoAbrir } from "../comum/cofre";
import { botaoDiagnostico } from "../comum/diagnostico";
import { registrarComAtualizacao } from "../comum/atualizacao";
import { IC } from "../comum/icones";
import { pegar } from "../comum/transferir";
import { ajustesPadrao, formatarTempo, NOMES_PARTES, type Ajustes, type Parte, type Resultado } from "./fatiar";
import { MAQUINAS, maquinaPorId, materiaisDa, materialDa, type IdMaterial } from "./perfis";
import { VistaMesa } from "./vista";
import type { PedidoSlicer, RespostaSlicer } from "./worker";

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
  const maq = MAQUINAS[0];
  const padrao: Preferencias = { maquina: maq.id, material: "pla", precos: {}, ajustes: ajustesPadrao(maq.processo), calibracao: {} };
  try {
    const p = JSON.parse(localStorage.getItem(CHAVE) ?? "null") as Partial<Preferencias> | null;
    if (!p) return padrao;
    return { ...padrao, ...p, ajustes: { ...padrao.ajustes, ...p.ajustes }, precos: p.precos ?? {}, calibracao: p.calibracao ?? {} };
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

let nomePeca = "";
let temPeca = false;
let dimensoes: [number, number, number] | null = null;
let ultimo: Resultado | null = null;
let seq = 0;

// ---------- worker e vista ----------

const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
const pedir = (p: PedidoSlicer, t: Transferable[] = []) => worker.postMessage(p, t);
aplicarDispositivo();
const vista = new VistaMesa($("sl-vista"));

worker.onmessage = (e: MessageEvent<RespostaSlicer>) => {
  const r = e.data;
  if (r.tipo === "malha") {
    temPeca = true;
    dimensoes = caixa(r.pos);
    vista.definirPeca(r.pos, r.tri, cabeNaMesa());
    $("sl-vazio").hidden = true;
    mostrarPeca(r.tri.length / 3);
    recalcular(0);
  } else if (r.tipo === "progresso" && r.seq === seq) {
    $("sl-barra").style.width = `${Math.round(r.f * 100)}%`;
  } else if (r.tipo === "resultado" && r.seq === seq) {
    ultimo = r.r;
    mostrarResultado();
  } else if (r.tipo === "erro" && (r.seq === undefined || r.seq === seq)) {
    $("sl-ocupado").hidden = true;
    avisar(r.msg);
  }
};

function caixa(pos: Float32Array): [number, number, number] {
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i += 3)
    for (let k = 0; k < 3; k++) {
      if (pos[i + k] < mn[k]) mn[k] = pos[i + k];
      if (pos[i + k] > mx[k]) mx[k] = pos[i + k];
    }
  return [mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]];
}

const maquina = () => maquinaPorId(pref.maquina);
const cabeNaMesa = () => {
  const m = maquina();
  return !dimensoes || (dimensoes[0] <= m.mesa[0] && dimensoes[1] <= m.mesa[1] && dimensoes[2] <= m.alturaMax);
};

let avisoT = 0;
function avisar(msg: string, ms = 5000) {
  const a = $("sl-aviso");
  a.textContent = msg;
  a.hidden = false;
  clearTimeout(avisoT);
  avisoT = window.setTimeout(() => (a.hidden = true), ms);
}

// ---------- abrir ----------

function abrirBytes(nome: string, bytes: Uint8Array) {
  nomePeca = nome.replace(/\.stl$/i, "");
  pedir({ tipo: "stl", bytes }, [bytes.buffer]);
}

async function abrirDoAparelho() {
  const a = await escolherArquivo(true);
  if (!a?.dados) return;
  if (!/\.stl$/i.test(a.nome)) return avisar(`${a.nome} não é um arquivo STL.`);
  abrirBytes(a.nome, new Uint8Array(a.dados));
}

async function abrirDoCofreSTL() {
  const arq = await escolherDoCofre("cad", "Abrir STL do cofre — WJSlicer3D", ["stl"], "Malhas STL: .stl", "Abrir");
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
  nomePeca = p.nome;
  pedir({ tipo: "cad", vertices: p.vertices, triangulos: p.triangulos });
}

$("sl-abrir").onclick = () => {
  const r = $("sl-abrir").getBoundingClientRect();
  menu(r.left, r.bottom + 4, [
    { rotulo: "STL do cofre (WJPDM)…", icone: "pasta", acao: () => void abrirDoCofreSTL() },
    { rotulo: "STL do aparelho…", icone: "abrir", acao: () => void abrirDoAparelho() },
  ]);
};
$("sl-vazio-abrir").onclick = () => $("sl-abrir").click();

// ---------- painel: peça e orientação ----------

function mostrarPeca(triangulos: number) {
  const d = dimensoes!;
  $("sl-peca").innerHTML = `<strong>${escapar(nomePeca || "Peça")}</strong>
    <span>${num(d[0], 1)} × ${num(d[1], 1)} × ${num(d[2], 1)} mm (X × Y × Z) · ${num(triangulos)} triângulos</span>`;
  for (const b of document.querySelectorAll<HTMLButtonElement>("[data-girar], #sl-apoio")) b.disabled = false;
}

for (const b of document.querySelectorAll<HTMLButtonElement>("[data-girar]"))
  b.onclick = () => pedir({ tipo: "girar", eixo: b.dataset.girar as "x" | "y" | "z", quartos: 1 });
$("sl-apoio").onclick = () => pedir({ tipo: "apoio" });

// ---------- painel: impressora, material, ajustes ----------

const selMaq = $<HTMLSelectElement>("sl-maquina");
for (const marca of ["Bambu Lab", "Anycubic"]) {
  const g = el("optgroup", { label: marca });
  for (const m of MAQUINAS.filter((x) => x.marca === marca)) g.append(new Option(`${m.marca} ${m.modelo}`, m.id));
  selMaq.append(g);
}
const selMat = $<HTMLSelectElement>("sl-material");
const preco = $<HTMLInputElement>("sl-preco");
const selAltura = $<HTMLSelectElement>("sl-altura");
for (const h of [0.08, 0.12, 0.16, 0.2, 0.24, 0.28]) selAltura.append(new Option(`${num(h, 2)} mm`, String(h)));
const campos = {
  paredes: $<HTMLInputElement>("sl-paredes"),
  topo: $<HTMLInputElement>("sl-topo"),
  fundo: $<HTMLInputElement>("sl-fundo"),
  preenchimento: $<HTMLInputElement>("sl-preench"),
  suporte: $<HTMLInputElement>("sl-suporte"),
  borda: $<HTMLInputElement>("sl-borda"),
};

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
  campos.suporte.checked = a.suporte;
  campos.borda.checked = a.borda;
  $("sl-maq-info").textContent = `Mesa ${m.mesa[0]} × ${m.mesa[1]} × ${m.alturaMax} mm · bico 0,4 mm · ${mat.nome}: ${num(mat.densidade, 2)} g/cm³, até ${num(mat.vazaoMax, 1)} mm³/s`;
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
    suporte: campos.suporte.checked,
    borda: campos.borda.checked,
  };
  guardar();
}

selMaq.onchange = () => {
  // outra impressora: valores de fábrica dela (o perfil muda paredes e cascas)
  const suporte = pref.ajustes.suporte, borda = pref.ajustes.borda, preench = pref.ajustes.preenchimento;
  pref.maquina = selMaq.value;
  pref.ajustes = { ...ajustesPadrao(maquina().processo), suporte, borda, preenchimento: preench };
  vista.definirMesa(...maquina().mesa);
  vista.enquadrar();
  preencherPainel();
  guardar();
  if (temPeca) atualizarCorDaPeca();
  recalcular();
};
selMat.onchange = () => {
  lerPainel();
  preencherPainel();
  recalcular();
};
for (const inp of [preco, selAltura, ...Object.values(campos)])
  inp.addEventListener(inp === campos.preenchimento ? "input" : "change", () => {
    $("sl-preench-v").textContent = `${campos.preenchimento.value}%`;
    lerPainel();
    recalcular();
  });
for (const b of document.querySelectorAll<HTMLButtonElement>("[data-passo]"))
  b.onclick = () => {
    const inp = $<HTMLInputElement>(b.dataset.alvo!);
    inp.value = String(Number(inp.value) + Number(b.dataset.passo));
    inp.dispatchEvent(new Event("change"));
  };
$("sl-padrao").onclick = () => {
  pref.ajustes = { ...ajustesPadrao(maquina().processo), suporte: pref.ajustes.suporte, borda: pref.ajustes.borda };
  preencherPainel();
  guardar();
  recalcular();
};

function atualizarCorDaPeca() {
  pedir({ tipo: "girar", eixo: "z", quartos: 0 }); // reenvia a malha: a cor indica se cabe na mesa
}

// ---------- estimativa ----------

let espera = 0;
function recalcular(atraso = 250) {
  if (!temPeca) return;
  clearTimeout(espera);
  espera = window.setTimeout(() => {
    seq++;
    $("sl-ocupado").hidden = false;
    $("sl-barra").style.width = "0%";
    const mat = materialDa(maquina(), pref.material);
    pedir({ tipo: "estimar", seq, maquina: pref.maquina, material: pref.material, precoKg: pref.precos[pref.material] ?? mat.precoKg, ajustes: pref.ajustes });
  }, atraso);
}

const CORES: Record<Parte, string> = {
  paredeExt: "#2f7fd0", paredeInt: "#6aa7e3", solido: "#e08a2e", topo: "#d0582f", ponte: "#a35d9e",
  esparso: "#f2c14e", suporte: "#8a96a3", borda: "#4bb39b", deslocamento: "#b9c2cc", resfriamento: "#5e6b78",
};

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
    <div><dt>Volume da peça</dt><dd>${r.volumePeca === null ? "—" : `${num(r.volumePeca / 1000, 2)} cm³`}</dd></div>`;
  const total = Object.values(r.partes).reduce((s, p) => s + p.tempo, 0) || 1;
  const linhas = (Object.keys(NOMES_PARTES) as Parte[])
    .filter((k) => r.partes[k].tempo > 0.5 || r.partes[k].volume > 0.5)
    .map((k) => {
      const p = r.partes[k], pct = (p.tempo / total) * 100;
      const g = (p.volume / 1000) * materialDa(maquina(), pref.material).densidade;
      return `<tr><td><i style="background:${CORES[k]}"></i>${NOMES_PARTES[k]}</td><td>${formatarTempo(p.tempo * fator)}</td><td>${num(pct, 0)}%</td><td>${g > 0.05 ? `${num(g, 1)} g` : ""}</td></tr>`;
    });
  $("sl-partes").innerHTML = `<thead><tr><th>Parte</th><th>Tempo</th><th></th><th>Material</th></tr></thead><tbody>${linhas.join("")}</tbody>`;
  const barra = (Object.keys(NOMES_PARTES) as Parte[]).map((k) => `<span style="flex:${r.partes[k].tempo};background:${CORES[k]}" title="${NOMES_PARTES[k]}"></span>`);
  $("sl-faixa").innerHTML = barra.join("");
  const av = $("sl-avisos");
  av.innerHTML = r.avisos.map((a) => `<p>⚠ ${escapar(a)}</p>`).join("");
  av.hidden = !r.avisos.length;
}

// ---------- calibração do tempo ----------

$("sl-calibrar").onclick = () => {
  if (!ultimo) return avisar("Abra uma peça primeiro.");
  const m = maquina();
  const f = pref.calibracao[m.id];
  janela(
    `Calibrar o tempo — ${m.marca} ${m.modelo}`,
    `<p>Para deixar a estimativa igual à sua realidade: com esta mesma peça e estes ajustes, informe o tempo que a impressora levou de fato (ou o que o seu fatiador mostrou). O fator fica guardado para esta impressora.</p>
     <p>Estimativa sem calibração: <strong>${formatarTempo(ultimo.tempoS)}</strong>${f ? ` · fator atual × ${num(f, 2)}` : ""}</p>
     <div class="sl-cal"><label>Horas <input id="sl-cal-h" type="number" min="0" step="1" value="0" inputmode="numeric"></label>
     <label>Minutos <input id="sl-cal-m" type="number" min="0" max="59" step="1" value="0" inputmode="numeric"></label></div>`,
    [
      { rotulo: "Cancelar" },
      ...(f ? [{ rotulo: "Remover calibração", acao: () => {
        delete pref.calibracao[m.id];
        guardar();
        preencherPainel();
        mostrarResultado();
      } }] : []),
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
            avisar("O tempo informado difere demais da estimativa (mais de 3 vezes): confira a peça e os ajustes.");
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
registrarComAtualizacao();
void sincronizarAoAbrir()?.catch(() => {});
if (location.hash === "#peca-do-cad") void pecaDoCad();
