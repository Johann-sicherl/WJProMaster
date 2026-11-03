// Edição direta de faces (corpos sem árvore: STEP/STL importados, mas vale para qualquer sólido).
// O OpenCascade do navegador não tem o "defeaturing" (BRepAlgoAPI_Defeaturing), então cada caso é
// resolvido com sólidos simples e booleanas — só quando o resultado é garantido; nos outros casos
// o recurso para com uma mensagem clara (nunca uma geometria errada):
//   • Mover face plana: prisma da própria face ao longo da normal (vizinhas perpendiculares a ela).
//   • Mover/Excluir furo ou pino (cilindro completo, pontas retas): cilindros/tubos coaxiais.
//   • Excluir filete (cilindro parcial entre duas faces, raio constante): a quina volta.
// Campos e comportamento: docs/funcional/features.md §18.

import { basicFaceExtrusion, draw, makeCylinder, Plane, Vector, type Face, type Shape3D } from "replicad";
import type { AssinaturaFace, Vec3 } from "../model";
import { assinaturaFace, listarTopo } from "./topologia";

export type FerramentaDireta = { tool: Shape3D; op: "adicionar" | "cortar" };

const TOL = 1e-6;
const esc = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const soma = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const cruz = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norma = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const unit = (a: Vec3): Vec3 => mul(a, 1 / (norma(a) || 1));
const tupla = (v: { x: number; y: number; z: number }): Vec3 => [v.x, v.y, v.z];

/** Faces que dividem uma aresta com a face dada. */
function vizinhas(peca: Shape3D, face: Face): Face[] {
  const minhas = listarTopo(face, "aresta");
  const out: Face[] = [];
  for (const g of listarTopo(peca, "face")) {
    if (g.isSame(face)) continue;
    if (listarTopo(g, "aresta").some((e) => minhas.some((m) => m.isSame(e)))) out.push(g);
  }
  return out;
}

/**
 * Mover uma face plana `d` mm ao longo da normal (para fora do material > 0). O prisma da face só
 * dá o resultado certo se as vizinhas "seguem" o movimento: planas perpendiculares a ela, ou
 * cilindros/cones com eixo na direção do movimento (laterais arredondadas, furos).
 */
export function moverFacePlana(peca: Shape3D, face: Face, d: number): FerramentaDireta {
  const a = assinaturaFace(face);
  if (a.geom !== "plano" || !a.normal) throw new Error("Mover face: esta função é para faces planas.");
  if (Math.abs(d) < TOL) throw new Error("Mover face: a distância precisa ser diferente de zero.");
  const n = a.normal;
  for (const g of vizinhas(peca, face)) {
    const b = assinaturaFace(g);
    const ok = (b.geom === "plano" && b.normal && Math.abs(esc(b.normal, n)) < 1e-6) || (b.geom === "cilindro" && b.eixo && Math.abs(Math.abs(esc(b.eixo, n)) - 1) < 1e-6);
    if (!ok) throw new Error("Mover face: uma face vizinha não é perpendicular ao movimento (inclinada ou curva). Hoje só peças prismáticas: use um corte/extrusão nesse caso.");
  }
  const tool = basicFaceExtrusion(face, new Vector(mul(n, d))) as unknown as Shape3D;
  return { tool, op: d > 0 ? "adicionar" : "cortar" };
}

/** Grupo cilíndrico coaxial (furo/pino/filete) a que a face pertence, com a faixa ao longo do eixo. */
interface Cilindro {
  eixo: Vec3;
  ponto: Vec3;
  raio: number;
  /** faixa [t0, t1] ao longo do eixo (a partir de `ponto`) */
  t0: number;
  t1: number;
  /** 360° (furo ou pino) */
  completo: boolean;
  /** material fora do cilindro (furo) ou dentro (pino / filete convexo) */
  furo: boolean;
  faces: Face[];
}

function grupoCilindrico(peca: Shape3D, face: Face): Cilindro {
  const a = assinaturaFace(face);
  if (a.geom !== "cilindro" || !a.eixo || !a.pontoEixo || a.raio === undefined) throw new Error("A face escolhida não é cilíndrica.");
  const eixo = unit(a.eixo), P = a.pontoEixo, r = a.raio;
  const coaxial = (b: AssinaturaFace) => {
    if (!b.eixo || !b.pontoEixo || Math.abs(Math.abs(esc(unit(b.eixo), eixo)) - 1) > 1e-6) return false;
    const d = sub(b.pontoEixo, P);
    return norma(sub(d, mul(eixo, esc(d, eixo)))) < 1e-4;
  };
  const faces = listarTopo(peca, "face").filter((g) => {
    const b = assinaturaFace(g);
    return b.geom === "cilindro" && b.raio !== undefined && Math.abs(b.raio - r) < 1e-6 && coaxial(b);
  });
  let t0 = Infinity, t1 = -Infinity, area = 0;
  for (const g of faces) {
    area += assinaturaFace(g).area;
    for (const e of listarTopo(g, "aresta")) for (const p of [tupla(e.startPoint), tupla(e.endPoint), tupla(e.pointAt(0.5))]) {
      const t = esc(sub(p, P), eixo);
      t0 = Math.min(t0, t);
      t1 = Math.max(t1, t);
    }
  }
  const completo = Math.abs(area - 2 * Math.PI * r * (t1 - t0)) < 0.01 * area;
  // furo: a normal (para fora do material) aponta para o eixo
  const q = tupla(face.pointOnSurface(0.5, 0.5)), nq = tupla(face.normalAt(face.pointOnSurface(0.5, 0.5)));
  const radial = sub(q, soma(P, mul(eixo, esc(sub(q, P), eixo))));
  return { eixo, ponto: P, raio: r, t0, t1, completo, furo: esc(nq, radial) < 0, faces };
}

/** As pontas do furo/pino precisam ser retas (círculos em planos perpendiculares ao eixo). */
function exigirPontasRetas(c: Cilindro, oque: string) {
  for (const g of c.faces)
    for (const e of listarTopo(g, "aresta")) {
      if (e.geomType === "LINE") continue; // costura
      if (e.geomType !== "CIRCLE") throw new Error(`${oque}: a saída do furo/pino não é reta (corta uma face inclinada ou curva). Hoje só furos/pinos com pontas retas.`);
      const a = tupla(e.startPoint), b = tupla(e.pointAt(0.5));
      if (Math.abs(esc(sub(b, a), c.eixo)) > 1e-6) throw new Error(`${oque}: a saída do furo/pino não é reta. Hoje só furos/pinos com pontas retas.`);
    }
}

const cilindro = (c: Cilindro, raio: number) =>
  makeCylinder(raio, c.t1 - c.t0, soma(c.ponto, mul(c.eixo, c.t0)), c.eixo) as unknown as Shape3D;

/**
 * Furo/pino: muda o raio em `d` (para fora do material > 0: furo menor, pino maior). Tubo coaxial
 * entre os dois raios, na faixa do cilindro.
 */
export function moverCilindro(peca: Shape3D, face: Face, d: number): FerramentaDireta {
  const c = grupoCilindrico(peca, face);
  if (!c.completo) throw new Error("Mover face: a face cilíndrica não é um furo ou pino completo (360°).");
  if (Math.abs(d) < TOL) throw new Error("Mover face: a distância precisa ser diferente de zero.");
  exigirPontasRetas(c, "Mover face");
  const novo = c.furo ? c.raio - d : c.raio + d;
  if (novo <= 0.001) throw new Error(`Mover face: o raio novo ficaria ${novo.toFixed(3)} mm (zero ou negativo).`);
  const maior = Math.max(novo, c.raio), menor = Math.min(novo, c.raio);
  const tubo = cilindro(c, maior).cut(cilindro(c, menor)) as Shape3D;
  // material cresce (d > 0): tubo entra; diminui: tubo sai
  return { tool: tubo, op: d > 0 ? "adicionar" : "cortar" };
}

/**
 * Excluir face: furo (preenche), pino (remove) ou filete de raio constante entre duas faces (a quina
 * viva volta). `face` = qualquer face cilíndrica do grupo.
 */
export function excluirFace(peca: Shape3D, face: Face): FerramentaDireta {
  const a = assinaturaFace(face);
  if (a.geom !== "cilindro") throw new Error("Excluir face: escolha a face de um furo, de um pino ou de um filete (faces cilíndricas). Faces planas não se excluem: use Mover face.");
  const c = grupoCilindrico(peca, face);
  if (c.completo) {
    exigirPontasRetas(c, "Excluir face");
    // furo: inclui a ponta cônica de broca (dentro do material, não sobra nada fora)
    if (c.furo) {
      for (const g of listarTopo(peca, "face")) {
        const b = assinaturaFace(g);
        if (b.geom !== "cone" || !b.eixo || Math.abs(Math.abs(esc(unit(b.eixo), c.eixo)) - 1) > 1e-6) continue;
        for (const e of listarTopo(g, "aresta")) for (const p of [tupla(e.startPoint), tupla(e.endPoint)]) {
          const t = esc(sub(p, c.ponto), c.eixo);
          if (t >= c.t0 - 1e-6 && t <= c.t1 + c.raio * 2) c.t1 = Math.max(c.t1, t);
        }
      }
    }
    return { tool: cilindro(c, c.raio), op: c.furo ? "adicionar" : "cortar" };
  }
  return excluirFilete(c, face);
}

/**
 * Filete de raio constante (cilindro parcial): a região entre o arco e a quina das duas tangentes
 * vira material (filete convexo, numa quina externa) ou sai (côncavo, numa quina interna).
 */
function excluirFilete(c: Cilindro, face: Face): FerramentaDireta {
  // as duas arestas retas ao longo do eixo marcam onde o filete encosta nas faces vizinhas
  const retas = listarTopo(face, "aresta").filter((e) => e.geomType === "LINE" && Math.abs(Math.abs(esc(unit(sub(tupla(e.endPoint), tupla(e.startPoint))), c.eixo)) - 1) < 1e-6);
  if (retas.length !== 2) throw new Error("Excluir face: este filete não é de raio constante entre duas faces retas (só esse caso por enquanto).");
  // seção perpendicular ao eixo, na altura t0
  const O = soma(c.ponto, mul(c.eixo, c.t0));
  const naSecao = (p: Vec3): Vec3 => sub(p, mul(c.eixo, esc(sub(p, O), c.eixo)));
  const T1 = naSecao(tupla(retas[0].startPoint)), T2 = naSecao(tupla(retas[1].startPoint));
  const u = unit(sub(T1, O)), v = unit(cruz(c.eixo, u));
  const em2 = (p: Vec3): [number, number] => [esc(sub(p, O), u), esc(sub(p, O), v)];
  const [x1, y1] = em2(T1), [x2, y2] = em2(T2);
  // quina: interseção das tangentes em T1 e T2 (perpendiculares aos raios)
  const det = x1 * y2 - y1 * x2;
  if (Math.abs(det) < 1e-9) throw new Error("Excluir face: o filete não tem quina (as faces vizinhas são paralelas).");
  const r2 = c.raio * c.raio;
  const qx = (r2 * y2 - r2 * y1) / det, qy = (x1 * r2 - x2 * r2) / det;
  // meio do arco do filete: o ponto da face no meio da seção
  const ang1 = Math.atan2(y1, x1), ang2 = Math.atan2(y2, x2);
  let da = ang2 - ang1;
  while (da > Math.PI) da -= 2 * Math.PI;
  while (da < -Math.PI) da += 2 * Math.PI;
  const am = ang1 + da / 2;
  const mx = c.raio * Math.cos(am), my = c.raio * Math.sin(am);
  const perfil = draw([x1, y1]).lineTo([qx, qy]).lineTo([x2, y2]).threePointsArcTo([x1, y1], [mx, my]).close();
  const plano = new Plane(O, u, c.eixo);
  const prisma = (perfil.sketchOnPlane(plano) as unknown as { extrude(d: number): Shape3D }).extrude(c.t1 - c.t0);
  // filete convexo (numa quina externa): o material está do lado do eixo → a quina era material
  return { tool: prisma, op: c.furo ? "cortar" : "adicionar" };
}

/** Substituir face: leva a face plana até o plano de outra face plana paralela (distância com sinal). */
export function distanciaAtePlano(face: Face, alvo: AssinaturaFace): number {
  const a = assinaturaFace(face);
  if (a.geom !== "plano" || !a.normal) throw new Error("Substituir face: as faces a substituir precisam ser planas.");
  if (alvo.geom !== "plano" || !alvo.normal) throw new Error("Substituir face: a face substituta precisa ser plana.");
  if (Math.abs(Math.abs(esc(a.normal, alvo.normal)) - 1) > 1e-6) throw new Error("Substituir face: a face substituta precisa ser paralela à face a substituir.");
  return esc(sub(alvo.centro, a.centro), a.normal);
}
