// Imagens → modelo 3D (fase 1, docs/global/cad.md §5): página do WJCAD aberta em aba nova.
// Até 8 fotos das vistas (fundo liso) → silhuetas → casco visual esculpido no worker → malha com a
// quantidade de faces escolhida → "Abrir na Peça" (corpo de malha / sólido) ou "Salvar STL…".

import "../comum/comum.css";
import "./imagem3d.css";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { FACES, VISTAS, type Eixo, type NomeVista } from "./casco";
import type { PedidoImg, RespostaImg } from "./worker";
import { aplicarDispositivo, janela } from "../comum/casca";
import { exportarComo } from "../comum/cofre";
import { deixarArquivo } from "../comum/transferir";
import { abrirEmNovaJanela } from "../comum/janelas";
import { registrarComAtualizacao } from "../comum/atualizacao";

aplicarDispositivo();
registrarComAtualizacao();

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const fmt = (v: number, d = 1) => v.toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });
const status = (t: string) => ($("im-status").textContent = t);
/** maior lado da foto levada ao worker (mais que isso só gasta memória: a grade tem ~400 células) */
const LADO_MAX = 1024;

// ---------------------------------------------------------------------------------------------
// fotos das vistas

interface Foto {
  img: ImageBitmap;
  w: number;
  h: number;
  rgba: Uint8ClampedArray;
  mascara?: Uint8Array;
  caixa?: [number, number, number, number];
  erro?: string;
  seq: number;
}
const fotos: Partial<Record<NomeVista, Foto>> = {};
let seq = 0;

const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
const pedir = (p: PedidoImg, t: Transferable[] = []) => worker.postMessage(p, t);

function cartoes() {
  $("im-vistas").innerHTML = VISTAS.map((v) => {
    const f = fotos[v.nome];
    return `<div class="im-cartao${f ? " tem" : ""}${f?.erro ? " erro" : ""}" data-v="${v.nome}">
      <button class="im-foto" data-acao="foto" title="${f ? "Trocar a foto" : "Escolher ou tirar a foto"} — ${v.dica}">
        ${f ? `<canvas width="${f.w}" height="${f.h}"></canvas>` : `<span class="im-mais">+</span>`}
      </button>
      <div class="im-rotulo"><b>${v.rotulo}</b>${f ? `<button class="im-x" data-acao="tirar" title="Tirar a foto" aria-label="Tirar a foto de ${v.rotulo}">✕</button>` : ""}</div>
      <small>${f?.erro ? f.erro : f ? (f.mascara ? "silhueta em vermelho" : "recortando…") : v.dica}</small>
    </div>`;
  }).join("");
  for (const v of VISTAS) desenharFoto(v.nome);
  $("im-vistas").querySelectorAll<HTMLButtonElement>("[data-acao]").forEach((b) => {
    const v = b.closest<HTMLElement>("[data-v]")!.dataset.v as NomeVista;
    b.onclick = () => (b.dataset.acao === "tirar" ? tirar(v) : escolher(v));
  });
  ($("im-gerar") as HTMLButtonElement).disabled = Object.values(fotos).filter((f) => f?.mascara).length < 2;
}

/** miniatura com a silhueta em vermelho e a caixa do contorno */
function desenharFoto(v: NomeVista) {
  const f = fotos[v];
  const cv = $("im-vistas").querySelector<HTMLCanvasElement>(`[data-v="${v}"] canvas`);
  if (!f || !cv) return;
  const c = cv.getContext("2d")!;
  c.drawImage(f.img, 0, 0, f.w, f.h);
  if (!f.mascara) return;
  const id = c.getImageData(0, 0, f.w, f.h);
  const d = id.data, m = f.mascara;
  for (let i = 0; i < m.length; i++)
    if (m[i]) {
      d[i * 4] = (d[i * 4] + 230) >> 1;
      d[i * 4 + 1] = d[i * 4 + 1] >> 1;
      d[i * 4 + 2] = d[i * 4 + 2] >> 1;
    }
  c.putImageData(id, 0, 0);
  if (f.caixa) {
    const [x0, y0, x1, y1] = f.caixa;
    c.strokeStyle = "#2f7fd0";
    c.lineWidth = Math.max(2, f.w / 200);
    c.strokeRect(x0, y0, x1 - x0 + 1, y1 - y0 + 1);
  }
}

let vistaEscolhendo: NomeVista | null = null;
function escolher(v: NomeVista) {
  vistaEscolhendo = v;
  const inp = $<HTMLInputElement>("im-arquivo");
  inp.value = "";
  inp.click();
}
$<HTMLInputElement>("im-arquivo").onchange = async (e) => {
  const arq = (e.target as HTMLInputElement).files?.[0];
  const v = vistaEscolhendo;
  if (!arq || !v) return;
  try {
    const bruto = await createImageBitmap(arq);
    const k = Math.min(1, LADO_MAX / Math.max(bruto.width, bruto.height));
    const w = Math.max(8, Math.round(bruto.width * k)), h = Math.max(8, Math.round(bruto.height * k));
    const img = await createImageBitmap(bruto, { resizeWidth: w, resizeHeight: h, resizeQuality: "high" });
    bruto.close();
    const cv = new OffscreenCanvas(w, h);
    const c = cv.getContext("2d")!;
    c.drawImage(img, 0, 0);
    fotos[v]?.img.close();
    fotos[v] = { img, w, h, rgba: c.getImageData(0, 0, w, h).data, seq: 0 };
    recortar(v);
    cartoes();
  } catch (err) {
    status(`Não consegui ler a imagem: ${(err as Error).message}`);
  }
};

function tirar(v: NomeVista) {
  fotos[v]?.img.close();
  delete fotos[v];
  pedir({ tipo: "remover", vista: v });
  cartoes();
}

const tolerancia = () => Number($<HTMLInputElement>("im-tol").value);
function recortar(v: NomeVista) {
  const f = fotos[v];
  if (!f) return;
  f.seq = ++seq;
  f.mascara = f.caixa = f.erro = undefined;
  // cópia: a foto continua aqui para recortar de novo com outra tolerância
  const rgba = f.rgba.slice();
  pedir({ tipo: "silhueta", vista: v, w: f.w, h: f.h, rgba, tol: tolerancia(), seq: f.seq }, [rgba.buffer]);
}

let tTol = 0;
$<HTMLInputElement>("im-tol").oninput = () => {
  $("im-tol-v").textContent = String(tolerancia());
  clearTimeout(tTol);
  tTol = window.setTimeout(() => {
    for (const v of Object.keys(fotos) as NomeVista[]) recortar(v);
    cartoes();
  }, 250);
};

// ---------------------------------------------------------------------------------------------
// faces, medida, gerar

let faces: number = Number(localStorage.getItem("wjcad:imagem3dFaces")) || 500_000;
if (!FACES.includes(faces as (typeof FACES)[number])) faces = 500_000;
function segmentos() {
  const rot = (n: number) => (n >= 1e6 ? `${fmt(n / 1e6, n % 1e6 ? 1 : 0)} M` : `${n / 1000} mil`);
  $("im-faces").innerHTML = FACES.map((n) => `<button role="radio" aria-checked="${n === faces}" data-n="${n}" class="${n === faces ? "sel" : ""}">${rot(n)}</button>`).join("");
  $("im-faces").querySelectorAll<HTMLButtonElement>("button").forEach((b) => (b.onclick = () => {
    faces = Number(b.dataset.n);
    localStorage.setItem("wjcad:imagem3dFaces", String(faces));
    segmentos();
  }));
}

let resultado: { stl: Uint8Array; nome: string } | null = null;
let gerando = false;
$("im-gerar").onclick = () => {
  if (gerando) return;
  const valor = Number($<HTMLInputElement>("im-valor").value);
  if (!(valor > 0)) return status("Digite a medida conhecida em mm (maior que zero).");
  gerando = true;
  ($("im-gerar") as HTMLButtonElement).disabled = true;
  status("Gerando…");
  const nome = `Modelo de imagens ${new Date().toLocaleDateString("pt-BR").replace(/\//g, "-")}`;
  resultado = { stl: new Uint8Array(), nome };
  pedir({ tipo: "gerar", medida: { eixo: $<HTMLSelectElement>("im-eixo").value as Eixo, valor }, faces, nome });
};

worker.onmessage = (e: MessageEvent<RespostaImg>) => {
  const r = e.data;
  if (r.tipo === "silhueta") {
    const f = fotos[r.vista];
    if (!f || f.seq !== r.seq) return; // trocada ou recortada de novo enquanto isso
    f.mascara = r.mascara;
    f.caixa = r.caixa;
    f.erro = r.erro;
    cartoes();
    return;
  }
  if (r.tipo === "andamento") return status(r.texto);
  gerando = false;
  cartoes();
  if (r.tipo === "erro") return status(`Não foi possível gerar: ${r.texto}`);
  resultado = { stl: r.stl, nome: resultado?.nome ?? "Modelo de imagens" };
  vista.mostrar(r.vertices, r.normais, r.triangulos);
  $("im-vazio").hidden = true;
  $("im-resultado").hidden = false;
  $("im-info").innerHTML = `<b>${fmt(r.dim.W)} × ${fmt(r.dim.H)} × ${fmt(r.dim.D)} mm</b> · ${r.faces.toLocaleString("pt-BR")} faces${r.volume !== null ? ` · ${fmt(Math.abs(r.volume) / 1000)} cm³` : ""}`;
  status(`Pronto em ${fmt(r.ms / 1000)} s (grade ${r.N}). Gire com um dedo; aproxime com dois.`);
};

$("im-peca").onclick = async () => {
  if (!resultado?.stl.length) return;
  await deixarArquivo(`${resultado.nome}.stl`, resultado.stl.slice());
  abrirEmNovaJanela(new URL(`${import.meta.env.BASE_URL}cad/#abrir-arquivo`, location.href).href);
};
$("im-salvar").onclick = async () => {
  if (!resultado?.stl.length) return;
  const stl = resultado.stl;
  status(await exportarComo("cad", resultado.nome, [{ ext: "stl", rotulo: "STL (*.stl) — malha" }], async () => new Blob([stl as BlobPart])));
};

$("im-ajuda").onclick = () =>
  janela("Como fotografar", `<ul class="im-dicas">
    <li><b>Fundo liso</b> de uma cor só, diferente da peça (papel ou parede). Sem sombra forte.</li>
    <li>Peça <b>inteira</b> na foto e sem nada encostado nela.</li>
    <li>Fique <b>longe e use o zoom</b>: quanto menos perspectiva, mais fiel (o cálculo supõe vista ortogonal).</li>
    <li>Vistas <b>retas</b>: Frente, Trás, Esquerda, Direita, Cima (frente da peça embaixo na foto), Baixo (frente em cima). Diagonais a 45°, na altura da peça.</li>
    <li>Pelo menos <b>2 direções</b> (ex.: frente e lado); com frente, lado e cima o formato fecha bem. Cavidades que não aparecem no contorno de nenhuma vista não saem.</li>
    <li>Ajuste a <b>tolerância</b> até a silhueta vermelha cobrir só a peça.</li>
  </ul>`);

// ---------------------------------------------------------------------------------------------
// vista 3D (ortográfica, Y para cima, tema claro como no WJCAD)

class Vista {
  private renderer = new THREE.WebGLRenderer({ antialias: true });
  private cena = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -1e5, 1e5);
  private ctl: OrbitControls;
  private malha = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial({ color: 0xb7c3cf, roughness: 0.55, metalness: 0.1 }));
  private raio = 50;
  private quadro = 0;
  constructor(private alvo: HTMLElement) {
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setClearColor(0xf4f6f8);
    alvo.append(this.renderer.domElement);
    const luz = new THREE.DirectionalLight(0xffffff, 1.6);
    luz.position.set(1, 2, 1.5);
    this.camera.add(luz);
    this.cena.add(this.camera, new THREE.HemisphereLight(0xffffff, 0x8899aa, 1.1), this.malha);
    this.ctl = new OrbitControls(this.camera, this.renderer.domElement);
    this.ctl.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.ROTATE, RIGHT: THREE.MOUSE.PAN };
    this.ctl.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
    this.ctl.zoomToCursor = true;
    this.ctl.addEventListener("change", () => this.desenhar());
    new ResizeObserver(() => this.ajustar()).observe(alvo);
  }
  private ajustar() {
    const w = Math.max(1, this.alvo.clientWidth), h = Math.max(1, this.alvo.clientHeight);
    this.renderer.setSize(w, h);
    const a = w / h, r = this.raio * 1.2;
    Object.assign(this.camera, { left: -r * a, right: r * a, top: r, bottom: -r });
    this.camera.updateProjectionMatrix();
    this.desenhar();
  }
  mostrar(v: Float32Array, n: Float32Array, t: Uint32Array) {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(v, 3));
    g.setAttribute("normal", new THREE.BufferAttribute(n, 3));
    g.setIndex(new THREE.BufferAttribute(t, 1));
    g.computeBoundingSphere();
    this.malha.geometry.dispose();
    this.malha.geometry = g;
    const s = g.boundingSphere!;
    this.raio = s.radius || 50;
    this.ctl.target.copy(s.center);
    this.camera.position.copy(s.center).add(new THREE.Vector3(1, 0.8, 1.2).normalize().multiplyScalar(this.raio * 4));
    this.camera.zoom = 1;
    this.ctl.update();
    this.ajustar();
  }
  desenhar() {
    if (this.quadro) return;
    this.quadro = requestAnimationFrame(() => {
      this.quadro = 0;
      this.renderer.render(this.cena, this.camera);
    });
  }
}
const vista = new Vista($("im-3d"));

segmentos();
cartoes();
