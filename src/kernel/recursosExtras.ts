// Recursos do menu Inserir que não cabem nos grupos maiores (docs/funcional/features.md §13 e §15):
// Escala, Domo, Ponto de referência e Sistema de coordenadas. Puro sobre o replicad; testado em
// scripts/teste-recursos.ts.

import { basicFaceExtrusion, cast, makeCylinder, makeSphere, measureShapeVolumeProperties, Vector, type Face, type Shape3D } from "replicad";
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
