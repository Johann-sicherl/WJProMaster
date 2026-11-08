// WJGoldDiamond: sólido da joia no OpenCascade (replicad). Roda no worker e nos testes em Node.
// Ordem: aro → textura (só no aro) → + cabeça, contas e trilhos → − assentos das gemas (cabeça
// sozinha, pavé num corte só) → − gravação → − canal interno (ocar). Canais de fundição e
// contração só na exportação. Cortes agrupados num composto só quando as ferramentas não se cruzam.

import { assembleWire, makeCompound, cast, draw, drawCircle, drawPointsInterpolation, genericSweep, getOC, makeBSplineApproximation, makeCircle, makeCylinder, makeSphere, measureArea, measureShapeVolumeProperties, Plane, type Drawing, type Shape3D } from "replicad";
import {
  angulosFrisos, contorno, intervalosLivres, montar, poligonoFacetas, pontosPerfil, porLoft, proporcoes, secao, superficie, superficieInterna, torcaoEfetiva, zonasOcupadas,
  type DocJoia, type GemaPosta, type GrupoTexto, type Haste, type Montagem, type P2, type Perfil, type V3,
} from "./regras";

type Sk = {
  extrude(d: number): Shape3D;
  revolve(eixo: V3, o: { origin: V3; angle?: number }): Shape3D;
  loftWith(outros: Sk | Sk[], cfg?: { ruled?: boolean }): Shape3D;
};
const RAD = Math.PI / 180;
const naPlano = (d: Drawing, o: V3, x: V3, n: V3) => d.sketchOnPlane(new Plane(o, x, n)) as unknown as Sk;
const rHat = (th: number): V3 => [Math.sin(th), Math.cos(th), 0];
const tHat = (th: number): V3 => [Math.cos(th), -Math.sin(th), 0];
const esc = (v: V3, k: number): V3 => [v[0] * k, v[1] * k, v[2] * k];

/**
 * Booleana do OpenCascade com várias ferramentas de uma vez (podem se cruzar entre si) e
 * tolerância difusa: mais robusta e rápida que encadear fuse/cut ou usar compostos.
 */
export function booleana(tipo: "unir" | "cortar" | "comum", alvo: Shape3D, ferramentas: Shape3D[]): Shape3D {
  if (!ferramentas.length) return alvo;
  const oc = getOC() as any;
  const op = new oc[tipo === "unir" ? "BRepAlgoAPI_Fuse" : tipo === "cortar" ? "BRepAlgoAPI_Cut" : "BRepAlgoAPI_Common"]();
  const args = new oc.NCollection_List_TopoDS_Shape();
  const ferr = new oc.NCollection_List_TopoDS_Shape();
  try {
    args.Append(alvo.wrapped);
    for (const f of ferramentas) ferr.Append(f.wrapped);
    op.SetArguments(args);
    op.SetTools(ferr);
    op.SetFuzzyValue(1e-5);
    op.SetRunParallel(false);
    op.Build();
    if (!op.IsDone() || op.HasErrors()) throw new Error(`Falha na operação booleana (${tipo}).`);
    return cast(op.Shape()) as Shape3D;
  } finally {
    op.delete();
    args.delete();
    ferr.delete();
  }
}

export function poligono(pts: P2[]): Drawing {
  let p = draw(pts[0]);
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
    if (Math.hypot(x1 - x0, y1 - y0) > 1e-4) p = p.lineTo(pts[i]);
  }
  return p.close();
}

/** Perfil do aro em (u, v). */
function perfilDesenho(p: Perfil, w: number, t: number): Drawing {
  const h = w / 2;
  switch (p) {
    case "reto": return poligono([[0, -h], [t, -h], [t, h], [0, h]]);
    case "meia-cana": return draw([0, -h]).threePointsArcTo([0, h], [t, 0]).close();
    case "conforto": { const e = 0.25 * t; return draw([e, -h]).threePointsArcTo([e, h], [t, 0]).threePointsArcTo([e, -h], [0, 0]).close(); }
    case "faca": return poligono([[0, -h], [0.4 * t, -h], [t, 0], [0.4 * t, h], [0, h]]);
  }
}

/** Seção do aro em θ (com torção em torno do centro do perfil, mantendo o diâmetro interno). */
function secaoAro(d: DocJoia, R: number, th: number): Sk {
  const a = d.aro, { w, t } = secao(a, th);
  let dr = perfilDesenho(a.perfil, w, t);
  const ang = (torcaoEfetiva(a) * 180 * th) / (2 * Math.PI);
  if (ang) {
    const c = Math.cos(ang * RAD), s = Math.sin(ang * RAD);
    const minU = Math.min(...pontosPerfil(a.perfil, w, t).map(([u, v]) => t / 2 + (u - t / 2) * c - v * s));
    dr = dr.rotate(ang, [t / 2, 0]).translate(-minU, 0);
  }
  return naPlano(dr, esc(rHat(th), R), rHat(th), tHat(th));
}

export function fazerAro(d: DocJoia, R: number): Shape3D {
  const a = d.aro;
  if (!porLoft(a)) {
    if (a.largura === a.larguraBase && a.espessura === a.espessuraBase) return secaoAro(d, R, 0).revolve([0, 0, 1], { origin: [0, 0, 0], angle: 360 });
    return aroAfunilado(d, R);
  }
  const N = 32;
  const metade = (i0: number) => {
    const s = Array.from({ length: N / 2 + 1 }, (_, i) => secaoAro(d, R, ((i0 + i) * 2 * Math.PI) / N));
    return s[0].loftWith(s.slice(1), { ruled: false });
  };
  return booleana("unir", metade(0), [metade(N / 2)]);
}

/**
 * Aro afunilado só com superfícies analíticas (toros, cilindros e planos: booleanas rápidas): o
 * perfil do topo gira num eixo deslocado de e = (t_topo − t_base)/2 (a espessura cai até a base),
 * as laterais são planos z = ±(c0 + c1·y) (largura linear em cos θ) e o furo é concêntrico.
 */
function aroAfunilado(d: DocJoia, R: number): Shape3D {
  const a = d.aro, tt = a.espessura, h = a.largura / 2;
  const e = (tt - a.espessuraBase) / 2, x0 = R - e, xIn = R - e - 0.6, ec = 0.25 * tt;
  let perfil: Drawing;
  switch (a.perfil) {
    case "reto": perfil = poligono([[xIn, -h], [x0 + tt, -h], [x0 + tt, h], [xIn, h]]); break;
    case "meia-cana": perfil = draw([xIn, -h]).lineTo([x0, -h]).threePointsArcTo([x0, h], [x0 + tt, 0]).lineTo([xIn, h]).close(); break;
    case "conforto": perfil = draw([xIn, -h]).lineTo([x0 + ec, -h]).threePointsArcTo([x0 + ec, h], [x0 + tt, 0]).lineTo([xIn, h]).close(); break;
    case "faca": perfil = poligono([[xIn, -h], [x0 + 0.4 * tt, -h], [x0 + tt, 0], [x0 + 0.4 * tt, h], [xIn, h]]); break;
  }
  let corpo = naPlano(perfil, [0, e, 0], [0, 1, 0], [1, 0, 0]).revolve([0, 0, 1], { origin: [0, e, 0], angle: 360 });
  if (a.largura !== a.larguraBase) {
    // referida ao Ø interno e 0,02 mm mais larga: no topo o plano não toca a aresta do perfil (geometria degenerada)
    const c0 = (a.largura + a.larguraBase) / 4 + 0.02, c1 = (a.largura - a.larguraBase) / (4 * R);
    const Y = R + tt + 3, meia = (y: number) => Math.max(0.05, c0 + c1 * y);
    const laje = naPlano(poligono([[-Y, -meia(-Y)], [Y, -meia(Y)], [Y, meia(Y)], [-Y, meia(-Y)]]), [-Y, 0, 0], [0, 1, 0], [1, 0, 0]).extrude(2 * Y);
    corpo = booleana("comum", corpo, [laje]);
  }
  const H = h + 1;
  const furo = a.perfil === "conforto"
    ? naPlano(draw([1, -H]).lineTo([R + ec, -H]).lineTo([R + ec, -h]).threePointsArcTo([R + ec, h], [R, 0]).lineTo([R + ec, H]).lineTo([1, H]).close(), [0, 0, 0], [0, 1, 0], [1, 0, 0])
      .revolve([0, 0, 1], { origin: [0, 0, 0], angle: 360 })
    : makeCylinder(R, 2 * H, [0, 0, -H], [0, 0, 1]);
  return booleana("cortar", corpo, [furo]);
}

// ---------------------------------------------------------------------------------------------
// gemas: assento (cortador) no referencial local, depois posto no lugar

const CURVAS = new Set(["oval", "almofada", "gota", "navete", "coracao"]);
/** Contorno da cintura: círculo, spline (lapidações curvas: poucas faces) ou polígono (facetadas). */
function contornoGema(g: GemaPosta["gema"], k: number): Drawing {
  if (g.lapidacao === "redonda") return drawCircle((g.largura / 2) * k);
  const pts = contorno(g.lapidacao, g.comprimento, g.largura, 32).map(([x, y]) => [x * k, y * k] as P2);
  if (!CURVAS.has(g.lapidacao)) return poligono(pts);
  return drawPointsInterpolation([...pts, pts[0]], { tolerance: 1e-3 * k * g.largura, degMax: 3 }, { closeShape: true });
}

const noLugar = (s: Shape3D, g: GemaPosta) => {
  let r = s;
  if (g.ref.ry) r = r.rotate(g.ref.ry / RAD, [0, 0, 0], [0, 1, 0]);
  if (g.ref.rz) r = r.rotate(g.ref.rz / RAD, [0, 0, 0], [0, 0, 1]);
  return r.translate(g.ref.p);
};

/** Cortador da gema: furo de luz, pavilhão, cintura e passagem (reta ou acompanhando a coroa). */
export function cortador(g: GemaPosta, furo: number): Shape3D {
  const pr = proporcoes(g.gema);
  const sF = 0.5, cul = Math.max(pr.culaca, 0.2);
  const yF = (-pr.pavilhao * (1 - sF)) / (1 - cul);
  const topo = pr.cintura + pr.coroa;
  // furo ≤ 0: sem furo de luz (o pavilhão termina na culaça; o aro sob a cabeça fica inteiro)
  const secs: [number, number][] = furo > 0.05 ? [[sF, -pr.pavilhao - furo], [sF, yF], [1, 0]] : [[cul, -pr.pavilhao], [1, 0]];
  if (g.passagem === "reta") secs.push([1, topo + 1.5]);
  else secs.push([1, pr.cintura], [pr.mesa, topo], [pr.mesa, topo + 0.5]);
  const sk = secs.map(([k, y]) => naPlano(contornoGema(g.gema, k), [0, y, 0], [1, 0, 0], [0, 1, 0]));
  return noLugar(sk[0].loftWith(sk.slice(1), { ruled: true }), g);
}

const vol = (s: Shape3D) => measureShapeVolumeProperties(s).volume;

/**
 * Booleana conferida pelo volume (o OpenCascade às vezes devolve um sólido quebrado sem erro):
 * se o lote falhar, refaz uma ferramenta por vez e deixa de fora (com aviso) a que o kernel não aplica.
 */
export function segura(tipo: "unir" | "cortar" | "comum", alvo: Shape3D, fs: Shape3D[], avisos: string[], nome: string): Shape3D {
  if (!fs.length) return alvo;
  const v0 = vol(alvo), vf = fs.map(vol), eps = 1e-3 * v0 + 1e-3;
  const ok = (v: number, a: number, s: number) =>
    tipo === "unir" ? v >= a - eps && v <= a + s + eps : tipo === "cortar" ? v <= a + eps && v >= a - s - eps && v > 0.05 * a : v <= a + eps && v > 0.2 * a;
  try {
    const t0 = performance.now();
    const r = booleana(tipo, alvo, fs);
    const vr = vol(r);
    if ((globalThis as any).DEPURAR_JOIA) console.log(`  ${nome}: ${fs.length} ferramentas, ${(performance.now() - t0).toFixed(0)} ms, ${v0.toFixed(1)} → ${vr.toFixed(1)}`);
    if (ok(vr, v0, vf.reduce((x, y) => x + y, 0))) return r;
    if ((globalThis as any).DEPURAR_JOIA) console.log(`  ${nome}: lote recusado, uma por vez`);
  } catch {
    /* tenta uma por vez */
  }
  if (tipo === "comum") {
    avisos.push(`${nome}: o kernel não conseguiu aplicar; ficou de fora.`);
    return alvo;
  }
  let atual = alvo, va = v0, falhas = 0;
  fs.forEach((f, i) => {
    try {
      const r = booleana(tipo, atual, [f]);
      const vr = vol(r);
      if (ok(vr, va, vf[i])) { atual = r; va = vr; return; }
    } catch {
      /* conta como falha */
    }
    falhas++;
  });
  if (falhas) avisos.push(`${nome}: ${falhas} de ${fs.length} elemento(s) não puderam ser aplicados pelo kernel.`);
  return atual;
}

/** Haste arredondada (garra ou conta) da base ao topo: cilindro + esfera (primitivas robustas). */
export function haste(h: Haste): Shape3D {
  const d: V3 = [h.topo[0] - h.base[0], h.topo[1] - h.base[1], h.topo[2] - h.base[2]];
  const L = Math.hypot(...d);
  return booleana("unir", makeCylinder(h.r, L, h.base, esc(d, 1 / L)), [makeSphere(h.r).translate(h.topo)]);
}

/** Anel extrudado (contorno escalado de fora menos o de dentro) na altura y, girado em Y. */
function faixa(g: GemaPosta["gema"], kFora: number, kDentro: number, y0: number, altura: number, ry: number): Shape3D {
  const dr = contornoGema(g, kFora).cut(contornoGema(g, kDentro));
  let s = naPlano(dr, [0, y0, 0], [1, 0, 0], [0, 1, 0]).extrude(altura);
  if (ry) s = s.rotate(ry / RAD, [0, 0, 0], [0, 1, 0]);
  return s;
}

/** Faixa angular (θ de a0 a a1, rad) do perfil retangular u ∈ [r0, r1], v ∈ [v0, v1], girando em Z. */
function faixaAngular(a0: number, a1: number, r0: number, r1: number, v0: number, v1: number): Shape3D {
  const dr = poligono([[r0, v0], [r1, v0], [r1, v1], [r0, v1]]);
  return naPlano(dr, [0, 0, 0], rHat(a1), tHat(a1)).revolve([0, 0, 1], { origin: [0, 0, 0], angle: (a1 - a0) / RAD });
}

/** Cápsula (cilindro com esfera nas duas pontas): ponta alongada da garra. */
function capsula(h: Haste): Shape3D {
  return booleana("unir", haste(h), [makeSphere(h.r).translate(h.base)]);
}

/**
 * Fio de perfil redondo: varredura de um círculo ao longo da curva (spline aproximada a 0,03 mm),
 * com lei linear de escala para o Ø inicial/final. As pontas da trajetória são aparadas 0,6·r e
 * cobertas por esferas: nada coincide exatamente (arestas coincidentes deixam a booleana lenta e
 * errada). Devolve os tubos e as esferas das pontas/juntas (repetidas são removidas em `construir`).
 */
export function fioSolido(f: { pts: V3[]; raios: number[]; bolinhaIni: boolean; bolinhaFim: boolean }): { tubos: Shape3D[]; esferas: [V3, number][] } {
  const n = f.pts.length;
  const dd = (p: V3, q: V3) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
  const fechado = dd(f.pts[0], f.pts[n - 1]) < 1e-6;
  const tubo = (a: number, b: number): Shape3D | null => {
    let i0 = a, i1 = b;
    while (i0 < b - 2 && dd(f.pts[i0], f.pts[a]) < 0.6 * f.raios[a]) i0++;
    while (i1 > i0 + 2 && dd(f.pts[i1], f.pts[b]) < 0.6 * f.raios[b]) i1--;
    const pts = f.pts.slice(i0, i1 + 1);
    if (pts.length < 2 || dd(pts[0], pts[pts.length - 1]) < 1e-4) return null;
    const oc = getOC() as any;
    const e = makeBSplineApproximation(pts, { tolerance: 0.03, degMax: 3 });
    const ad = new oc.BRepAdaptor_Curve((e as any).wrapped);
    const u0 = ad.FirstParameter(), u1 = ad.LastParameter();
    ad.delete();
    const t: V3 = [pts[1][0] - pts[0][0], pts[1][1] - pts[0][1], pts[1][2] - pts[0][2]];
    const perfil = assembleWire([makeCircle(f.raios[i0], pts[0], esc(t, 1 / (Math.hypot(...t) || 1)))]);
    let lei = null;
    if (Math.abs(f.raios[i1] - f.raios[i0]) > 1e-6) {
      lei = new oc.Law_Linear();
      lei.Set(u0, 1, u1, f.raios[i1] / f.raios[i0]);
    }
    return genericSweep(perfil, assembleWire([e]), { frenet: true, law: lei, forceProfileSpineOthogonality: true } as never);
  };
  const tubos: Shape3D[] = [];
  const esferas: [V3, number][] = [];
  if (fechado) {
    const meio = Math.floor((n - 1) / 2);
    for (const s of [tubo(0, meio), tubo(meio, n - 1)]) if (s) tubos.push(s);
    esferas.push([f.pts[0], f.raios[0]], [f.pts[meio], f.raios[meio]]);
  } else {
    const s = tubo(0, n - 1);
    if (s) tubos.push(s);
    esferas.push([f.pts[0], f.raios[0] * (f.bolinhaIni ? 1.3 : 1)], [f.pts[n - 1], f.raios[n - 1] * (f.bolinhaFim ? 1.3 : 1)]);
  }
  return { tubos, esferas };
}

/** Aro dividido: rasgo central que abre até `dividido` mm no topo e fecha em ±`divisao` graus. */
function divisao(d: DocJoia, R: number): Shape3D {
  const a = d.aro, div = a.divisao * RAD, T = R + Math.max(a.espessura, a.espessuraBase) + 1;
  const N = 9;
  const secs = Array.from({ length: N }, (_, i) => {
    const th = -div + (2 * div * i) / (N - 1);
    const hw = Math.max(0.02, (a.dividido / 2) * (1 + Math.cos((Math.PI * th) / div)) / 2);
    return naPlano(poligono([[R - 1, -hw], [T, -hw], [T, hw], [R - 1, hw]]), [0, 0, 0], rHat(th), tHat(th));
  });
  return secs[0].loftWith(secs.slice(1), { ruled: false });
}

// ---------------------------------------------------------------------------------------------
// gravação

function gravacao(d: DocJoia, m: Montagem, grupos: GrupoTexto[]): Shape3D[] {
  const g = d.gravacao, R = m.R, a = d.aro;
  const out: Shape3D[] = [];
  for (const gr of grupos) {
    let dr = poligono(gr.contornos[0].map(([x, y]) => [x, -y]));
    for (const furo of gr.contornos.slice(1)) dr = dr.cut(poligono(furo.map(([x, y]) => [x, -y])));
    if (g.lado === "interno") {
      const th = g.posicao * RAD + gr.x / R;
      const prof = 0.5 + g.profundidade + superficieInterna(a, th, g.altura / 2);
      out.push(naPlano(dr, esc(rHat(th), R - 0.5), tHat(th), rHat(th)).extrude(prof));
    } else {
      const th0 = g.posicao * RAD;
      const th = th0 - gr.x / (R + superficie(a, th0, 0));
      const t = superficie(a, th, 0);
      const prof = 0.5 + g.profundidade + (t - superficie(a, th, g.altura / 2));
      out.push(naPlano(dr, esc(rHat(th), R + t + 0.5), esc(tHat(th), -1), esc(rHat(th), -1)).extrude(prof));
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// joia completa

export interface ResultadoJoia {
  forma: Shape3D;
  montagem: Montagem;
  avisos: string[];
}

/** `rapida`: só aro e cabeça (prévia enquanto o resto é calculado). */
export function construir(d: DocJoia, grupos: GrupoTexto[] = [], larguraTexto = 0, rapida = false): ResultadoJoia {
  const m = montar(d);
  const R = m.R, a = d.aro;
  const avisos: string[] = [];
  const tMax = Math.max(a.espessura, a.espessuraBase) + 20;
  let metal = fazerAro(d, R);
  if (!(vol(metal) > 1)) throw new Error("O aro não pôde ser gerado com essas medidas (perfil, largura e espessura).");
  if (a.dividido > 0) metal = segura("cortar", metal, [divisao(d, R)], avisos, "Aro dividido");

  // texturas (só no aro, fora das zonas ocupadas)
  if (d.textura.tipo !== "nenhuma" && !rapida) {
    const livres = intervalosLivres(zonasOcupadas(d, m, larguraTexto, false));
    if (d.textura.tipo === "facetas") {
      const poli = poligonoFacetas(d, m, livres);
      if (poli) metal = segura("comum", metal, [naPlano(poligono(poli), [0, 0, -tMax], [1, 0, 0], [0, 0, 1]).extrude(2 * tMax)], avisos, "Facetas");
    } else {
      const ps = d.textura.profundidade;
      const frisos = angulosFrisos(d, livres).map((gr) => {
        const th = gr * RAD, ro = R + secao(a, th).t;
        const ap = esc(rHat(th), ro - ps), b = esc(rHat(th), ro + 0.6), hw = ps + 0.6;
        const tri: P2[] = [[ap[0], ap[1]], [b[0] + tHat(th)[0] * hw, b[1] + tHat(th)[1] * hw], [b[0] - tHat(th)[0] * hw, b[1] - tHat(th)[1] * hw]];
        return naPlano(poligono(tri), [0, 0, -tMax], [1, 0, 0], [0, 0, 1]).extrude(2 * tMax);
      });
      metal = segura("cortar", metal, frisos, avisos, "Frisos");
    }
    if (!livres.length) avisos.push("Textura sem espaço livre no aro (cabeça, pavé e gravação ocupam a volta toda).");
  }

  // cabeça, contas e trilhos (uma união só)
  const partes: Shape3D[] = [];
  if (m.cabeca) {
    const g = m.cabeca;
    if (d.cabeca.tipo === "garras") {
      partes.push(...m.garras.map(haste));
      if (m.galeria) partes.push(faixa(g.gema, m.galeria.escalaFora, m.galeria.escalaDentro, m.galeria.y - m.galeria.altura / 2, m.galeria.altura, g.ref.ry));
    } else if (m.inglesa) {
      const ing = m.inglesa;
      partes.push(faixa(g.gema, ing.escala, ing.escalaFuro, ing.yBase, ing.yTopo - ing.yBase, g.ref.ry));
    }
  }
  partes.push(...m.capsulas.map(capsula));
  const esferas: [V3, number][] = [];
  for (const f of m.orn.fios) {
    const r = fioSolido(f);
    partes.push(...r.tubos);
    for (const [p, raio] of r.esferas) {
      const o = esferas.find(([q]) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) < 1e-4);
      if (o) o[1] = Math.max(o[1], raio);
      else esferas.push([p, raio]);
    }
  }
  partes.push(...esferas.map(([p, raio]) => makeSphere(raio).translate(p)));
  for (const q of m.orn.pontos) if (q.tipo === "conta") partes.push(makeSphere(q.d / 2).translate(q.p));
  for (const x of m.gemasOrn) partes.push(noLugar(naPlano(drawCircle(x.gema.gema.largura / 2 + 0.4).cut(drawCircle(x.gema.gema.largura * 0.4)), [0, x.yBase, 0], [1, 0, 0], [0, 1, 0]).extrude(x.yTopo - x.yBase), x.gema));
  partes.push(...m.contas.map((c) => makeSphere(c.r).translate(c.topo)));
  partes.push(...m.trilhos.map((t) => faixaAngular(t.a0, t.a1, t.rBase, t.rTopo, t.v - t.espessura / 2, t.v + t.espessura / 2)));
  // prévia: tudo junto sem booleanas (aparece na hora; a união e os cortes vêm na versão final)
  if (rapida) return { forma: makeCompound([metal, ...partes]) as Shape3D, montagem: m, avisos };
  metal = segura("unir", metal, partes, avisos, "Cabeça, contas e trilhos");

  // assentos das gemas e gravação (um corte só)
  const cortes: Shape3D[] = [];
  // furo de luz da cabeça só até o topo do aro: não corta o aro sob a gema
  if (m.cabeca) cortes.push(cortador(m.cabeca, m.cabeca.ref.p[1] - proporcoes(m.cabeca.gema).pavilhao - (R + superficie(a, 0, 0)) - 0.15));
  for (const x of m.gemasOrn) cortes.push(cortador(x.gema, 0.6));
  for (const g of m.pave) cortes.push(cortador(g, Math.hypot(g.ref.p[0], g.ref.p[1]) - proporcoes(g.gema).pavilhao - R + 0.5));
  if (d.gravacao.ativo && grupos.length) cortes.push(...gravacao(d, m, grupos));
  metal = segura("cortar", metal, cortes, avisos, "Assentos e gravação");

  // ocar: canal interno nas zonas livres
  if (d.fabricacao.ocar) {
    const par = d.fabricacao.parede;
    const canais: Shape3D[] = [];
    for (const [g0, g1] of intervalosLivres(zonasOcupadas(d, m, larguraTexto, true), 15)) {
      const a0 = (g0 + 3) * RAD, a1 = (g1 - 3) * RAD;
      let tMin = Infinity, wMin = Infinity;
      for (let i = 0; i <= 12; i++) { const s = secao(a, a0 + ((a1 - a0) * i) / 12); tMin = Math.min(tMin, s.t); wMin = Math.min(wMin, s.w); }
      const prof = tMin - par, wc = wMin - 2 * par;
      if (prof < 0.3 || wc < 0.5) { avisos.push("Ocar: o aro é fino demais para o canal interno com essa parede."); continue; }
      canais.push(faixaAngular(a0, a1, R - 1, R + prof, -wc / 2, wc / 2));
    }
    if (canais.length) metal = segura("cortar", metal, canais, avisos, "Ocar");
    else if (!avisos.some((x) => x.startsWith("Ocar"))) avisos.push("Ocar: sem espaço livre no aro.");
  }
  return { forma: metal, montagem: m, avisos };
}

/** Peça para fabricar: contração (escala a partir do centro) e canais de fundição na base. */
export function paraFabricar(d: DocJoia, forma: Shape3D, comCanais: boolean, escalar = true): Shape3D {
  let s = forma;
  const f = d.fabricacao;
  if (comCanais && f.canais > 0) {
    const R = montar(d).R, tb = secao(d.aro, Math.PI).t;
    s = booleana("unir", s, Array.from({ length: f.canais }, (_, k) => {
      const dir = rHat((180 + (k - (f.canais - 1) / 2) * 15) * RAD);
      return makeCylinder(f.diamCanal / 2, f.compCanal + 0.4, esc(dir, R + tb - 0.4), dir);
    }));
  }
  if (f.contracao && escalar) s = s.scale(1 + f.contracao / 100, [0, 0, 0]);
  return s;
}

export function medidas(s: Shape3D): { volume: number; area: number } {
  return { volume: measureShapeVolumeProperties(s).volume, area: measureArea(s) };
}

