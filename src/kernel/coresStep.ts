// Cores de um STEP AP214/AP242 lidas do texto do arquivo. O leitor do OpenCascade disponível no
// navegador não traz o XCAF (cores/nomes), então: cada STYLED_ITEM liga uma cor (COLOUR_RGB ou cor
// pré-definida) a um sólido (MANIFOLD_SOLID_BREP…) ou a uma face (ADVANCED_FACE); o alvo é descrito
// pela caixa dos seus vértices (em mm), que o kernel casa com os sólidos/faces lidos.
// Puro (sem OpenCascade): testado em scripts/teste-importar.ts.

export interface Caixa {
  min: [number, number, number];
  max: [number, number, number];
}

export interface EstiloStep {
  caixa: Caixa;
  /** 0xRRGGBB */
  cor: number;
}

export interface EstilosStep {
  /** mm por unidade de comprimento do arquivo */
  escala: number;
  solidos: EstiloStep[];
  faces: EstiloStep[];
}

const SOLIDOS = new Set(["MANIFOLD_SOLID_BREP", "BREP_WITH_VOIDS", "SHELL_BASED_SURFACE_MODEL", "CLOSED_SHELL", "OPEN_SHELL", "FACETED_BREP"]);
const FACES = new Set(["ADVANCED_FACE", "FACE_SURFACE"]);
/** caminho topológico até os vértices (a geometria — superfícies, curvas — fica de fora) */
const TOPO = new Set([
  ...SOLIDOS, ...FACES, "FACE_BOUND", "FACE_OUTER_BOUND", "EDGE_LOOP", "VERTEX_LOOP", "ORIENTED_EDGE", "EDGE_CURVE", "VERTEX_POINT",
]);
const PREDEFINIDAS: Record<string, number> = {
  red: 0xff0000, green: 0x00ff00, blue: 0x0000ff, yellow: 0xffff00, magenta: 0xff00ff, cyan: 0x00ffff, black: 0x000000, white: 0xffffff,
};

/** mm por unidade de comprimento declarada no arquivo (o OpenCascade lê em mm). */
export function escalaDoStep(texto: string): number {
  const si = /LENGTH_UNIT\s*\(\s*\)[^;]*?SI_UNIT\s*\(\s*(\.[A-Z]+\.|\$)\s*,\s*\.METRE\.\s*\)/.exec(texto)
    ?? /SI_UNIT\s*\(\s*(\.[A-Z]+\.|\$)\s*,\s*\.METRE\.\s*\)[^;]*?LENGTH_UNIT/.exec(texto);
  const conv = /CONVERSION_BASED_UNIT\s*\(\s*'(INCH|FOOT|IN|FT)'/i.exec(texto);
  if (conv && (!si || conv.index < si.index)) return /^(INCH|IN)$/i.test(conv[1]) ? 25.4 : 304.8;
  if (!si) return 1;
  const pre: Record<string, number> = { $: 1000, ".MILLI.": 1, ".CENTI.": 10, ".DECI.": 100, ".MICRO.": 0.001, ".KILO.": 1e6 };
  return pre[si[1]] ?? 1;
}

interface Entidade {
  tipo: string;
  ini: number;
  fim: number;
}

/** Todas as entidades simples: número → tipo e trecho dos argumentos no texto. */
function indexar(texto: string): Map<number, Entidade> {
  const m = new Map<number, Entidade>();
  const d = texto.indexOf("DATA;");
  let i = d < 0 ? 0 : d + 5, comeco = i, aspas = false;
  const re = /^\s*#(\d+)\s*=\s*([A-Z0-9_]*)\s*\(/;
  for (; i < texto.length; i++) {
    const c = texto.charCodeAt(i);
    if (c === 39) aspas = !aspas; // '
    else if (c === 59 && !aspas) { // ;
      const cab = re.exec(texto.slice(comeco, Math.min(i, comeco + 120)));
      if (cab) m.set(+cab[1], { tipo: cab[2] || "(complexa)", ini: comeco + cab[0].length, fim: i });
      comeco = i + 1;
    }
  }
  return m;
}

const refsDe = (texto: string, e: Entidade): number[] => {
  const out: number[] = [];
  const s = texto.slice(e.ini, e.fim);
  const re = /#(\d+)/g;
  for (let k = re.exec(s); k; k = re.exec(s)) out.push(+k[1]);
  return out;
};

/** Primeira cor de superfície alcançada a partir dos estilos (cores de curva ficam de fora). */
function corDosEstilos(texto: string, ent: Map<number, Entidade>, inicio: number[]): number | null {
  const pilha = [...inicio].reverse(), vistos = new Set<number>();
  while (pilha.length) {
    const n = pilha.pop()!;
    if (vistos.has(n)) continue;
    vistos.add(n);
    const e = ent.get(n);
    if (!e || e.tipo === "CURVE_STYLE" || e.tipo === "POINT_STYLE" || e.tipo === "SURFACE_STYLE_TRANSPARENT") continue;
    if (e.tipo === "COLOUR_RGB") {
      const v = texto.slice(e.ini, e.fim).split(",").slice(1).map((x) => parseFloat(x));
      if (v.length >= 3 && v.every((x) => Number.isFinite(x))) {
        const c = v.slice(0, 3).map((x) => Math.round(Math.min(1, Math.max(0, x)) * 255));
        return (c[0] << 16) | (c[1] << 8) | c[2];
      }
      continue;
    }
    if (e.tipo === "DRAUGHTING_PRE_DEFINED_COLOUR") {
      const nome = /'([^']*)'/.exec(texto.slice(e.ini, e.fim))?.[1]?.toLowerCase() ?? "";
      if (nome in PREDEFINIDAS) return PREDEFINIDAS[nome];
      continue;
    }
    const filhos = refsDe(texto, e);
    for (let k = filhos.length - 1; k >= 0; k--) pilha.push(filhos[k]);
  }
  return null;
}

/** Caixa dos vértices alcançados pela topologia a partir do item (null se não tem vértices). */
function caixaDosVertices(texto: string, ent: Map<number, Entidade>, item: number, escala: number, memo: Map<number, Caixa | null>): Caixa | null {
  if (memo.has(item)) return memo.get(item)!;
  const min: [number, number, number] = [Infinity, Infinity, Infinity], max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  const pilha = [item], vistos = new Set<number>();
  let achou = false;
  while (pilha.length) {
    const n = pilha.pop()!;
    if (vistos.has(n)) continue;
    vistos.add(n);
    const e = ent.get(n);
    if (!e) continue;
    if (e.tipo === "VERTEX_POINT") {
      const p = ent.get(refsDe(texto, e)[0]);
      if (p?.tipo !== "CARTESIAN_POINT") continue;
      const lista = /\(([^()]*)\)/.exec(texto.slice(p.ini, p.fim));
      const v = lista ? lista[1].split(",").map((x) => parseFloat(x) * escala) : [];
      if (v.length < 3 || !v.every(Number.isFinite)) continue;
      for (let k = 0; k < 3; k++) {
        if (v[k] < min[k]) min[k] = v[k];
        if (v[k] > max[k]) max[k] = v[k];
      }
      achou = true;
      continue;
    }
    for (const r of refsDe(texto, e)) {
      const t = ent.get(r)?.tipo;
      if (t && TOPO.has(t)) pilha.push(r);
    }
  }
  const c = achou ? { min, max } : null;
  memo.set(item, c);
  return c;
}

/** Cores do STEP por sólido e por face (a face pintada vence a cor do sólido). */
export function estilosDoStep(texto: string): EstilosStep {
  const escala = escalaDoStep(texto);
  const out: EstilosStep = { escala, solidos: [], faces: [] };
  if (!/STYLED_ITEM/.test(texto)) return out;
  const ent = indexar(texto);
  const memo = new Map<number, Caixa | null>();
  // OVER_RIDING_STYLED_ITEM vem depois e vence (é processado por último)
  const itens = [...ent].filter(([, e]) => e.tipo === "STYLED_ITEM" || e.tipo === "OVER_RIDING_STYLED_ITEM")
    .sort((a, b) => (a[1].tipo === b[1].tipo ? a[0] - b[0] : a[1].tipo === "STYLED_ITEM" ? -1 : 1));
  for (const [, e] of itens) {
    // argumentos: 'nome', (estilos), item[, item sobrescrito]
    const s = texto.slice(e.ini, e.fim).replace(/^\s*'(?:[^']|'')*'\s*,/, "");
    const lista = /\(([^()]*)\)/.exec(s);
    if (!lista) continue;
    const estilos = (lista[1].match(/#\d+/g) ?? []).map((x) => +x.slice(1));
    const depois = s.slice(lista.index + lista[0].length);
    const alvo = /#(\d+)/.exec(depois);
    if (!alvo) continue;
    const item = +alvo[1];
    const tipo = ent.get(item)?.tipo ?? "";
    const solido = SOLIDOS.has(tipo), face = FACES.has(tipo);
    if (!solido && !face) continue;
    const cor = corDosEstilos(texto, ent, estilos);
    if (cor === null) continue;
    const caixa = caixaDosVertices(texto, ent, item, escala, memo);
    if (!caixa) continue;
    (solido ? out.solidos : out.faces).push({ caixa, cor });
  }
  return out;
}

/** As duas caixas são a mesma (tolerância relativa ao tamanho). */
export function mesmaCaixa(a: Caixa, b: Caixa, tolRel = 1e-3): boolean {
  const diag = Math.hypot(a.max[0] - a.min[0], a.max[1] - a.min[1], a.max[2] - a.min[2]);
  const tol = Math.max(1e-3, diag * tolRel);
  for (let k = 0; k < 3; k++) if (Math.abs(a.min[k] - b.min[k]) > tol || Math.abs(a.max[k] - b.max[k]) > tol) return false;
  return true;
}

/**
 * Índice para achar depressa a caixa de estilo igual a uma caixa dada (milhares de faces): pelo
 * centro arredondado, olhando também as células vizinhas.
 */
export function indiceDeCaixas(estilos: EstiloStep[], celula = 0.5) {
  const chave = (x: number, y: number, z: number) => `${x},${y},${z}`;
  const grade = new Map<string, number[]>();
  const centro = (c: Caixa) => [0, 1, 2].map((k) => Math.floor((c.min[k] + c.max[k]) / 2 / celula));
  estilos.forEach((e, i) => {
    const [x, y, z] = centro(e.caixa);
    const k = chave(x, y, z);
    (grade.get(k) ?? grade.set(k, []).get(k)!).push(i);
  });
  return (c: Caixa): EstiloStep | null => {
    const [x, y, z] = centro(c);
    let achado = -1; // o último na lista (o que sobrescreve) vence
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++)
      for (const i of grade.get(chave(x + dx, y + dy, z + dz)) ?? []) if (i > achado && mesmaCaixa(estilos[i].caixa, c)) achado = i;
    return achado < 0 ? null : estilos[achado];
  };
}
