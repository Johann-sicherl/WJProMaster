// WJGoldDiamond: versão final da joia em malha (J9b). O OpenCascade faz só as peças (aro já dividido e com
// textura, garras, galeria, fios redondos, contas, trilhos, hastes, assentos, gravação, ocar), cada uma
// virando malha; fios avançados, folhas e esculturas já são malha. A união e os cortes vão no manifold-3d
// (milissegundos, sem sólido quebrado) e, com a concordância ligada, as junções são suavizadas e a
// espessura conferida. Peso, área, vista e STL saem daqui; o STEP continua pelo OpenCascade (geometria.ts).
// Roda no worker e nos testes em Node.

import { makeCylinder, type Shape3D } from "replicad";
import { canaisOcar, pecas, segura } from "./geometria";
import { icosfera, malhasNoMundo, type Malha } from "./escultura";
import { malhasFio } from "./fios";
import { malhaFolha, malhaNoMundo } from "./folhas";
import { concordar, type Origem } from "./concordancia";
import { LIGAS, montar, secao, superficie, type DocJoia, type GrupoTexto, type Montagem, type V3 } from "./regras";

type Wasm = { Manifold: any; Mesh: any };

export interface ResultadoFinal {
  malha: Malha;
  volume: number;
  area: number;
  avisos: string[];
  montagem: Montagem;
  /** tempos (ms) por etapa, para conferir o desempenho */
  tempos: Record<string, number>;
  /** concordância: vértices suavizados e menor espessura conferida (mm) */
  concordancia?: { suavizados: number; conferidos: number; finas: number; /** malha refinada antes de suavizar (testes: o sólido novo contém o antigo) */ antes?: Malha };
}

/** Malha de um sólido do OpenCascade (tolerância da vista). */
export function malhaDe(s: Shape3D, tol = 0.01): Malha {
  const m = s.mesh({ tolerance: tol, angularTolerance: 8 });
  return { pos: new Float32Array(m.vertices), tri: new Uint32Array(m.triangles) };
}

/** Peças em malha (fios avançados, folhas) no mundo, com o raio de concordância de cada uma. */
export function pecasMalha(d: DocJoia, m: Montagem): { malha: Malha; raio?: number; nome: string }[] {
  const out: { malha: Malha; raio?: number; nome: string }[] = [];
  const esfera = icosfera(2);
  for (const f of m.orn.fios) if (f.malha) for (const x of malhasFio(f, esfera)) out.push({ malha: x, raio: f.malha.concordancia, nome: "fio" });
  const locais = new Map<string, Malha>();
  for (const fp of m.folhas) {
    const f = d.folhas.find((x) => x.id === fp.id);
    if (!f) continue;
    let l = locais.get(f.id);
    if (!l) locais.set(f.id, (l = malhaFolha(f)));
    out.push({ malha: malhaNoMundo(l, fp.p, fp.M), raio: fp.concordancia, nome: f.nome });
  }
  return out;
}

/** Prévia: as peças em malha juntas numa malha só (sem união), para somar à prévia do kernel. */
export function previaMalha(d: DocJoia, m: Montagem): Malha {
  return juntar(pecasMalha(d, m).map((x) => x.malha));
}

/** Junta malhas (sem booleana). */
export function juntar(ms: Malha[]): Malha {
  const nv = ms.reduce((s, x) => s + x.pos.length, 0), nt = ms.reduce((s, x) => s + x.tri.length, 0);
  const pos = new Float32Array(nv), tri = new Uint32Array(nt);
  let ov = 0, ot = 0;
  for (const x of ms) {
    pos.set(x.pos, ov);
    for (let i = 0; i < x.tri.length; i++) tri[ot + i] = x.tri[i] + ov / 3;
    ov += x.pos.length;
    ot += x.tri.length;
  }
  return { pos, tri };
}

/**
 * Joia final na malha. `fabricar`: canais de alimentação (a contração é aplicada no STL). Peça do OpenCascade
 * cuja malha não fecha (raro) é unida no próprio OpenCascade ao aro, como antes.
 */
export function construirMalha(w: Wasm, d: DocJoia, grupos: GrupoTexto[] = [], larguraTexto = 0, opcoes: { fabricar?: boolean; concordancia?: boolean } = {}): ResultadoFinal {
  const tempos: Record<string, number> = {};
  let t = performance.now();
  const marca = (k: string) => { const n = performance.now(); tempos[k] = (tempos[k] ?? 0) + n - t; t = n; };
  const m = montar(d);
  const p = pecas(d, grupos, larguraTexto, false, m);
  const avisos = p.avisos;
  const cortesOcc = [...p.cortes, ...canaisOcar(d, m, larguraTexto, avisos)];
  const extras: Shape3D[] = [];
  if (opcoes.fabricar && d.fabricacao.canais > 0) {
    const f = d.fabricacao, tb = secao(d.aro, Math.PI).t;
    for (let k = 0; k < f.canais; k++) {
      const a = ((180 + (k - (f.canais - 1) / 2) * 15) * Math.PI) / 180, dir: V3 = [Math.sin(a), Math.cos(a), 0];
      extras.push(makeCylinder(f.diamCanal / 2, f.compCanal + 0.4, [dir[0] * (m.R + tb - 0.4), dir[1] * (m.R + tb - 0.4), 0], dir));
    }
  }
  marca("pecas (kernel)");
  const raioG = d.concordancia.raio;
  const origens: Origem[] = [];
  const idOrigem = new Map<number, number>();
  const lixo: any[] = [];
  const paraManifold = (x: Malha): any => {
    const mesh = new w.Mesh({ numProp: 3, vertProperties: x.pos, triVerts: x.tri });
    mesh.merge();
    const mf = new w.Manifold(mesh);
    lixo.push(mf);
    if (mf.status && mf.status() !== "NoError" && mf.status() !== 0) throw new Error("malha aberta");
    return mf;
  };
  const registrar = (mf: any, o: Origem) => {
    const orig = mf.asOriginal();
    lixo.push(orig);
    idOrigem.set(orig.originalID(), origens.length);
    origens.push(o);
    return orig;
  };
  try {
    // aro: se alguma peça do kernel não virar malha fechada, ela é unida no aro pelo OpenCascade
    let aro = p.aro;
    const unidas: any[] = [];
    const ruins: Shape3D[] = [];
    for (const x of [...p.partes.map((q) => q.s), ...extras]) {
      try {
        unidas.push(registrar(paraManifold(malhaDe(x)), { corte: false, raio: raioG }));
      } catch {
        ruins.push(x);
      }
    }
    marca("malha das peças");
    if (ruins.length) aro = segura("unir", aro, ruins, avisos, "Peças fora da malha");
    unidas.push(registrar(paraManifold(malhaDe(aro)), { corte: false, raio: raioG }));
    // fios avançados e folhas
    for (const x of pecasMalha(d, m)) {
      try {
        unidas.push(registrar(paraManifold(x.malha), { corte: false, raio: x.raio ?? raioG }));
      } catch {
        avisos.push(`${x.nome}: a malha não fechou e ficou fora da peça.`);
      }
    }
    // esculturas (J8)
    if (d.esculturas.some((e) => e.ativo))
      for (const e of malhasNoMundo(d.esculturas, m.R, (th) => superficie(d.aro, th, 0))) {
        try {
          unidas.push(registrar(paraManifold(e), { corte: false, raio: raioG }));
        } catch {
          avisos.push("Escultura com malha aberta ficou fora da união (peso aproximado).");
        }
      }
    const cortes: any[] = [];
    for (const c of cortesOcc) {
      try {
        cortes.push(registrar(paraManifold(malhaDe(c, 0.005)), { corte: true, raio: 0 }));
      } catch {
        avisos.push("Um assento/corte não virou malha fechada e ficou de fora.");
      }
    }
    marca("malhas em malha fechada");
    const uniao = w.Manifold.union(unidas);
    lixo.push(uniao);
    let res = uniao;
    if (cortes.length) {
      const corte = w.Manifold.union(cortes);
      lixo.push(corte);
      res = uniao.subtract(corte);
      lixo.push(res);
    }
    // lascas soltas (< 0,5 mm³) saem; peça solta maior fica, com aviso
    const partes = res.decompose() as any[];
    lixo.push(...partes);
    if (partes.length > 1) {
      const vols = partes.map((x) => x.volume());
      const ordem = vols.map((v, i) => i).sort((a, b) => vols[b] - vols[a]);
      const ficam = ordem.filter((i, k) => k === 0 || vols[i] >= 0.5);
      if (ficam.length > 1) avisos.push(`${ficam.length - 1} peça(s) de metal solta(s) (${ficam.slice(1).map((i) => vols[i].toFixed(1)).join(", ")} mm³): ligue-as à joia.`);
      res = ficam.length === 1 ? partes[ficam[0]] : w.Manifold.union(ficam.map((i) => partes[i]));
      lixo.push(res);
    }
    marca("união e cortes (malha)");
    const out = res.getMesh();
    const nv = out.numVert, np = out.numProp;
    let malha: Malha = { pos: np === 3 ? Float32Array.from(out.vertProperties) : Float32Array.from({ length: nv * 3 }, (_, i) => out.vertProperties[Math.floor(i / 3) * np + (i % 3)]), tri: Uint32Array.from(out.triVerts) };
    let volume: number = res.volume(), area: number = res.surfaceArea();
    let conc: ResultadoFinal["concordancia"];
    if (opcoes.concordancia ?? d.concordancia.ativo) {
      // origem de cada triângulo pelas corridas (runs) do manifold
      const origem = new Int32Array(malha.tri.length / 3).fill(0);
      const runs: Uint32Array = out.runIndex, ids: Uint32Array = out.runOriginalID;
      const semOrigem = origens.length;
      origens.push({ corte: false, raio: 0 });
      for (let r = 0; r < ids.length; r++) {
        const k = idOrigem.get(ids[r]) ?? semOrigem;
        for (let tt = runs[r] / 3; tt < runs[r + 1] / 3; tt++) origem[tt] = k;
      }
      const c = concordar(malha, origem, origens, { minimo: LIGAS[d.liga].garraMin * 0.95 });
      marca("concordância");
      // confere: malha fechada, volume só um pouco maior e nada de metal perdido (o sólido novo contém o antigo:
      // nenhum ponto fica mais fino do que era)
      try {
        const mf = paraManifold(c.malha);
        const v2 = mf.volume();
        if (v2 >= volume - 1e-6 && v2 <= volume * 1.08 && true) {
          malha = c.malha;
          volume = v2;
          area = mf.surfaceArea();
        } else avisos.push(`Concordância deixada de fora: o volume mudou demais (${volume.toFixed(1)} → ${v2.toFixed(1)} mm³).`);
      } catch {
        avisos.push("Concordância: a malha suavizada não fechou e foi deixada de fora.");
      }
      conc = { suavizados: c.suavizados, conferidos: c.conferidos, finas: c.finas, antes: c.antes };
      if (c.finas) avisos.push(`Concordância: ${c.finas} ponto(s) ficaram abaixo da espessura mínima da liga perto das junções; diminua o raio.`);
      marca("conferência de espessura");
    }
    return { malha, volume, area, avisos: [...new Set(avisos)], montagem: m, tempos, concordancia: conc };
  } finally {
    for (const x of lixo) try { x.delete?.(); } catch { /* já liberado */ }
  }
}
