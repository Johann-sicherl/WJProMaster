// Recursos do menu Inserir que não cabem nos grupos maiores (docs/funcional/features.md §13 e §15):
// Escala, Domo, Ponto de referência e Sistema de coordenadas. Puro sobre o replicad; testado em
// scripts/teste-recursos.ts.

import { assembleWire, basicFaceExtrusion, cast, genericSweep, getOC, makeCylinder, makeHelix, makeLine, makeSphere, measureShapeVolumeProperties, Vector, type Face, type Shape3D } from "replicad";
import type { Vec3 } from "../model";
import { listarTopo } from "./topologia";

const esc = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const soma = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const cruz = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norma = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const unit = (a: Vec3): Vec3 => mul(a, 1 / (norma(a) || 1));
const tupla = (v: { x: number; y: number; z: number }): Vec3 => [v.x, v.y, v.z];

/** Centro de massa do sólido (centro da Escala "no centroide"). */
export function centroDeMassa(peca: Shape3D): Vec3 {
  return (measureShapeVolumeProperties(peca) as unknown as { centerOfMass: Vec3 }).centerOfMass;
}

/** Escala uniforme em torno de um ponto (o kernel do navegador só tem a escala uniforme). */
export function escalar(peca: Shape3D, fator: number, centro: Vec3): Shape3D {
  if (!(fator > 0)) throw new Error("Escala: o fator deve ser maior que zero.");
  if (Math.abs(fator - 1) < 1e-12) return peca;
  return peca.scale(fator, centro) as Shape3D;
}

/** Pontos do contorno de uma face (amostrados nas arestas). */
function contorno(face: Face): Vec3[] {
  const pts: Vec3[] = [];
  for (const e of listarTopo(face, "aresta")) for (let k = 0; k <= 8; k++) pts.push(tupla(e.pointAt(k / 8)));
  return pts;
}

/**
 * Domo sobre face plana: calota esférica de altura `h` no centro da face, passando pelo ponto
 * do contorno mais distante do centro (em face circular é a calota exata, tangente à borda só
 * se h = raio). `concavo` tira a calota para dentro da peça.
 */
export function domo(face: Face, normalFora: Vec3, h: number, concavo: boolean): { tool: Shape3D; op: "adicionar" | "cortar" } {
  if (!(h > 0)) throw new Error("Domo: a altura deve ser maior que zero.");
  const n = unit(normalFora);
  const pts = contorno(face);
  if (!pts.length) throw new Error("Domo: face sem contorno.");
  const c = tupla(face.center);
  // raio no plano da face: maior distância do centro ao contorno
  let R = 0;
  for (const p of pts) {
    const v = sub(p, c);
    R = Math.max(R, norma(sub(v, mul(n, esc(v, n)))));
  }
  if (!(R > 1e-6)) throw new Error("Domo: face pequena demais.");
  // a calota termina um décimo de milésimo do raio para dentro da borda: com a borda exatamente
  // coincidente a booleana do kernel falha (círculos iguais com costuras diferentes)
  const Rc = R * (1 - 1e-4);
  const rho = (Rc * Rc + h * h) / (2 * h); // raio da esfera que passa pela borda e sobe h no centro
  const s = concavo ? -1 : 1;
  const centroEsfera = soma(c, mul(n, s * (h - rho)));
  // prisma da face até a altura do domo, cortado pela esfera
  // calota = esfera ∩ cilindro largo que sai do plano da face (h de altura): exata em face circular
  const esfera = makeSphere(rho).translate(centroEsfera) as unknown as Shape3D;
  const cilindro = makeCylinder(R * 1.5, h * 1.01, c, mul(n, s)) as unknown as Shape3D;
  let tool = esfera.intersect(cilindro) as Shape3D;
  // contorno não circular: recorta pelo prisma da face (a calota só fica sobre a face)
  const circular = pts.every((p) => {
    const v = sub(p, c);
    return Math.abs(norma(sub(v, mul(n, esc(v, n)))) - R) < R * 1e-3;
  });
  if (!circular) {
    let prisma = basicFaceExtrusion(face, new Vector(mul(n, s * h * 1.02))) as unknown as Shape3D;
    if (measureShapeVolumeProperties(prisma).volume < 0) {
      prisma = basicFaceExtrusion(cast((face as unknown as { wrapped: { Reversed(): unknown } }).wrapped.Reversed() as never) as unknown as Face, new Vector(mul(n, s * h * 1.02))) as unknown as Shape3D;
    }
    tool = tool.intersect(prisma) as Shape3D;
  }
  if (!(measureShapeVolumeProperties(tool).volume > 1e-9)) throw new Error("Domo: não foi possível gerar a calota nessa face.");
  return { tool, op: concavo ? "cortar" : "adicionar" };
}

/** Projeção de um ponto num plano. */
export function projetarNoPlano(p: Vec3, origem: Vec3, normal: Vec3): Vec3 {
  const n = unit(normal);
  return sub(p, mul(n, esc(sub(p, origem), n)));
}

/** Interseção de uma reta (ponto + direção) com um plano. */
export function retaComPlano(p: Vec3, d: Vec3, origem: Vec3, normal: Vec3): Vec3 {
  const dn = esc(d, normal);
  if (Math.abs(dn) < 1e-12) throw new Error("Ponto: a aresta é paralela ao plano (não se cruzam).");
  return soma(p, mul(d, esc(sub(origem, p), normal) / dn));
}

/** Ponto médio do menor segmento entre duas retas (interseção quando se cruzam). */
export function retaComReta(p1: Vec3, d1: Vec3, p2: Vec3, d2: Vec3): Vec3 {
  const w = sub(p1, p2), a = esc(d1, d1), b = esc(d1, d2), c = esc(d2, d2), d = esc(d1, w), e = esc(d2, w);
  const den = a * c - b * b;
  if (Math.abs(den) < 1e-12) throw new Error("Ponto: as arestas são paralelas (não se cruzam).");
  const s = (b * e - c * d) / den, t = (a * e - b * d) / den;
  return mul(soma(soma(p1, mul(d1, s)), soma(p2, mul(d2, t))), 0.5);
}

/**
 * Sistema de coordenadas: X e Y escolhidos (Y é ajustado para ficar perpendicular a X);
 * sem Y, usa o eixo global mais perpendicular a X. Z = X × Y.
 */
export function eixosDoSistema(x0: Vec3 | null, y0: Vec3 | null): { x: Vec3; y: Vec3; z: Vec3 } {
  const x = unit(x0 ?? [1, 0, 0]);
  let y: Vec3;
  if (y0 && norma(cruz(x, y0)) > 1e-9) y = unit(sub(y0, mul(x, esc(y0, x))));
  else {
    const cand: Vec3[] = [[0, 1, 0], [0, 0, 1], [1, 0, 0]];
    const g = cand.reduce((m, v) => (Math.abs(esc(v, x)) < Math.abs(esc(m, x)) ? v : m));
    y = unit(sub(g, mul(x, esc(g, x))));
  }
  return { x, y, z: cruz(x, y) };
}

/**
 * Rosca modelada (ISO métrica, perfil em V de 60°): sulco varrido ao longo de uma hélice e
 * cortado do cilindro. Externa: o V entra no pino a partir do raio externo (profundidade
 * 0,6134 P). Interna: o V sai do furo para fora (0,5413 P). Começa um passo antes da ponta
 * (`inicio`), para a rosca abrir limpa na face, e anda `comprimento` ao longo de `dir`.
 */
export function ferramentaRosca(inicio: Vec3, dir: Vec3, raio: number, passo: number, comprimento: number, interna: boolean, esquerda: boolean): Shape3D {
  if (!(passo > 0)) throw new Error("Rosca: o passo deve ser maior que zero.");
  if (!(comprimento > 0)) throw new Error("Rosca: o comprimento deve ser maior que zero.");
  const voltas = (comprimento + passo) / passo;
  if (voltas > 400) throw new Error(`Rosca: voltas demais (${Math.round(voltas)}); o máximo é 400.`);
  const n = unit(dir);
  const c0 = sub(inicio, mul(n, passo));
  const helice = makeHelix(passo, comprimento + passo, raio, c0, n, esquerda);
  const p0 = tupla((helice as unknown as { startPoint: { x: number; y: number; z: number } }).startPoint);
  const radial = unit(sub(sub(p0, c0), mul(n, esc(sub(p0, c0), n))));
  const t = Math.tan(Math.PI / 6);
  const prof = interna ? 0.5413 * passo : 0.6134 * passo;
  const folga = 0.15 * passo; // o V começa um pouco fora do material (corte limpo)
  // perfil no plano (radial, eixo) do início da hélice: base fora do material, ponta para dentro
  const s = interna ? 1 : -1; // externa: ponta para o eixo; interna: ponta para fora
  const base = mul(radial, -s * folga);
  const pts: Vec3[] = [
    soma(soma(p0, base), mul(n, -(prof + folga) * t)),
    soma(p0, mul(radial, s * prof)),
    soma(soma(p0, base), mul(n, (prof + folga) * t)),
  ];
  const fio = assembleWire([makeLine(pts[0], pts[1]), makeLine(pts[1], pts[2]), makeLine(pts[2], pts[0])]);
  return genericSweep(fio, helice, { frenet: true }) as Shape3D;
}

/** Diâmetro nominal de um tamanho ISO ("M10" → 10, "M2,5" → 2,5). */
export function diametroNominal(tamanho: string): number {
  return Number(tamanho.replace(/^M/i, "").replace(",", "."));
}

/**
 * Linha de partição: divide as faces da peça pelas arestas dadas (curvas sobre as faces), sem
 * mudar o volume — as partes viram faces separadas (para inclinar, filetar ou pintar só uma parte).
 */
export function dividirFaces(peca: Shape3D, arestas: { wrapped: unknown }[]): Shape3D {
  const oc = getOC() as never as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const sp = new oc.BRepAlgoAPI_Splitter();
  const args = new oc.NCollection_List_TopoDS_Shape();
  const tools = new oc.NCollection_List_TopoDS_Shape();
  try {
    args.Append(peca.wrapped);
    for (const a of arestas) tools.Append(a.wrapped);
    sp.SetArguments(args);
    sp.SetTools(tools);
    sp.Build(new oc.Message_ProgressRange());
    if (!sp.IsDone()) throw new Error("Linha de partição: o kernel não conseguiu dividir as faces.");
    return cast(sp.Shape()) as unknown as Shape3D;
  } finally {
    for (const x of [sp, args, tools]) x.delete();
  }
}
