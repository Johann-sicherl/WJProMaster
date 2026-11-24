// Encaixe de fixadores da biblioteca em furos da Montagem — regras PURAS (sem DOM, sem kernel):
// achar os furos (face cilíndrica côncava), a entrada de cada lado, a pose do fixador, os dois
// posicionamentos (concêntrico + coincidente/distância), os "furos iguais" e o comprimento sugerido.
// Testado em scripts/teste-biblioteca.ts. Comportamento: docs/funcional/biblioteca.md.

import type { AssinaturaFace, Vec3 } from "../model";
import type { MalhaPeca } from "../kernel/regenerar";
import type { Topologia } from "../kernel/topologia";
import { aplicarDirecao, aplicarPonto, novoIdM, type Posicionamento, type Quat, type Transformacao } from "../montagem/modelo";

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const soma = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const norma = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const unit = (a: Vec3): Vec3 => mul(a, 1 / (norma(a) || 1));
const cruz = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** Furo de um componente, em coordenadas da montagem (a face continua na peça, para a referência do posicionamento). */
export interface Furo {
  comp: string;
  /** índice da face na topologia da peça */
  indice: number;
  face: AssinaturaFace;
  /** centro do furo no meio do comprimento (montagem) */
  centro: Vec3;
  /** direção do eixo (unitária, montagem) */
  eixo: Vec3;
  /** raio (mm) e comprimento do furo = espessura atravessada */
  raio: number;
  comprimento: number;
}

/** Face cilíndrica côncava (a normal do material aponta para o eixo) = furo. Usa a malha da peça. */
export function ehFuro(malha: MalhaPeca, topo: Topologia, indice: number): boolean {
  const f = topo.faces[indice];
  if (!f || f.geom !== "cilindro" || !f.eixo || !f.pontoEixo || !f.raio) return false;
  const d = unit(f.eixo);
  // malha.faces = trincas (início em `triangulos`, quantidade, id): o índice da face é a posição da trinca
  const i = indice * 3;
  if (i + 2 < malha.faces.length) {
    const t0 = malha.faces[i];
    for (let k = 0; k < 3; k++) {
      const vi = malha.triangulos[t0 + k] * 3;
      const v: Vec3 = [malha.vertices[vi], malha.vertices[vi + 1], malha.vertices[vi + 2]];
      const n: Vec3 = [malha.normais[vi], malha.normais[vi + 1], malha.normais[vi + 2]];
      const rel = sub(v, f.pontoEixo);
      const radial = sub(rel, mul(d, dot(rel, d)));
      if (norma(radial) < 1e-9) continue;
      return dot(n, unit(radial)) < 0;
    }
  }
  return false;
}

/** Furos do componente (faces cilíndricas côncavas inteiras ou quase), com a pose aplicada. */
export function furosDoComponente(comp: string, t: Transformacao, topo: Topologia, malha: MalhaPeca): Furo[] {
  const out: Furo[] = [];
  topo.faces.forEach((f, indice) => {
    if (f.geom !== "cilindro" || !f.eixo || !f.pontoEixo || !f.raio) return;
    if (!ehFuro(malha, topo, indice)) return;
    const comprimento = f.area / (2 * Math.PI * f.raio);
    if (!(comprimento > 0)) return;
    out.push({ comp, indice, face: f, centro: aplicarPonto(t, f.centro), eixo: unit(aplicarDirecao(t, f.eixo)), raio: f.raio, comprimento });
  });
  return out;
}

/** Furos iguais ao tocado: mesmo raio (±0,01 mm), eixo paralelo e o mesmo comprimento (±0,05 mm), de qualquer componente. */
export function furosIguais(todos: Furo[], base: Furo): Furo[] {
  return todos.filter((f) => !(f.comp === base.comp && f.indice === base.indice)
    && Math.abs(f.raio - base.raio) <= 0.01
    && Math.abs(Math.abs(dot(f.eixo, base.eixo)) - 1) <= 1e-4
    && Math.abs(f.comprimento - base.comprimento) <= 0.05);
}

/** Face plana do componente (com a pose aplicada), para achar a face em que o fixador apoia. */
export interface FacePlana {
  comp: string;
  indice: number;
  face: AssinaturaFace;
  centro: Vec3;
  normal: Vec3;
}
export function planasDoComponente(comp: string, t: Transformacao, topo: Topologia): FacePlana[] {
  const out: FacePlana[] = [];
  topo.faces.forEach((f, indice) => {
    if (f.geom === "plano" && f.normal) out.push({ comp, indice, face: f, centro: aplicarPonto(t, f.centro), normal: unit(aplicarDirecao(t, f.normal)) });
  });
  return out;
}

/** Entrada do furo por um dos lados: ponto na borda, direção para fora (= +Y do fixador) e a face de apoio, se houver. */
export interface Entrada {
  lado: 1 | -1;
  origem: Vec3;
  /** normal para fora da peça (montagem) */
  u: Vec3;
  apoio?: FacePlana;
}

export function entradaDoFuro(f: Furo, lado: 1 | -1, planas: FacePlana[]): Entrada {
  const u = mul(f.eixo, lado);
  const origem = soma(f.centro, mul(u, f.comprimento / 2));
  const apoio = planas.find((p) => p.comp === f.comp && dot(p.normal, u) > 0.9999 && Math.abs(dot(sub(p.centro, origem), u)) < 0.01);
  return { lado, origem, u, ...(apoio ? { apoio } : {}) };
}

/** Lado que olha para a câmera: o fixador entra por ele. `paraCamera` = direção do furo até o olho. */
export function ladoParaCamera(f: Furo, paraCamera: Vec3): 1 | -1 {
  return dot(f.eixo, paraCamera) >= 0 ? 1 : -1;
}

/** Rotação que leva +Y para `u`. */
export function quatDeY(u: Vec3): Quat {
  const y: Vec3 = [0, 1, 0];
  const c = dot(y, u);
  if (c > 1 - 1e-12) return [0, 0, 0, 1];
  if (c < -1 + 1e-12) return [1, 0, 0, 0];
  const e = cruz(y, u);
  const s = norma(e);
  const a = Math.atan2(s, c) / 2;
  const k = Math.sin(a) / s;
  return [e[0] * k, e[1] * k, e[2] * k, Math.cos(a)];
}

/** Pose do fixador: origem na entrada (mais o deslocamento do empilhamento) e o eixo Y apontando para fora. */
export function poseDoFixador(e: Entrada, deslocamento = 0): Transformacao {
  return { pos: soma(e.origem, mul(e.u, deslocamento)), rot: quatDeY(e.u) };
}

/**
 * Os posicionamentos do encaixe: eixo Y do fixador concêntrico ao furo e o plano de apoio (XZ do fixador)
 * coincidente com a face da peça (ou a `deslocamento` dela, quando já há arruelas empilhadas).
 * Sem face plana de apoio só o concêntrico é criado (a pose já posiciona o fixador).
 */
export function posicionamentosDoEncaixe(fixador: string, f: Furo, e: Entrada, deslocamento = 0): Posicionamento[] {
  const base = { suprimido: false } as const;
  const out: Posicionamento[] = [{
    ...base, id: novoIdM(), nome: `Concêntrico (${f.face.nome ?? "furo"})`, tipo: "concentrico", alinhamento: "auto",
    a: { comp: fixador, ref: { tipo: "eixo", id: "Y" } }, b: { comp: f.comp, ref: { tipo: "face", ass: f.face } },
  }];
  if (e.apoio) {
    out.push({
      ...base, id: novoIdM(), nome: deslocamento > 0.0005 ? "Distância (apoio)" : "Coincidente (apoio)",
      tipo: deslocamento > 0.0005 ? "distancia" : "coincidente", alinhamento: "alinhado",
      ...(deslocamento > 0.0005 ? { valor: deslocamento } : {}),
      a: { comp: f.comp, ref: { tipo: "face", ass: e.apoio.face } }, b: { comp: fixador, ref: { tipo: "plano", id: "XZ" } },
    });
  }
  return out;
}

/**
 * Altura já ocupada por fixadores nesse lado do furo (arruelas, porcas…): maior (deslocamento + altura de apoio)
 * entre os fixadores com posicionamento concêntrico ao furo e com o +Y apontando para o mesmo lado.
 * `alturaDe(comp)` devolve a altura de apoio do fixador (0 se não for da biblioteca).
 */
export function empilhadoNoLado(
  posicionamentos: Posicionamento[], f: Furo, u: Vec3, direcaoDe: (comp: string) => Vec3 | null, alturaDe: (comp: string) => number | null,
): number {
  let topo = 0;
  for (const m of posicionamentos) {
    if (m.tipo !== "concentrico" || m.suprimido) continue;
    const fix = m.a?.comp && m.b?.comp === f.comp && m.b.ref.tipo === "face" && m.b.ref.ass.nome === f.face.nome && m.b.ref.ass.area === f.face.area ? m.a.comp : null;
    if (!fix) continue;
    const dir = direcaoDe(fix);
    const h = alturaDe(fix);
    if (!dir || h === null || dot(dir, u) < 0.99) continue;
    const apoio = posicionamentos.find((x) => x.tipo === "distancia" && x.b?.comp === fix && !x.suprimido);
    topo = Math.max(topo, (apoio?.valor ?? 0) + h);
  }
  return topo;
}

/** Menor valor da lista do padrão que seja ≥ `minimo` (ou o maior disponível). */
export function proximoDaLista(lista: number[], minimo: number): number | undefined {
  if (!lista.length) return undefined;
  return lista.find((l) => l >= minimo - 1e-9) ?? lista[lista.length - 1];
}

export interface EntradaSugestao {
  /** espessura atravessada (comprimento do furo, mm) */
  espessura: number;
  /** altura já empilhada no lado da cabeça (arruelas, mm) */
  empilhado: number;
  /** furo passante com porca (e arruela) do outro lado, ou rosca engatada num furo roscado */
  comPorca: boolean;
  /** altura da porca (+ arruela do outro lado), quando `comPorca` */
  alturaPorca: number;
  d: number;
  passo: number;
}
/**
 * Comprimento mínimo sob a cabeça: espessura + o que está empilhado sob a cabeça + (porca ou arruela do outro lado
 * + 2 passos de rosca de sobra) ou, em furo roscado, 1,5 × d de engate.
 */
export function comprimentoMinimo(s: EntradaSugestao): number {
  const fim = s.comPorca ? s.alturaPorca + 2 * s.passo : 1.5 * s.d;
  return s.espessura + s.empilhado + fim;
}

/**
 * O furo serve para a haste? "folga" (passa solto), "roscado" (diâmetro de furo de rosca: d − 1,0825 P),
 * "apertado" (entre o furo de rosca e d: só com interferência) ou "pequeno"/"grande".
 */
export function compatibilidadeDoFuro(d: number, passo: number, diametroFuro: number): "folga" | "roscado" | "apertado" | "pequeno" | "grande" {
  const broca = d - 1.0825 * passo;
  if (diametroFuro >= d - 1e-6) return diametroFuro <= d * 1.15 + 1.2 ? "folga" : "grande";
  if (diametroFuro >= broca - 0.25 && diametroFuro <= broca + 0.45) return "roscado";
  return diametroFuro > broca ? "apertado" : "pequeno";
}
