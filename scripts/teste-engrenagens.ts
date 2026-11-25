// Teste do gerador de engrenagens (src/biblioteca/engrenagens.ts + src/kernel/engrenagem.ts) em Node:
// diâmetros e grandezas contra as fórmulas da norma, flanco evolvente exato (pontos da B-spline do kernel
// sobre a evolvente), espessura do dente no primitivo = π·m/2 (com e sem deslocamento) medida no sólido,
// volume = área do perfil × largura, sentido da hélice, chaveta DIN 6885, pares (distância entre centros,
// razão, compatibilidade) e o engrenamento na posição do par: interseção ≈ 0 e, meio passo girada, grande.
import opencascade from "replicad-opencascadejs";
import { makeCylinder, makeBox, measureShapeVolumeProperties, setOC, type Shape3D } from "replicad";
import { createRequire } from "node:module";
import type { ParamEngrenagem } from "../src/model";
import {
  areaPoligono, calcularPar, chavetaDIN6885, contornoTransversal, documentoEngrenagem, engrenagemDaPeca, espessuraNoRaio, geometria, inv, invInversa,
  meioAngulo, nomeEngrenagem, paramCompleto, parceiraSugerida, perfilCremalheira, poligonoDoContorno, poseDoPar, valoresCalculados,
} from "../src/biblioteca/engrenagens";
import type { Transformacao } from "../src/montagem/modelo";

const require = createRequire(import.meta.url);
setOC(await (opencascade as any)({ locateFile: () => require.resolve("replicad-opencascadejs/wasm") }));
const { regenerar } = await import("../src/kernel/regenerar");
const { arestasDoContorno, solidoEngrenagem } = await import("../src/kernel/engrenagem");

let falhas = 0;
function confere(nome: string, obtido: number | null | undefined, esperado: number, tol = 1e-3) {
  const v = obtido ?? NaN;
  const ok = Math.abs(v - esperado) <= tol * Math.max(1, Math.abs(esperado));
  if (!ok) falhas++;
  console.log(`${ok ? "ok  " : "FALHA"} ${nome}: ${v.toFixed(4)} (esperado ${esperado.toFixed(4)})`);
}
function verdade(nome: string, v: boolean, extra = "") {
  if (!v) falhas++;
  console.log(`${v ? "ok  " : "FALHA"} ${nome}${extra ? ` ${extra}` : ""}`);
}
function erro(nome: string, f: () => unknown, trecho: string) {
  let msg = "";
  try {
    f();
  } catch (e) {
    msg = (e as Error).message;
  }
  verdade(nome, msg.includes(trecho), `→ "${msg}"`);
}
const vol = (s: Shape3D) => measureShapeVolumeProperties(s).volume;
const rad = (g: number) => (g * Math.PI) / 180;
const P = (p: Partial<ParamEngrenagem>) => paramCompleto(p);

/** Coloca o sólido na pose (quatérnio → eixo/ângulo). */
function posar(s: Shape3D, t: Transformacao): Shape3D {
  const [x, y, z, w] = t.rot;
  const ang = 2 * Math.acos(Math.max(-1, Math.min(1, w)));
  const sn = Math.sin(ang / 2);
  let r = s.clone() as Shape3D;
  if (Math.abs(sn) > 1e-12) r = r.rotate((ang * 180) / Math.PI, [0, 0, 0], [x / sn, y / sn, z / sn]) as Shape3D;
  return r.translate(t.pos[0], t.pos[1], t.pos[2]) as Shape3D;
}
/** Espessura média do material no raio r entre y0 e y0 + h: casca fina ∩ sólido = z · s · 2ε · h. */
function espessuraMedida(s: Shape3D, r: number, z: number, y0: number, h: number, eps = 0.01): number {
  const casca = (makeCylinder(r + eps, h, [0, y0, 0], [0, 1, 0]) as Shape3D).cut(makeCylinder(r - eps, h + 1, [0, y0 - 0.5, 0], [0, 1, 0]) as Shape3D) as Shape3D;
  return vol(s.intersect(casca) as Shape3D) / (z * 2 * eps * h);
}

// ---------- grandezas (fórmulas da norma, ISO 21771 / DIN 3975) ----------
{
  const g = geometria(P({ tipoEngrenagem: "reta", modulo: 2, dentes: 20 }));
  confere("reta m2 z20: d = 40", 2 * g.r, 40);
  confere("reta m2 z20: da = 44", 2 * g.ra, 44);
  confere("reta m2 z20: df = 35", 2 * g.rf, 35);
  confere("reta m2 z20: db = 40·cos 20°", 2 * g.rb, 40 * Math.cos(rad(20)));
  confere("reta m2 z20: passo = 2π", g.pt, 2 * Math.PI);
  const gx = geometria(P({ tipoEngrenagem: "reta", modulo: 2, dentes: 20, deslocamento: 0.3 }));
  confere("x = 0,3: da = d + 2m(1 + x) = 45,2", 2 * gx.ra, 45.2);
  confere("x = 0,3: df = d − 2m(1,25 − x) = 36,2", 2 * gx.rf, 36.2);
  const h = geometria(P({ tipoEngrenagem: "helicoidal", modulo: 2, dentes: 20, helice: 15 }));
  confere("helicoidal mn2 z20 β15: mt = mn/cos β", h.mt, 2 / Math.cos(rad(15)));
  confere("helicoidal: d = z·mt", 2 * h.r, (20 * 2) / Math.cos(rad(15)));
  confere("helicoidal: da = d + 2mn", 2 * h.ra, (20 * 2) / Math.cos(rad(15)) + 4);
  confere("helicoidal: αt = atan(tan αn / cos β)", h.at, Math.atan(Math.tan(rad(20)) / Math.cos(rad(15))));
  const i = geometria(P({ tipoEngrenagem: "interna", modulo: 2, dentes: 60 }));
  confere("interna m2 z60: d = 120", 2 * i.r, 120);
  confere("interna: Ø da ponta (dentro) = d − 2m = 116", 2 * i.ra, 116);
  confere("interna: Ø do fundo = d + 2,5m = 125", 2 * i.rf, 125);
  confere("interna: aro automático = df + 6m", 2 * i.raio_aro!, 125 + 12);
  const w = geometria(P({ tipoEngrenagem: "semFim", modulo: 2, dentes: 2, coefDiametro: 10 }));
  confere("sem-fim m2 q10: d1 = 20", 2 * w.r, 20);
  confere("sem-fim: da1 = d1 + 2m = 24", 2 * w.ra, 24);
  confere("sem-fim: df1 = d1 − 2,4m = 15,2", 2 * w.rf, 15.2);
  confere("sem-fim z1 = 2: γ = atan(2/10) (graus)", (w.gama! * 180) / Math.PI, (Math.atan(0.2) * 180) / Math.PI);
  confere("sem-fim: avanço = z1·π·m", w.avanco!, 4 * Math.PI);
  const c = geometria(P({ tipoEngrenagem: "conica", modulo: 2, dentes: 20, dentesPar: 40 }));
  confere("cônica 20/40 a 90°: δ1 = atan(20/40) (graus)", (c.delta! * 180) / Math.PI, (Math.atan(0.5) * 180) / Math.PI);
  confere("cônica: Re = r/sin δ", c.Re!, 20 / Math.sin(Math.atan(0.5)));
  const co = geometria(P({ tipoEngrenagem: "coroa", modulo: 2, dentes: 40, entradas: 2, coefDiametro: 10 }));
  confere("coroa: β = γ do sem-fim", co.beta, Math.atan(0.2));
  confere("coroa: d2 = z2·m (módulo axial do sem-fim)", 2 * co.r, 80);
  confere("inv(20°) = 0,014904", inv(rad(20)), 0.0149044, 1e-5);
  confere("invInversa(inv(25°)) = 25°", invInversa(inv(rad(25))), rad(25), 1e-9);
  const ch12 = chavetaDIN6885(12)!, ch25 = chavetaDIN6885(25)!;
  verdade("DIN 6885: Ø12 → 4×4 t2 1,8; Ø25 → 8×7 t2 3,3", ch12.b === 4 && ch12.h === 4 && ch12.t2 === 1.8 && ch25.b === 8 && ch25.h === 7 && ch25.t2 === 3.3);
  verdade("DIN 6885: Ø5 fora da tabela", chavetaDIN6885(5) === null);
  const val = valoresCalculados(P({ tipoEngrenagem: "reta", dentes: 12 }));
  verdade("z = 12 sem deslocamento avisa adelgaçamento (x mín ≈ 0,30)", val.avisos.some((a) => a.includes("adelgaçamento") && a.includes("0,3")), val.avisos.join(" | "));
  verdade("valores mostrados incluem Ø primitivo, externo e de raiz", ["Diâmetro primitivo d", "Diâmetro externo da", "Diâmetro de raiz df"].every((r) => val.valores.some((v) => v.rotulo === r)));
  erro("dente pontudo vira erro claro", () => geometria(P({ dentes: 8, deslocamento: 1.4 })), "pontudo");
  erro("helicoidal sem β vira erro claro", () => geometria(P({ tipoEngrenagem: "helicoidal", helice: 0 })), "ângulo de hélice");
  erro("cônica larga demais vira erro claro", () => geometria(P({ tipoEngrenagem: "conica", largura: 40 })), "Re/2");
}

// ---------- perfil evolvente: espessura no primitivo (puro) ----------
{
  for (const [x, rot] of [[0, "x = 0"], [0.3, "x = 0,3"], [-0.2, "x = −0,2"]] as [number, string][]) {
    const g = geometria(P({ tipoEngrenagem: "reta", modulo: 2, dentes: 20, deslocamento: x }));
    confere(`espessura no primitivo, ${rot}: m(π/2 + 2x·tan α)`, espessuraNoRaio(g, g.r), 2 * (Math.PI / 2 + 2 * x * Math.tan(rad(20))), 1e-9);
  }
  const g = geometria(P({ modulo: 3, dentes: 25 }));
  // os pontos do flanco ficam exatamente na evolvente do círculo de base: ρ² = rb²(1 + t²) e θ = ±ψ(ρ)
  const tr = contornoTransversal(g).find((t) => t.t === "curva")!;
  let pior = 0;
  if (tr.t === "curva") for (const [px, pz] of tr.pts) {
    const rho = Math.hypot(px, pz), th = Math.atan2(pz, px);
    pior = Math.max(pior, Math.abs(rho * (th + meioAngulo(g, rho))));
  }
  verdade("pontos do flanco sobre a evolvente (desvio < 1e-12 mm)", pior < 1e-12, `(${pior.toExponential(1)})`);
}

// ---------- flanco no kernel: B-spline sobre a evolvente exata ----------
{
  const g = geometria(P({ modulo: 3, dentes: 25 }));
  const trechos = contornoTransversal(g);
  const arestas = arestasDoContorno(trechos);
  let pior = 0, amostras = 0;
  trechos.forEach((t, k) => {
    if (t.t !== "curva" || k > 12) return;
    const e = arestas[k];
    const dente = Math.round(Math.atan2(t.pts[t.pts.length >> 1][1], t.pts[t.pts.length >> 1][0]) / ((2 * Math.PI) / g.z));
    const c = (dente * 2 * Math.PI) / g.z;
    for (let i = 0; i <= 200; i++) {
      const p = e.pointAt(i / 200);
      const rho = Math.hypot(p.x, p.z);
      if (rho < g.rb) continue;
      const th = Math.atan2(p.z, p.x) - c;
      const d = Math.min(Math.abs(th + meioAngulo(g, rho)), Math.abs(th - meioAngulo(g, rho)));
      pior = Math.max(pior, rho * d);
      amostras++;
    }
  });
  verdade(`flanco do kernel sobre a evolvente: desvio máx < 0,1 µm em ${amostras} pontos`, pior < 1e-4, `(${(pior * 1000).toFixed(5)} µm)`);
}

// ---------- sólidos: espessura medida, volume, hélice ----------
{
  const casos: [string, Partial<ParamEngrenagem>][] = [
    ["reta m2 z20", { tipoEngrenagem: "reta", modulo: 2, dentes: 20 }],
    ["reta m2 z20 x = 0,3", { tipoEngrenagem: "reta", modulo: 2, dentes: 20, deslocamento: 0.3 }],
    ["helicoidal mn2 z20 β15", { tipoEngrenagem: "helicoidal", modulo: 2, dentes: 20, helice: 15 }],
    ["interna m2 z60", { tipoEngrenagem: "interna", modulo: 2, dentes: 60 }],
    ["coroa m2 z40", { tipoEngrenagem: "coroa", modulo: 2, dentes: 40, entradas: 2 }],
  ];
  for (const [nome, p] of casos) {
    const g = geometria(P(p));
    const s = solidoEngrenagem(P(p));
    const esperado = g.tipo === "interna" ? g.st : g.st; // transversal (interna: dente interno)
    confere(`${nome}: espessura do dente no primitivo medida no sólido`, espessuraMedida(s, g.r, g.z, 0, P(p).largura), esperado, 2e-3);
  }
  verdade("reta m2 z20: espessura no primitivo = π·m/2 = 3,1416", Math.abs(espessuraMedida(solidoEngrenagem(P({ modulo: 2, dentes: 20 })), 20, 20, 0, 20) - Math.PI) < 5e-3);
  // cônica: perto da ponta maior (y de 0 a 1 mm) contra a média do perfil escalado para o vértice; e a
  // espessura do contorno no primitivo da ponta maior = π·m/2 (a projeção de Tredgold não muda o primitivo)
  {
    const p = P({ tipoEngrenagem: "conica", modulo: 2, dentes: 20, dentesPar: 40 });
    const g = geometria(p);
    const tr = contornoTransversal(g, 400);
    const pitch = poligonoDoContorno(tr, 1e-4).filter(([x, z]) => Math.abs(Math.hypot(x, z) - g.r) < 0.02 && Math.abs(Math.atan2(z, x)) < 0.3);
    const angs = pitch.map(([x, z]) => Math.atan2(z, x));
    confere("cônica (Tredgold): espessura no primitivo da ponta maior = π·m/2", g.r * (Math.max(...angs) - Math.min(...angs)), Math.PI, 2e-3);
    const k = (g.Re! - p.largura) / g.Re!, h = p.largura * Math.cos(g.delta!);
    let media = 0;
    const N = 40;
    for (let i = 0; i < N; i++) {
      const y = (i + 0.5) / N, s = 1 - ((1 - k) * y) / h;
      // perfil escalado s em torno do eixo: espessura no raio r = s · espessura(r/s)
      const pts = poligonoDoContorno(tr, 1e-4).map(([x, z]) => [x * s, z * s] as [number, number]).filter(([x, z]) => Math.abs(Math.hypot(x, z) - g.r) < 0.02 && Math.abs(Math.atan2(z, x)) < 0.3);
      const a = pts.map(([x, z]) => Math.atan2(z, x));
      media += (g.r * (Math.max(...a) - Math.min(...a))) / N;
    }
    confere("cônica: espessura no Ø primitivo medida no sólido (y de 0 a 1 mm)", espessuraMedida(solidoEngrenagem(p), g.r, g.z, 0, 1, 0.05), media, 5e-3);
  }
  // volume = área do contorno × largura (o mesmo perfil em toda a largura)
  for (const p of [P({ modulo: 2, dentes: 20 }), P({ tipoEngrenagem: "helicoidal", modulo: 2.5, dentes: 31, helice: 20, sentido: "esquerda", largura: 25 }), P({ tipoEngrenagem: "semFim", modulo: 2, dentes: 2, largura: 40 })]) {
    const g = geometria(p);
    const area = Math.abs(areaPoligono(poligonoDoContorno(contornoTransversal(g, 400), 0.0005)));
    confere(`${nomeEngrenagem(p)}: volume = área do perfil × largura`, vol(solidoEngrenagem(p)), area * p.largura, 2e-4);
  }
  {
    const p = P({ tipoEngrenagem: "interna", modulo: 2, dentes: 60 });
    const g = geometria(p);
    const area = Math.PI * g.raio_aro! ** 2 - Math.abs(areaPoligono(poligonoDoContorno(contornoTransversal(g, 400), 0.0005)));
    confere("interna: volume = (aro − furo dentado) × largura", vol(solidoEngrenagem(p)), area * p.largura, 2e-4);
  }
  {
    const p = P({ tipoEngrenagem: "cremalheira", modulo: 2, comprimento: 100, altura: 20, largura: 20 });
    const g = geometria(p);
    const area = Math.abs(areaPoligono(perfilCremalheira(g, 20, -50, 50)));
    confere("cremalheira reta: volume = perfil × largura", vol(solidoEngrenagem(p)), area * 20, 1e-6);
    const ph = P({ ...p, helice: 20 });
    confere("cremalheira helicoidal: mesmo volume do recorte (seção constante)", vol(solidoEngrenagem(ph)), Math.abs(areaPoligono(perfilCremalheira(geometria(ph), 20, -50, 50))) * 20, 2e-3);
  }
  // sentido da hélice: à direita o dente vai para θ menor ao subir (parafuso à direita em +Y). Largura de
  // um quarto de passo de torção: no topo, o lado certo é o centro do dente e o errado, o centro do vão
  for (const mao of ["direita", "esquerda"] as const) {
    const g0 = geometria(P({ tipoEngrenagem: "helicoidal", modulo: 2, dentes: 20, helice: 30 }));
    const b = (Math.PI * g0.r) / (2 * g0.z * Math.tan(g0.beta));
    const s = solidoEngrenagem(P({ tipoEngrenagem: "helicoidal", modulo: 2, dentes: 20, helice: 30, largura: b, sentido: mao }));
    const material = (sinal: number) => {
      const y = b - 0.1, th = (sinal * y * Math.tan(g0.beta)) / g0.r;
      const c = [g0.r * Math.cos(th), y, g0.r * Math.sin(th)];
      return vol(s.clone().intersect(makeBox([c[0] - 0.05, c[1] - 0.05, c[2] - 0.05], [c[0] + 0.05, c[1] + 0.05, c[2] + 0.05])) as Shape3D);
    };
    const certo = mao === "direita" ? -1 : 1;
    verdade(`hélice à ${mao}: no topo o dente está em θ = ${certo < 0 ? "−" : "+"}b·tan β / r (e o vão do outro lado)`, Math.abs(material(certo) - 1e-3) < 1e-6 && material(-certo) === 0);
  }
  // cubo, furo e chaveta
  {
    const base = P({ modulo: 2, dentes: 30, largura: 20 });
    const comp = P({ ...base, furo: 20, chaveta: true, cuboDiametro: 40, cuboComprimento: 15 });
    const ch = chavetaDIN6885(20)!;
    // rasgo: retângulo b × (r + t2) menos o segmento circular que já é furo
    const rr = 10, meio = ch.b / 2, ang = Math.asin(meio / rr);
    const segmento = rr * rr * ang + meio * Math.sqrt(rr * rr - meio * meio); // área do furo no lado z > 0 dentro da faixa |x| < b/2
    const rasgo = ch.b * (rr + ch.t2) - segmento;
    const esperado = vol(solidoEngrenagem(base)) + Math.PI * 20 ** 2 * 15 - Math.PI * 10 ** 2 * 35 - rasgo * 35;
    confere("cubo Ø40×15 + furo Ø20 + chaveta DIN 6885 6×6: volume", vol(solidoEngrenagem(comp)), esperado, 1e-4);
    erro("furo maior que a raiz vira erro claro", () => solidoEngrenagem(P({ ...base, furo: 60 })), "não cabe");
  }
}

// ---------- pares: distância entre centros, razão, compatibilidade ----------
{
  const a = calcularPar(P({ dentes: 20 }), P({ dentes: 40 }));
  confere("par reto 20/40 m2: a = 60", a.distancia, 60);
  confere("par reto 20/40: razão 2", a.razao, 2);
  verdade("par reto: grau de recobrimento entre 1,5 e 1,8", a.recobrimento! > 1.5 && a.recobrimento! < 1.8, `(${a.recobrimento!.toFixed(3)})`);
  const ax = calcularPar(P({ dentes: 20, deslocamento: 0.3 }), P({ dentes: 40, deslocamento: 0.2 }));
  // conferência: inv αw = inv α + 2 tan α (x1 + x2)/(z1 + z2); a = a0·cos α / cos αw
  const aw = invInversa(inv(rad(20)) + (2 * Math.tan(rad(20)) * 0.5) / 60);
  confere("par com deslocamento x1 = 0,3, x2 = 0,2: a = 60·cos α / cos αw", ax.distancia, (60 * Math.cos(rad(20))) / Math.cos(aw), 1e-9);
  verdade("par com deslocamento: 60 < a < 60 + (x1 + x2)·m", ax.distancia > 60 && ax.distancia < 61);
  const h = calcularPar(P({ tipoEngrenagem: "helicoidal", dentes: 20, helice: 15 }), P({ tipoEngrenagem: "helicoidal", dentes: 40, helice: 15, sentido: "esquerda" }));
  confere("par helicoidal 20/40 mn2 β15: a = (z1 + z2)·mt/2", h.distancia, (60 * 2) / Math.cos(rad(15)) / 2);
  const ii = calcularPar(P({ tipoEngrenagem: "interna", dentes: 60 }), P({ dentes: 20 }));
  confere("interna 60 com pinhão 20: a = (60 − 20)·m/2 = 40", ii.distancia, 40);
  confere("interna 60 (1ª) com pinhão 20: i = n1/n2 = 20/60", ii.razao, 1 / 3);
  const ir = calcularPar(P({ dentes: 20 }), P({ tipoEngrenagem: "interna", dentes: 60 }));
  confere("pinhão 20 (1º) com interna 60: i = 3", ir.razao, 3);
  const cr = calcularPar(P({ tipoEngrenagem: "cremalheira" }), P({ dentes: 20 }));
  confere("cremalheira e pinhão z20 m2: eixo a 20 mm da linha primitiva", cr.distancia, 20);
  confere("cremalheira: avanço por volta = π·d", cr.razao, 40 * Math.PI);
  const bv = calcularPar(P({ tipoEngrenagem: "conica", dentes: 20, dentesPar: 40 }), P({ tipoEngrenagem: "conica", dentes: 40, dentesPar: 20 }));
  confere("cônicas 20/40: razão 2", bv.razao, 2);
  const sf = calcularPar(P({ tipoEngrenagem: "coroa", dentes: 40, entradas: 2 }), P({ tipoEngrenagem: "semFim", dentes: 2, largura: 40 }));
  confere("coroa z40 e sem-fim z1 = 2 q10 m2: a = (80 + 20)/2 = 50", sf.distancia, 50);
  confere("coroa z40 (1ª) e sem-fim de 2 entradas: i = 2/40", sf.razao, 0.05);
  confere("sem-fim de 2 entradas (1º) e coroa z40: i = 20", calcularPar(P({ tipoEngrenagem: "semFim", dentes: 2, largura: 40 }), P({ tipoEngrenagem: "coroa", dentes: 40, entradas: 2 })).razao, 20);
  erro("módulos diferentes não engrenam", () => calcularPar(P({ modulo: 2 }), P({ modulo: 2.5 })), "Módulos diferentes");
  erro("helicoidais externas com a mesma mão não engrenam", () => calcularPar(P({ tipoEngrenagem: "helicoidal", helice: 15 }), P({ tipoEngrenagem: "helicoidal", helice: 15 })), "uma à direita");
  erro("cônicas sem os dentes da outra", () => calcularPar(P({ tipoEngrenagem: "conica", dentes: 20, dentesPar: 30, largura: 10 }), P({ tipoEngrenagem: "conica", dentes: 40, dentesPar: 20, largura: 10 })), "Dentes da outra");
  erro("reta com sem-fim não forma par", () => calcularPar(P({}), P({ tipoEngrenagem: "semFim", dentes: 1 })), "não formam par");
  const sug = parceiraSugerida(P({ tipoEngrenagem: "helicoidal", helice: 15 }), 37);
  verdade("parceira sugerida da helicoidal à direita: à esquerda, 37 dentes", sug.sentido === "esquerda" && sug.dentes === 37);
}

// ---------- engrenamento na posição do par (kernel) ----------
// interseção quase nula com a distância calculada; girada meio passo, os dentes batem (grande)
{
  const pares: [string, Partial<ParamEngrenagem>, Partial<ParamEngrenagem>, number][] = [
    ["retas 20/37", { dentes: 20 }, { dentes: 37 }, 0.05],
    ["retas com deslocamento 13 (x 0,3) / 30 (x −0,1)", { dentes: 13, deslocamento: 0.3 }, { dentes: 30, deslocamento: -0.1 }, 0.05],
    ["helicoidais 18/41 β20", { tipoEngrenagem: "helicoidal", dentes: 18, helice: 20 }, { tipoEngrenagem: "helicoidal", dentes: 41, helice: 20, sentido: "esquerda" }, 0.05],
    ["interna 60 com pinhão 21", { tipoEngrenagem: "interna", dentes: 60 }, { dentes: 21 }, 0.05],
    ["pinhão 21 com interna 60 (outra ordem)", { dentes: 21 }, { tipoEngrenagem: "interna", dentes: 60 }, 0.05],
    ["interna helicoidal 54 com pinhão 18 β15", { tipoEngrenagem: "interna", dentes: 54, helice: 15 }, { tipoEngrenagem: "helicoidal", dentes: 18, helice: 15 }, 0.05],
    ["cremalheira e pinhão 17", { tipoEngrenagem: "cremalheira", comprimento: 120 }, { dentes: 17 }, 0.05],
    ["pinhão 17 e cremalheira (outra ordem)", { dentes: 17 }, { tipoEngrenagem: "cremalheira", comprimento: 120 }, 0.05],
    ["cremalheira helicoidal β20 e pinhão", { tipoEngrenagem: "cremalheira", comprimento: 120, helice: 20 }, { tipoEngrenagem: "helicoidal", dentes: 19, helice: 20, sentido: "esquerda" }, 0.05],
    ["cônicas 20/40", { tipoEngrenagem: "conica", dentes: 20, dentesPar: 40, largura: 12 }, { tipoEngrenagem: "conica", dentes: 40, dentesPar: 20, largura: 12 }, 0.5],
    ["cônicas 15/27 a 70°", { tipoEngrenagem: "conica", dentes: 15, dentesPar: 27, largura: 10, anguloEixos: 70 }, { tipoEngrenagem: "conica", dentes: 27, dentesPar: 15, largura: 10, anguloEixos: 70 }, 0.5],
    ["coroa 40 e sem-fim de 2 entradas", { tipoEngrenagem: "coroa", dentes: 40, entradas: 2, largura: 16 }, { tipoEngrenagem: "semFim", dentes: 2, largura: 50 }, 3],
    ["sem-fim e coroa (outra ordem)", { tipoEngrenagem: "semFim", dentes: 1, largura: 50 }, { tipoEngrenagem: "coroa", dentes: 30, entradas: 1, largura: 16 }, 3],
  ];
  for (const [nome, a, b, limite] of pares) {
    const pa = P(a), pb = P(b);
    const sa = solidoEngrenagem(pa);
    const pose = poseDoPar(pa, pb);
    const sb = solidoEngrenagem(pb);
    const dentro = vol(sa.intersect(posar(sb, pose)) as Shape3D);
    // meio passo de defasagem: gira a 2 no próprio eixo (ou desliza a cremalheira/o sem-fim)
    const gb = geometria(pb);
    let sbErrada: Shape3D;
    if (gb.tipo === "cremalheira") sbErrada = sb.translate(gb.pt / 2, 0, 0) as Shape3D;
    else if (gb.tipo === "semFim") sbErrada = sb.translate(0, gb.pz! / 2, 0) as Shape3D;
    else sbErrada = sb.rotate(180 / gb.z, [0, 0, 0], [0, 1, 0]) as Shape3D;
    const errado = vol(sa.intersect(posar(sbErrada, pose)) as Shape3D);
    verdade(`${nome}: engrenado sem interferência (${dentro.toFixed(3)} mm³ ≤ ${limite}) e meio passo fora bate (${errado.toFixed(1)} mm³)`, dentro <= limite && errado > 20 * Math.max(limite, 1));
  }
}

// ---------- peça paramétrica: documento, recurso editável, nome ----------
{
  const d = documentoEngrenagem({ tipoEngrenagem: "reta", modulo: 2, dentes: 20, furo: 12, chaveta: true });
  verdade("documento com um recurso 'engrenagem' (valores no recurso)", d.features.length === 1 && d.features[0].tipo === "engrenagem");
  verdade("nome padronizado", d.nome === "Engrenagem reta m2 z20 b20 furo12 chav", d.nome);
  verdade("propriedades para a lista de materiais", d.propriedades?.grupo === "Engrenagens" && !!d.propriedades?.["Diâmetro primitivo d"]);
  const r1 = regenerar(d.features);
  verdade("regenera no kernel sem erro, um corpo", !r1.erros.length && (r1.corpos?.length ?? 1) === 1, r1.erros[0]?.mensagem ?? "");
  (d.features[0] as unknown as ParamEngrenagem).dentes = 30;
  const r2 = regenerar(d.features);
  const g20 = geometria(P({ dentes: 20 })), g30 = geometria(P({ dentes: 30 }));
  const a20 = Math.abs(areaPoligono(poligonoDoContorno(contornoTransversal(g20), 0.0005))), a30 = Math.abs(areaPoligono(poligonoDoContorno(contornoTransversal(g30), 0.0005)));
  confere("editar o recurso (20 → 30 dentes) muda o sólido na proporção da área", r2.volume! - r1.volume!, (a30 - a20) * 20, 2e-3);
  verdade("engrenagemDaPeca lê os valores do recurso", engrenagemDaPeca(d)?.dentes === 30);
  verdade("nomes diferentes por tipo", new Set((["reta", "helicoidal", "cremalheira", "conica", "semFim", "coroa", "interna"] as const).map((t) => nomeEngrenagem({ tipoEngrenagem: t, helice: 15 }).split(" ")[0] + nomeEngrenagem({ tipoEngrenagem: t, helice: 15 }).split(" ")[1])).size === 7);
}

console.log(falhas ? `\n${falhas} FALHA(S)` : "\nTudo certo.");
if (falhas) process.exit(1);
