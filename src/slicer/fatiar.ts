// WJSlicer3D: orçamento de tempo e material por fatiamento real (código próprio, sem G-code).
// Junta as peças da mesa (cada uma com as suas cópias), fatia cada peça uma vez (caminhos.ts), percorre
// camada por camada todas as cópias na ordem do bico, manda cada movimento ao planejador
// (planejador.ts: acelerações, jerk, vazão, tempo mínimo de camada) e soma o material extrudado.
// Guarda os caminhos de cada camada para a prévia. Puro (sem DOM): roda no worker e em Node.

import {
  alturasCamadas, caixa, calcularSuportes, espacamento, fatiarMalha, gerarCamada, volumeMalha,
  type Ajustes, type Contexto, type MalhaImpressao, type Trecho,
} from "./caminhos";
import { PARTES, Planejador, tempoTrapezio, type Parte } from "./planejador";
import { materialDa, type ConfigTroca, type Maquina, type Material } from "./perfis";
import { corDasCelulas, coresDosPlanos, cortarPorCor, MAX_CORES, type Filamento } from "./cores";

export { ajustesPadrao, espacamento, volumeMalha, caixa, type Ajustes, type MalhaImpressao } from "./caminhos";
export { formatarTempo, NOMES_PARTES, PARTES, tempoTrapezio, velJuncao, type Parte } from "./planejador";

/** Peça na mesa: malha com o centro da caixa em X = Y = 0 e base em Z = 0; uma posição por cópia. */
export interface PecaPlaca {
  nome: string;
  malha: MalhaImpressao;
  posicoes: [number, number][];
  /** cor (0–3) de cada triângulo da malha; sem pintura = tudo na cor 1 */
  cores?: Uint8Array;
}

/** Cores do projeto: os filamentos (cor, material, R$/kg) e o que cada troca custa. */
export interface OpcoesCor {
  filamentos: Filamento[];
  troca: ConfigTroca;
}

/** Material, massa e custo de cada filamento (índice = cor pintada). */
export interface ResultadoCor {
  usada: boolean;
  volumeMm3: number;
  massaG: number;
  comprimentoM: number;
  custo: number;
}

export interface ResultadoTrocas {
  /** trocas de filamento na impressão (a primeira cor não conta) */
  total: number;
  /** camadas com troca e o maior número de trocas numa camada */
  camadas: number;
  maximoPorCamada: number;
  purgaMm3: number;
  /** tempo das trocas (troca do filamento + purga), s */
  tempoS: number;
  torreCamadas: number;
  torreMm3: number;
  torreTempoS: number;
}

export interface Resultado {
  camadas: number;
  /** topo de cada camada (mm) */
  alturas: number[];
  /** caixa ocupada na mesa (X, Y) e altura (mm) */
  dimensoes: [number, number, number];
  /** volume das peças (mm³) pela malha, todas as cópias; null se alguma não for fechada */
  volumePeca: number | null;
  /** filamento gasto */
  volumeMm3: number;
  comprimentoM: number;
  massaG: number;
  custo: number;
  /** tempo de impressão (s), sem o preparo */
  tempoS: number;
  /** preparo típico da máquina (aquecer, nivelar, purgar) */
  preparoS: number;
  partes: Record<Parte, { tempo: number; volume: number }>;
  /** material por cor (sempre 4 entradas); sem pintura, tudo na primeira */
  cores: ResultadoCor[];
  trocas: ResultadoTrocas;
  /** cópias na mesa */
  copias: number;
  avisos: string[];
}

/** Caminhos de extrusão de cada camada: segmentos (x1, y1, x2, y2 …) e a parte de cada um. */
export interface Previa {
  seg: Float32Array[];
  parte: Uint8Array[];
}

const DIAMETRO_FILAMENTO = 1.75;

class Buf {
  f = new Float32Array(4096);
  p = new Uint8Array(1024);
  n = 0;
  add(x1: number, y1: number, x2: number, y2: number, parte: number) {
    if (this.n * 4 + 4 > this.f.length) {
      const nf = new Float32Array(this.f.length * 2);
      nf.set(this.f);
      this.f = nf;
    }
    if (this.n + 1 > this.p.length) {
      const np = new Uint8Array(this.p.length * 2);
      np.set(this.p);
      this.p = np;
    }
    this.f.set([x1, y1, x2, y2], this.n * 4);
    this.p[this.n++] = parte;
  }
}

/** Fecho convexo (cadeia monótona), anti-horário. */
function fecho(pts: number[]): number[] {
  const p: [number, number][] = [];
  for (let k = 0; k < pts.length; k += 2) p.push([pts[k], pts[k + 1]]);
  p.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p.flat();
  const cr = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const baixo: [number, number][] = [], cima: [number, number][] = [];
  for (const q of p) {
    while (baixo.length >= 2 && cr(baixo[baixo.length - 2], baixo[baixo.length - 1], q) <= 0) baixo.pop();
    baixo.push(q);
  }
  for (let k = p.length - 1; k >= 0; k--) {
    const q = p[k];
    while (cima.length >= 2 && cr(cima[cima.length - 2], cima[cima.length - 1], q) <= 0) cima.pop();
    cima.push(q);
  }
  return [...baixo.slice(0, -1), ...cima.slice(0, -1)].flat();
}

/** Contorno do fecho afastado `d` mm (cantos arredondados): a saia. */
function afastar(h: number[], d: number): Float64Array {
  const n = h.length / 2;
  const out: number[] = [];
  for (let k = 0; k < n; k++) {
    const a = k, b = (k + 1) % n, c = (k + 2) % n;
    const ex = h[b * 2] - h[a * 2], ey = h[b * 2 + 1] - h[a * 2 + 1], L = Math.hypot(ex, ey) || 1;
    const fx = h[c * 2] - h[b * 2], fy = h[c * 2 + 1] - h[b * 2 + 1], M = Math.hypot(fx, fy) || 1;
    const a0 = Math.atan2(-ex / L, ey / L), a1 = Math.atan2(-fx / M, fy / M);
    let da = a1 - a0;
    while (da < 0) da += 2 * Math.PI;
    const passos = Math.max(1, Math.ceil(da / (Math.PI / 12)));
    for (let s = 0; s <= passos; s++) {
      const t = a0 + (da * s) / passos;
      out.push(h[b * 2] + d * Math.cos(t), h[b * 2 + 1] + d * Math.sin(t));
    }
  }
  return Float64Array.from(out);
}

/**
 * Fatia a mesa inteira e devolve o orçamento e a prévia. `progresso` recebe de 0 a 1.
 */
export function fatiarPlaca(pecas: PecaPlaca[], maq: Maquina, mat: Material, aj: Ajustes, progresso?: (f: number) => void, opc?: OpcoesCor): { r: Resultado; previa: Previa } {
  const pr = maq.processo;
  const avisos: string[] = [];
  const ativas = pecas.filter((p) => p.posicoes.length && p.malha.tri.length);
  if (!ativas.length) throw new Error("Não há peça na mesa.");
  let H = 0;
  const caixas = ativas.map((p) => caixa(p.malha.pos));
  for (const c of caixas) H = Math.max(H, c.max[2]);
  if (H <= 0) throw new Error("A peça não tem altura (malha plana).");
  const zs = alturasCamadas(H, pr.alturaPrimeira, aj.altura);
  const n = zs.length;

  // avisos de mesa
  let mx0 = Infinity, my0 = Infinity, mx1 = -Infinity, my1 = -Infinity, copias = 0;
  let volumePeca: number | null = 0;
  ativas.forEach((p, k) => {
    const c = caixas[k];
    const dx = c.max[0] - c.min[0], dy = c.max[1] - c.min[1];
    if (dx > maq.mesa[0] + 1e-6 || dy > maq.mesa[1] + 1e-6) avisos.push(`${p.nome} (${dx.toFixed(0)} × ${dy.toFixed(0)} mm) não cabe na mesa de ${maq.mesa[0]} × ${maq.mesa[1]} mm.`);
    else
      for (const [x, y] of p.posicoes)
        if (x + c.min[0] < -maq.mesa[0] / 2 - 1e-6 || x + c.max[0] > maq.mesa[0] / 2 + 1e-6 || y + c.min[1] < -maq.mesa[1] / 2 - 1e-6 || y + c.max[1] > maq.mesa[1] / 2 + 1e-6) {
          avisos.push(`${p.nome} passa da borda da mesa: toque em Organizar.`);
          break;
        }
    for (const [x, y] of p.posicoes) {
      mx0 = Math.min(mx0, x + c.min[0]);
      my0 = Math.min(my0, y + c.min[1]);
      mx1 = Math.max(mx1, x + c.max[0]);
      my1 = Math.max(my1, y + c.max[1]);
    }
    copias += p.posicoes.length;
    const v = volumeMalha(p.malha);
    if (v === null) {
      volumePeca = null;
      avisos.push(`A malha de ${p.nome} tem aberturas (não é fechada): a estimativa pode ficar imprecisa.`);
    } else if (volumePeca !== null) volumePeca += v * p.posicoes.length;
  });
  if (H > maq.alturaMax + 1e-6) avisos.push(`A peça mais alta tem ${H.toFixed(0)} mm; a máquina imprime até ${maq.alturaMax} mm.`);

  // fatiamento e suporte de cada peça (uma vez, mesmo com várias cópias)
  const fracFatia = 0.3 / ativas.length;
  const ctxs: Contexto[] = ativas.map((p, k) => {
    const margem = 1 + (aj.borda ? pr.bordaFolga + pr.bordaLargura + 1 : 0);
    const pintada = !!p.cores && p.cores.length === p.malha.tri.length / 3 && p.cores.some((c) => c > 0);
    const f = fatiarMalha(p.malha, zs, margem, (x) => progresso?.(k * fracFatia + x * fracFatia * 0.7), pintada ? p.cores : undefined, [Math.max(aj.topo * aj.altura, pr.topoMm), Math.max(aj.fundo * aj.altura, pr.fundoMm)]);
    const sup = aj.suporte !== "nenhum" ? calcularSuportes(f, pr, aj.suporte, aj.altura, (x) => progresso?.(k * fracFatia + fracFatia * (0.7 + 0.3 * x))) : null;
    return { f, maq, aj, zs, vazaoMax: mat.vazaoMax, sup, campoAbaixo: null };
  });

  // ---------- percurso camada a camada ----------
  const plan = new Planejador({ aMax: maq.aMax, vMax: maq.vMax, jerk: maq.jerk, aceleraDesacelera: maq.aceleraDesacelera });
  plan.posicionar(-maq.mesa[0] / 2, -maq.mesa[1] / 2);
  const IDX = Object.fromEntries(PARTES.map((p, k) => [p, k])) as Record<Parte, number>;
  const tz = (d: number) => tempoTrapezio(d, 0, 0, maq.vZ, maq.aZ);
  const previa: Previa = { seg: [], parte: [] };
  let retraido = false;
  let ultimoPreench = false;

  // ---- cores: filamentos, trocas (uma por mudança de cor na camada, como o sistema de 4 filamentos) ----
  const troca = opc?.troca ?? maq.troca;
  const filamentos: Filamento[] = opc?.filamentos?.length ? opc.filamentos : [{ id: "f1", nome: "", cor: "#ffffff", material: mat.id, precoKg: mat.precoKg }];
  const densidade = (c: number) => (c === 0 ? mat.densidade : materialDa(maq, filamentos[c]?.material ?? mat.id).densidade);
  const preco = (c: number) => (c === 0 ? mat.precoKg : filamentos[c]?.precoKg ?? mat.precoKg);
  const volCor = new Float64Array(MAX_CORES);
  const usadaCor = new Uint8Array(MAX_CORES);
  const painel = { total: 0, camadas: 0, maximo: 0, ultima: -1 };
  let ferramenta = -1;
  const tPurga = troca.purgaMm3 / Math.max(0.1, troca.vazaoPurga);
  /** peças pintadas: cores das sementes de cada camada */
  const coresDaCamada = (j: number): Set<number> => {
    const r = new Set<number>();
    for (const c of ctxs) {
      if (!c.f.corSeg) r.add(0);
      else if (j < c.f.n) {
        for (const v of c.f.corSeg[j]) r.add(v);
        for (const v of coresDosPlanos(c.f.corPlano?.[j])) r.add(v);
      }
    }
    return r;
  };
  const livre = (parte: Parte) => parte === "suporte" || parte === "interface" || parte === "borda";
  const passoCor = (c: Contexto) => Math.max(c.f.g.c, 0.4);
  /** trechos da camada com a cor de cada um (-1 = livre: usa a ferramenta que estiver no bico) */
  const colorir = (c: Contexto, i: number, trechos: Trecho[]): { t: Trecho; cor: number }[] => {
    const seg = c.f.corSeg?.[i];
    const sementes = new Set<number>(seg ?? []);
    for (const v of coresDosPlanos(c.f.corPlano?.[i])) sementes.add(v);
    const unica = sementes.size <= 1 ? (sementes.size ? [...sementes][0] : 0) : -2;
    if (unica !== -2) return trechos.map((t) => ({ t, cor: livre(t.parte) ? -1 : unica }));
    const mapa = corDasCelulas(c.f.g, c.f.segs[i], seg!, c.f.corPlano?.[i], aj.paredes * pr.lParedeInt + 0.3);
    const saida: { t: Trecho; cor: number }[] = [];
    for (const t of trechos) {
      if (livre(t.parte)) saida.push({ t, cor: -1 });
      else for (const x of cortarPorCor(t, c.f.g, mapa, 0, passoCor(c))) saida.push(x);
    }
    return saida;
  };

  for (let i = 0; i < n; i++) {
    const h = i === 0 ? zs[0] : zs[i] - zs[i - 1];
    const prim = i === 0;
    const aD = prim ? pr.aDeslocPrimeira : pr.aDeslocamento, vD = pr.vDeslocamento, jD = pr.jDeslocamento > 0 ? pr.jDeslocamento : pr.jPadrao;
    const levanta = maq.zHop > 0 && zs[i] > maq.zHopAcima ? tz(maq.zHop) : 0;
    const tLimpeza = maq.limpeza > 0 ? tempoTrapezio(maq.limpeza, 0, 0, maq.vLimpeza * vD, aD) : 0;
    const tRetrai = Math.max(maq.retracao / maq.vRetracao, tLimpeza) + levanta;
    const tVolta = maq.retracao / maq.vRecuperacao + levanta;
    if (i > 0) {
      // troca de camada: retrai, sobe o Z (a volta da retração vem no primeiro deslocamento)
      plan.parar(tRetrai + tz(h));
      retraido = true;
    }
    const buf = new Buf();
    const viajar = (x: number, y: number, semRetrair: boolean) => {
      const L = Math.hypot(x - plan.x, y - plan.y);
      if (L < 1e-3) {
        if (retraido) {
          plan.parar(tVolta);
          retraido = false;
        }
        return;
      }
      const retrai = !retraido && L > maq.retracaoMin && !semRetrair;
      if (retrai) plan.parar(tRetrai);
      plan.mover(x, y, vD, aD, jD, "deslocamento", 0);
      if (retrai || retraido) plan.parar(tVolta);
      retraido = false;
    };
    const emitir = (t: Trecho, ox: number, oy: number, gc: number) => {
      const p = t.pts, np = p.length / 2;
      let ini = 0;
      if (t.fechado) {
        let dmin = Infinity;
        for (let k = 0; k < np; k++) {
          const d = (p[k * 2] + ox - plan.x) ** 2 + (p[k * 2 + 1] + oy - plan.y) ** 2;
          if (d < dmin) {
            dmin = d;
            ini = k;
          }
        }
      }
      viajar(p[ini * 2] + ox, p[ini * 2 + 1] + oy, !!t.semRetrair && ultimoPreench);
      ultimoPreench = !!t.semRetrair;
      const sec = espacamento(t.w, h) * h * t.fluxo * mat.fluxo;
      const passos = t.fechado ? np : np - 1;
      const pi = IDX[t.parte];
      for (let s = 0; s < passos; s++) {
        const k = (ini + s + 1) % np;
        const x = p[k * 2] + ox, y = p[k * 2 + 1] + oy;
        const x0 = plan.x, y0 = plan.y;
        const L = Math.hypot(x - x0, y - y0);
        const v = t.vSeg ? Math.min(t.v, t.vSeg[(ini + s) % np]) : t.v;
        plan.mover(x, y, v, t.a, t.j, t.parte, L * sec);
        volCor[gc] += L * sec;
        buf.add(x0, y0, x, y, pi);
      }
    };

    // camadas de cada peça (uma vez) e as cópias em ordem de proximidade
    const camadas = ctxs.map((c) => (i < c.f.n ? gerarCamada(c, i) : null));
    const todas: [number, number, number][] = [];
    ativas.forEach((p, k) => {
      if (camadas[k]?.trechos.length) for (const [x, y] of p.posicoes) todas.push([k, x, y]);
    });
    // cor de cada trecho (peça pintada: o caminho é cortado onde a cor muda)
    const itens = camadas.map((cam, k) => (cam ? colorir(ctxs[k], i, cam.trechos) : []));

    // ordem das cores da camada: começa pela ferramenta que já está no bico e termina numa cor da
    // camada de cima (o mínimo de trocas: uma por cor além da primeira)
    const usadas = new Set<number>();
    for (const l of itens) for (const x of l) if (x.cor >= 0) usadas.add(x.cor);
    if (!usadas.size) usadas.add(ferramenta >= 0 ? ferramenta : 0);
    const proximas = i + 1 < n ? coresDaCamada(i + 1) : new Set<number>();
    const grupos = [...usadas].sort((a, b) => a - b);
    if (grupos.length > 1) {
      const comeco = usadas.has(ferramenta) ? ferramenta : (grupos.find((c) => !proximas.has(c)) ?? grupos[0]);
      const resto = grupos.filter((c) => c !== comeco);
      resto.sort((a, b) => Number(proximas.has(a)) - Number(proximas.has(b)) || a - b);
      grupos.length = 0;
      grupos.push(comeco, ...resto);
    }
    let trocasDaCamada = 0;

    for (let gi = 0; gi < grupos.length; gi++) {
      const cor = grupos[gi];
      if (ferramenta < 0) ferramenta = cor;
      else if (ferramenta !== cor) {
        // troca de filamento: recolhe, carrega o novo e purga (a purga é do filamento que entra)
        plan.parar(troca.tempoS + tPurga, "troca");
        plan.volume[IDX.troca] += troca.purgaMm3;
        volCor[cor] += troca.purgaMm3;
        retraido = true;
        ferramenta = cor;
        trocasDaCamada++;
      }
      usadaCor[cor] = 1;
      const deste = (x: { cor: number }) => x.cor === cor || (gi === 0 && x.cor < 0);
      const fila: [number, number, number][] = todas.filter(([k]) => itens[k].some(deste));

      // saia: uma volta em volta de tudo na primeira camada (com a primeira cor)
      if (prim && gi === 0 && aj.saia && todas.length) {
        const pts: number[] = [];
        for (const [k, x, y] of todas)
          for (const t of camadas[k]!.trechos)
            if (t.parte === "paredeExt" || t.parte === "borda") for (let a = 0; a < t.pts.length; a += 2) pts.push(t.pts[a] + x, t.pts[a + 1] + y);
        const hh = fecho(pts);
        if (hh.length >= 6) {
          const sE = espacamento(pr.lPrimeira, h);
          emitir({ pts: afastar(hh, pr.saiaDistancia + sE / 2), fechado: true, parte: "borda", w: pr.lPrimeira, fluxo: 1, v: pr.vSaia, a: pr.aPrimeira, j: pr.jPrimeira > 0 ? pr.jPrimeira : pr.jPadrao }, 0, 0, cor);
        }
      }
      while (fila.length) {
        let melhor = 0, dmin = Infinity;
        for (let a = 0; a < fila.length; a++) {
          const [k, x, y] = fila[a];
          // sem pintura (um grupo só): o ponto de partida da peça; com cores, o do primeiro trecho da cor
          const [sx, sy] = grupos.length === 1 && itens[k].length === camadas[k]!.trechos.length ? camadas[k]!.inicio : (() => {
            const t = itens[k].find(deste)!.t;
            return [t.pts[0], t.pts[1]] as [number, number];
          })();
          const d = (sx + x - plan.x) ** 2 + (sy + y - plan.y) ** 2;
          if (d < dmin) {
            dmin = d;
            melhor = a;
          }
        }
        const [k, x, y] = fila.splice(melhor, 1)[0];
        ultimoPreench = false;
        for (const it of itens[k]) if (deste(it)) emitir(it.t, x, y, cor);
      }
    }
    if (trocasDaCamada) {
      painel.total += trocasDaCamada;
      painel.camadas++;
      painel.maximo = Math.max(painel.maximo, trocasDaCamada);
      painel.ultima = i;
    }
    plan.fecharCamada(mat.tempoCamada, mat.vMinResfriar);
    previa.seg.push(buf.f.slice(0, buf.n * 4));
    previa.parte.push(buf.p.slice(0, buf.n));
    if (progresso && (i % 4 === 0 || i === n - 1)) progresso(0.3 + (0.7 * (i + 1)) / n);
  }

  // ---- torre de purga: anel de estabilização em todas as camadas até a última troca (a purga cai dentro dela) ----
  let torreMm3 = 0, torreTempoS = 0, torreCamadas = 0;
  if (troca.torre && painel.total > 0) {
    torreCamadas = painel.ultima + 1;
    const L = troca.larguraTorre;
    for (let i = 0; i < torreCamadas; i++) {
      const h = i === 0 ? zs[0] : zs[i] - zs[i - 1];
      const w = i === 0 ? pr.lPrimeira : pr.lParedeExt, s = espacamento(w, h);
      const comprimento = 4 * Math.max(0, L - s) * (i === 0 ? 2 : 1);
      torreMm3 += comprimento * s * h * mat.fluxo;
      torreTempoS += comprimento / (0.7 * (i === 0 ? pr.vPrimeira : pr.vParedeExt)) + 1;
    }
    plan.volume[PARTES.indexOf("torre")] += torreMm3;
    plan.tempo[PARTES.indexOf("torre")] += torreTempoS;
    const quais = [...usadaCor.keys()].filter((c) => usadaCor[c]);
    for (const c of quais) volCor[c] += torreMm3 / quais.length;
    const margemTorre = 6;
    if ((mx1 - mx0) + L + margemTorre > maq.mesa[0] && (my1 - my0) + L + margemTorre > maq.mesa[1]) avisos.push(`A torre de purga (${L} × ${L} mm) não cabe ao lado das peças na mesa: reduza a torre ou tire uma peça.`);
  }

  const partes = Object.fromEntries(PARTES.map((p, k) => [p, { tempo: plan.tempo[k], volume: plan.volume[k] }])) as Resultado["partes"];
  const volumeMm3 = PARTES.reduce((s, p) => s + partes[p].volume, 0);
  const tempoS = PARTES.reduce((s, p) => s + partes[p].tempo, 0);
  const secao = Math.PI * (DIAMETRO_FILAMENTO / 2) ** 2;
  const porCor: ResultadoCor[] = Array.from({ length: MAX_CORES }, (_, c) => {
    const massa = (volCor[c] / 1000) * densidade(c);
    return { usada: !!usadaCor[c], volumeMm3: volCor[c], massaG: massa, comprimentoM: volCor[c] / secao / 1000, custo: (massa / 1000) * preco(c) };
  });
  const massaG = porCor.reduce((s, x) => s + x.massaG, 0);
  const custo = porCor.reduce((s, x) => s + x.custo, 0);
  progresso?.(1);
  return {
    r: {
      camadas: n, alturas: zs, dimensoes: [mx1 - mx0, my1 - my0, H], volumePeca, volumeMm3, comprimentoM: volumeMm3 / secao / 1000, massaG,
      custo, tempoS, preparoS: maq.preparoMin * 60, partes, copias, avisos, cores: porCor,
      trocas: {
        total: painel.total, camadas: painel.camadas, maximoPorCamada: painel.maximo, purgaMm3: painel.total * troca.purgaMm3,
        tempoS: partes.troca.tempo, torreCamadas, torreMm3, torreTempoS,
      },
    },
    previa,
  };
}

/** Uma peça só, na posição em que está (testes e chamadas simples). */
export function estimar(m: MalhaImpressao, maq: Maquina, mat: Material, aj: Ajustes, progresso?: (f: number) => void): Resultado {
  return fatiarPlaca([{ nome: "A peça", malha: m, posicoes: [[0, 0]] }], maq, mat, aj, progresso).r;
}

