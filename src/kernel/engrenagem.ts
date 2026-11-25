// Engrenagem no kernel: o contorno transversal (src/biblioteca/engrenagens.ts) vira arestas — cada flanco
// evolvente é uma B-spline que passa pelos pontos exatos da evolvente (desvio < 0,1 µm, conferido em
// scripts/teste-engrenagens.ts), ponta e raiz são arcos — e o sólido sai por extrusão (retos), extrusão com
// torção (helicoidais, coroa e sem-fim ZA, cuja seção tem flancos em espiral de Arquimedes), anel com furo
// dentado (interna), loft regrado até o perfil escalado em direção ao vértice do cone, com o perfil de
// Tredgold projetado pelo vértice na face maior plana (cônica) ou contorno extrudado com cisalhamento
// (cremalheira). Depois: cubo,
// furo e rasgo de chaveta DIN 6885. Eixo da peça = Y; dentes em y ∈ [0, b].

import {
  addHolesInFace, assembleWire, basicFaceExtrusion, genericSweep, loft, makeBSplineApproximation, makeBox, makeCircle, makeCylinder, makeFace,
  makeHelix, makeLine, makePolygon, makeSolid, makeThreePointArc, Vector, type Edge, type Shape3D, type Wire,
} from "replicad";
import type { ParamEngrenagem } from "../model";
import { chavetaDIN6885, contornoTransversal, geometria, perfilCremalheira, type Geometria, type P2, type Trecho } from "../biblioteca/engrenagens";

type V3 = [number, number, number];
/** ponto do plano transversal (x, z) em y */
const em = (p: P2, y = 0): V3 => [p[0], y, p[1]];
const pt = (v: { x: number; y: number; z: number }): V3 => [v.x, v.y, v.z];

/**
 * Arestas do contorno no plano y (escala k em torno do eixo): as B-splines primeiro (cúbicas pelos pontos
 * exatos: desvio de nanômetros), depois retas e arcos ligando as pontas reais delas.
 */
export function arestasDoContorno(trechos: Trecho[], y = 0, k = 1): Edge[] {
  const n = trechos.length;
  const em = (p: P2): V3 => [p[0] * k, y, p[1] * k];
  const ev: (Edge | null)[] = trechos.map((t) => (t.t === "curva" ? makeBSplineApproximation(t.pts.map((p) => em(p)), { tolerance: 1e-7, degMin: 3, degMax: 3, smoothing: null }) : null));
  const inicioNominal = (t: Trecho): V3 => (t.t === "curva" ? em(t.pts[0]) : t.t === "linha" ? em(t.a) : em([t.r * Math.cos(t.a0), t.r * Math.sin(t.a0)]));
  const fimNominal = (t: Trecho): V3 => (t.t === "curva" ? em(t.pts[t.pts.length - 1]) : t.t === "linha" ? em(t.b) : em([t.r * Math.cos(t.a1), t.r * Math.sin(t.a1)]));
  const fimReal = (i: number): V3 => (ev[i] ? pt(ev[i]!.endPoint) : fimNominal(trechos[i]));
  const inicioReal = (i: number): V3 => (ev[i] ? pt(ev[i]!.startPoint) : inicioNominal(trechos[i]));
  const out: Edge[] = [];
  for (let i = 0; i < n; i++) {
    const t = trechos[i];
    if (t.t === "curva") {
      out.push(ev[i]!);
      continue;
    }
    const a = ev[(i - 1 + n) % n] ? fimReal((i - 1 + n) % n) : inicioNominal(t);
    const b = ev[(i + 1) % n] ? inicioReal((i + 1) % n) : fimNominal(t);
    if (t.t === "linha") out.push(makeLine(a, b));
    else {
      const am = (t.a0 + t.a1) / 2;
      out.push(makeThreePointArc(a, em([t.r * Math.cos(am), t.r * Math.sin(am)]), b));
    }
  }
  return out;
}

const fioDoContorno = (trechos: Trecho[], y = 0, k = 1): Wire => assembleWire(arestasDoContorno(trechos, y, k));

/**
 * Extrusão de y = 0 a y = b girando o perfil de φ (rad) no total. φ > 0 = hélice à direita (o dente vai
 * para θ menor ao subir: parafuso à direita em torno de +Y).
 */
function extrusaoTorcida(fio: Wire, b: number, phi: number): Shape3D {
  if (Math.abs(phi) < 1e-9) return basicFaceExtrusion(makeFace(fio), new Vector([0, b, 0])) as Shape3D;
  const espinha = assembleWire([makeLine([0, 0, 0], [0, b, 0])]);
  return genericSweep(fio, espinha, { auxiliarySpine: heliceAux(b, phi) }) as Shape3D;
}

/** Hélice auxiliar da torção (raio 1): o perfil gira φ no comprimento b (φ > 0 = à direita). */
const heliceAux = (b: number, phi: number) => makeHelix((2 * Math.PI * b) / Math.abs(phi), b, 1, [0, 0, 0], [0, 1, 0], phi < 0);

/**
 * Anel com o furo dentado (interna): face com furo extrudada (reta) ou, com hélice, cascas varridas com
 * torção (furo) e sem torção (aro) fechadas pelas tampas — sem booleana (rápido mesmo com muitos dentes).
 */
function anelDentado(furo: Wire, raio: number, b: number, phi: number): Shape3D {
  const aro = assembleWire([makeCircle(raio, [0, 0, 0], [0, 1, 0])]);
  if (Math.abs(phi) < 1e-9) return basicFaceExtrusion(addHolesInFace(makeFace(aro), [furo]), new Vector([0, b, 0])) as Shape3D;
  const espinha = assembleWire([makeLine([0, 0, 0], [0, b, 0])]);
  const [cascaF, f0, f1] = genericSweep(furo, espinha, { auxiliarySpine: heliceAux(b, phi) }, true);
  const [cascaA, a0, a1] = genericSweep(aro, espinha, {}, true);
  return makeSolid([cascaA as never, cascaF as never, addHolesInFace(makeFace(a0), [f0]), addHolesInFace(makeFace(a1), [f1])]) as Shape3D;
}

/** Sólido da engrenagem (sem cubo/furo). */
function corpoDentado(p: ParamEngrenagem, g: Geometria): Shape3D {
  const b = p.largura;
  switch (g.tipo) {
    case "reta":
      return extrusaoTorcida(fioDoContorno(contornoTransversal(g)), b, 0);
    case "helicoidal": case "coroa":
      return extrusaoTorcida(fioDoContorno(contornoTransversal(g)), b, (g.mao * b * Math.tan(g.beta)) / g.r);
    case "interna":
      return anelDentado(fioDoContorno(contornoTransversal(g)), g.raio_aro!, b, (g.mao * b * Math.tan(g.beta)) / g.r);
    case "conica": {
      // perfil da ponta maior em y = 0 e o mesmo perfil escalado em direção ao vértice (y = h, fator k): o loft
      // regrado liga pontos correspondentes por retas que passam pelo vértice do cone (superfícies cônicas exatas)
      const k = (g.Re! - b) / g.Re!;
      const h = b * Math.cos(g.delta!);
      const tr = contornoTransversal(g);
      // face maior plana (y = 0, passa pelo primitivo); o corte pelo cone complementar custaria segundos a
      // mais por engrenagem e não muda o engrenamento (conferido em scripts/teste-engrenagens.ts)
      return loft([fioDoContorno(tr), fioDoContorno(tr, h, k)], { ruled: true }) as Shape3D;
    }
    case "cremalheira": {
      const L = p.comprimento, cis = g.mao * Math.tan(g.beta) * b;
      const folga = Math.abs(cis) + 2 * g.pt;
      const perfil = perfilCremalheira(g, p.altura, -L / 2 - folga, L / 2 + folga);
      const face = makePolygon(perfil.map((q) => em(q)));
      const bruto = basicFaceExtrusion(face, new Vector([cis, b, 0])) as Shape3D;
      return bruto.intersect(makeBox([-L / 2, -1, g.mn - p.altura - 1], [L / 2, b + 1, g.mn + 1])) as Shape3D;
    }
    case "semFim":
      // seção (espirais de Arquimedes) extrudada com torção de 2π por avanço: helicoide exato
      return extrusaoTorcida(fioDoContorno(contornoTransversal(g)), b, (g.mao * 2 * Math.PI * b) / g.avanco!);
  }
}

/** Sólido completo: dentes + cubo − furo − rasgo de chaveta. */
export function solidoEngrenagem(p: ParamEngrenagem): Shape3D {
  const g = geometria(p);
  let s = corpoDentado(p, g);
  const comCubo = g.tipo === "reta" || g.tipo === "helicoidal" || g.tipo === "conica" || g.tipo === "coroa";
  const lc = comCubo && p.cuboDiametro > 0 && p.cuboComprimento > 0 ? p.cuboComprimento : 0;
  if (lc) {
    if (p.cuboDiametro / 2 >= g.ra) throw new Error("O Ø do cubo passa do diâmetro externo.");
    s = s.fuse(makeCylinder(p.cuboDiametro / 2, lc + 1e-3, [0, -lc, 0], [0, 1, 0])) as Shape3D;
  }
  if (p.furo > 0 && g.tipo !== "interna" && g.tipo !== "cremalheira") {
    const rLim = g.tipo === "semFim" ? g.rf : lc ? Math.min(g.rf, p.cuboDiametro / 2) : g.tipo === "conica" ? g.rf * (1 - p.largura / g.Re!) : g.rf;
    if (p.furo / 2 >= rLim) throw new Error(`O furo Ø${p.furo} não cabe (raiz ou cubo Ø${Math.round(2 * rLim * 100) / 100}).`);
    const y0 = -lc - 1, h = p.largura + lc + 2;
    s = s.cut(makeCylinder(p.furo / 2, h, [0, y0, 0], [0, 1, 0])) as Shape3D;
    const ch = p.chaveta ? chavetaDIN6885(p.furo) : null;
    if (ch) {
      if (p.furo / 2 + ch.t2 >= rLim) throw new Error("O rasgo de chaveta passa da raiz dos dentes.");
      s = s.cut(makeBox([-ch.b / 2, y0, 0], [ch.b / 2, y0 + h, p.furo / 2 + ch.t2])) as Shape3D;
    }
  }
  return s;
}
