// Biblioteca de componentes de fixação — DADOS de tabela (mm). Um arquivo só com todas as famílias:
// parafusos, porcas, arruelas, rebites e pinos, normas ISO/DIN métricas M2–M30 (passo grosso e fino).
// Cada família diz de onde vêm as cotas (`conferencia`): "norma" = valores das tabelas da própria norma;
// "aproximada" = forma simplificada ou cotas por proporção (marcadas com ≈ na interface). Puro (sem DOM,
// sem kernel): testado em scripts/teste-biblioteca.ts. Comportamento: docs/funcional/biblioteca.md.

export type Grupo = "Parafusos" | "Porcas" | "Arruelas" | "Rebites" | "Pinos";

/** Modelo geométrico usado pelo gerador (src/biblioteca/gerar.ts). */
export type Forma =
  | "sextavado" | "allen" | "escareado" | "abaulado" | "prisioneiro" | "semCabeca"
  | "porcaSextavada" | "porcaAutotravante" | "porcaCastelo" | "porcaBorboleta"
  | "arruelaLisa" | "arruelaPressao" | "arruelaDentada"
  | "rebiteRepuxo" | "rebiteMacico" | "pinoElastico" | "pinoCilindrico";

/** Cotas de um tamanho (nomes em português; ver cada família). Medidas em mm. */
export type Cotas = Record<string, number>;

export interface Familia {
  id: string;
  grupo: Grupo;
  /** nome na árvore ("Sextavado") */
  tipo: string;
  /** norma que aparece no nome ("ISO 4017") */
  norma: string;
  /** palavra inicial do nome padronizado ("Parafuso", "Porca"…) */
  nome: string;
  forma: Forma;
  /** tem comprimento a escolher (parafuso, rebite, pino) */
  comprimento: boolean;
  /** vale passo fino além do grosso (peças roscadas) */
  roscado: boolean;
  /** chave de MATERIAIS (src/model.ts) */
  material: string;
  conferencia: "norma" | "aproximada";
  /** busca: palavras extras */
  chaves?: string;
  /** tamanhos: rótulo → cotas, na ordem da tabela */
  tamanhos: { tam: string; cotas: Cotas; lmin?: number; lmax?: number }[];
}

/** Comprimentos padronizados (ISO 888 / ISO 4017…): a lista do padrão. */
export const LISTA_COMPRIMENTOS = [2, 3, 4, 5, 6, 8, 10, 12, 14, 16, 18, 20, 22, 25, 28, 30, 32, 35, 38, 40, 45, 50, 55, 60, 65, 70, 75, 80, 90, 100, 110, 120, 130, 140, 150, 160, 180, 200];

/** Passo grosso de cada diâmetro métrico (ISO 261). */
export const PASSO_GROSSO: Record<string, number> = {
  M2: 0.4, "M2,5": 0.45, M3: 0.5, M4: 0.7, M5: 0.8, M6: 1, M8: 1.25, M10: 1.5, M12: 1.75, M14: 2, M16: 2, M18: 2.5, M20: 2.5, M22: 2.5, M24: 3, M27: 3, M30: 3.5,
};
/** Passos finos usuais (ISO 261; o primeiro é o preferido). */
export const PASSOS_FINOS: Record<string, number[]> = {
  M2: [0.25], "M2,5": [0.35], M3: [0.35], M4: [0.5], M5: [0.5], M6: [0.75], M8: [1], M10: [1.25, 1], M12: [1.5, 1.25], M14: [1.5], M16: [1.5],
  M18: [2, 1.5], M20: [2, 1.5], M22: [2, 1.5], M24: [2], M27: [2], M30: [2],
};

/** Os tamanhos usam vírgula decimal ("M2,5", "Ø3,2") — o mesmo texto vai para o nome e para a interface. */
/** Diâmetro nominal: "M6" → 6, "M2,5" → 2.5, "Ø4" → 4. */
export function diametroNominal(tam: string): number {
  return Number(tam.replace(/^[MØ]/, "").replace(",", "."));
}

// ---------------------------------------------------------------------------------------------
// tabelas por tamanho: [tam, ...valores]

const T = (cab: string[], linhas: (string | number)[][], faixa?: Record<string, [number, number]>) =>
  linhas.map((l) => {
    const tam = String(l[0]);
    const cotas: Cotas = {};
    cab.forEach((c, i) => (cotas[c] = Number(l[i + 1])));
    return { tam, cotas, ...(faixa?.[tam] ? { lmin: faixa[tam][0], lmax: faixa[tam][1] } : {}) };
  });

// Faixa de comprimento comercial (lmin–lmax) por tamanho — parafusos sextavados ISO 4017/4014
const FAIXA_SEXT: Record<string, [number, number]> = {
  M2: [4, 20], "M2,5": [5, 25], M3: [5, 30], M4: [6, 40], M5: [8, 50], M6: [10, 60], M8: [16, 80], M10: [20, 100], M12: [25, 120],
  M14: [30, 140], M16: [30, 160], M18: [35, 180], M20: [40, 200], M22: [45, 200], M24: [50, 200], M27: [55, 200], M30: [60, 200],
};
// ISO 4762 (Allen cilíndrico)
const FAIXA_ALLEN: Record<string, [number, number]> = {
  M2: [3, 20], "M2,5": [4, 25], M3: [5, 40], M4: [6, 50], M5: [8, 60], M6: [10, 80], M8: [12, 100], M10: [16, 120], M12: [20, 140],
  M14: [25, 140], M16: [25, 160], M18: [30, 180], M20: [30, 200], M22: [40, 200], M24: [40, 200], M27: [50, 200], M30: [60, 200],
};
const FAIXA_ESCAREADO: Record<string, [number, number]> = {
  M3: [6, 30], M4: [8, 40], M5: [8, 50], M6: [8, 60], M8: [10, 80], M10: [12, 100], M12: [16, 100], M14: [20, 100], M16: [20, 100], M20: [25, 100],
};
const FAIXA_ABAULADO: Record<string, [number, number]> = {
  M3: [6, 30], M4: [8, 40], M5: [8, 50], M6: [10, 60], M8: [12, 60], M10: [16, 60], M12: [20, 60],
};
const FAIXA_PRISIONEIRO: Record<string, [number, number]> = {
  M4: [16, 50], M5: [16, 60], M6: [20, 80], M8: [25, 100], M10: [30, 120], M12: [35, 140], M14: [40, 160], M16: [45, 200], M18: [50, 200],
  M20: [55, 200], M22: [60, 200], M24: [65, 200], M27: [70, 200], M30: [80, 200],
};
const FAIXA_SEMCABECA: Record<string, [number, number]> = {
  M2: [2, 10], "M2,5": [3, 12], M3: [3, 16], M4: [4, 20], M5: [5, 25], M6: [6, 30], M8: [8, 40], M10: [10, 50], M12: [12, 60], M16: [16, 60], M20: [20, 60], M24: [25, 60],
};

// sextavado: s = largura entre faces, k = altura da cabeça (ISO 4017/4014)
const SEXT = T(["s", "k"], [
  ["M2", 4, 1.4], ["M2,5", 5, 1.7], ["M3", 5.5, 2], ["M4", 7, 2.8], ["M5", 8, 3.5], ["M6", 10, 4], ["M8", 13, 5.3], ["M10", 16, 6.4],
  ["M12", 18, 7.5], ["M14", 21, 8.8], ["M16", 24, 10], ["M18", 27, 11.5], ["M20", 30, 12.5], ["M22", 34, 14], ["M24", 36, 15], ["M27", 41, 17], ["M30", 46, 18.7],
], FAIXA_SEXT);

// Allen cilíndrico ISO 4762: dk = Ø da cabeça, k = altura (= d), s = sextavado interno, t = profundidade do sextavado
const ALLEN = T(["dk", "k", "s", "t"], [
  ["M2", 3.8, 2, 1.5, 1], ["M2,5", 4.5, 2.5, 2, 1.1], ["M3", 5.5, 3, 2.5, 1.3], ["M4", 7, 4, 3, 2], ["M5", 8.5, 5, 4, 2.5], ["M6", 10, 6, 5, 3],
  ["M8", 13, 8, 6, 4], ["M10", 16, 10, 8, 5], ["M12", 18, 12, 10, 6], ["M14", 21, 14, 12, 7], ["M16", 24, 16, 14, 8], ["M18", 27, 18, 14, 9],
  ["M20", 30, 20, 17, 10], ["M22", 33, 22, 17, 11], ["M24", 36, 24, 19, 12], ["M27", 40, 27, 19, 13.5], ["M30", 45, 30, 22, 15.5],
], FAIXA_ALLEN);

// escareado Allen ISO 10642 (cone de 90°): dk = Ø teórico da cabeça, k = altura do cone, s = sextavado
const ESCAREADO = T(["dk", "k", "s", "t"], [
  ["M3", 6.72, 1.86, 2, 1.1], ["M4", 8.96, 2.48, 2.5, 1.5], ["M5", 11.2, 3.1, 3, 1.9], ["M6", 13.44, 3.72, 4, 2.2], ["M8", 17.92, 4.96, 5, 3],
  ["M10", 22.4, 6.2, 6, 3.6], ["M12", 26.88, 7.44, 8, 4.3], ["M14", 30.8, 8.4, 10, 4.5], ["M16", 33.6, 8.8, 10, 4.8], ["M20", 40.32, 10.16, 12, 5.6],
], FAIXA_ESCAREADO);

// abaulado ISO 7380-1: dk = Ø da cabeça, k = altura, s = sextavado, t = profundidade
const ABAULADO = T(["dk", "k", "s", "t"], [
  ["M3", 5.7, 1.65, 2, 1], ["M4", 7.6, 2.2, 2.5, 1.3], ["M5", 9.5, 2.75, 3, 1.5], ["M6", 10.5, 3.3, 4, 2], ["M8", 14, 4.4, 5, 2.5],
  ["M10", 17.5, 5.5, 6, 3], ["M12", 21, 6.6, 8, 4],
], FAIXA_ABAULADO);

// prisioneiro (DIN 938, aço 1 × d de rosca no lado do furo roscado): só o corpo roscado
const PRISIONEIRO = T([], [
  ["M4"], ["M5"], ["M6"], ["M8"], ["M10"], ["M12"], ["M14"], ["M16"], ["M18"], ["M20"], ["M22"], ["M24"], ["M27"], ["M30"],
], FAIXA_PRISIONEIRO);

// sem cabeça com sextavado interno, ponta plana (ISO 4026): s = sextavado, t = profundidade
const SEMCABECA = T(["s", "t"], [
  ["M2", 0.9, 0.8], ["M2,5", 1.3, 1.2], ["M3", 1.5, 1.2], ["M4", 2, 1.5], ["M5", 2.5, 2], ["M6", 3, 2.5], ["M8", 4, 3.5], ["M10", 5, 4],
  ["M12", 6, 5], ["M16", 8, 6.5], ["M20", 10, 8], ["M24", 12, 10],
], FAIXA_SEMCABECA);

// porca sextavada ISO 4032: s = entre faces, m = altura
const PORCA = T(["s", "m"], [
  ["M2", 4, 1.6], ["M2,5", 5, 2], ["M3", 5.5, 2.4], ["M4", 7, 3.2], ["M5", 8, 4.7], ["M6", 10, 5.2], ["M8", 13, 6.8], ["M10", 16, 8.4], ["M12", 18, 10.8],
  ["M14", 21, 12.8], ["M16", 24, 14.8], ["M18", 27, 15.8], ["M20", 30, 18], ["M22", 34, 19.4], ["M24", 36, 21.5], ["M27", 41, 23.8], ["M30", 46, 25.6],
]);
// porca autotravante com anel de náilon ISO 7040: s, h = altura total
const AUTOTRAVANTE = T(["s", "m"], [
  ["M3", 5.5, 4], ["M4", 7, 5], ["M5", 8, 5], ["M6", 10, 6], ["M8", 13, 8], ["M10", 16, 10], ["M12", 18, 12], ["M14", 21, 14], ["M16", 24, 16],
  ["M20", 30, 20], ["M24", 36, 24],
]);
// porca castelo DIN 935 (aproximada): s, m = altura total, n = largura da fenda
const CASTELO = T(["s", "m", "n"], [
  ["M5", 8, 6, 2], ["M6", 10, 7.5, 2.8], ["M8", 13, 9.5, 3.2], ["M10", 16, 12, 3.6], ["M12", 18, 15, 4], ["M14", 21, 16, 4.5], ["M16", 24, 19, 5],
  ["M20", 30, 22, 5.5], ["M24", 36, 27, 7],
]);
// porca borboleta DIN 315 (forma simplificada, aproximada): dc = Ø do cubo, hc = altura do cubo, e = envergadura, h = altura total
const BORBOLETA = T(["dc", "hc", "e", "h"], [
  ["M3", 6, 4, 20, 12], ["M4", 8, 5, 25, 15], ["M5", 10, 6, 30, 18], ["M6", 12, 7, 36, 21], ["M8", 16, 9, 46, 28], ["M10", 20, 11, 56, 34], ["M12", 24, 13, 66, 40],
]);

// arruela lisa ISO 7089: d1 = furo, d2 = Ø externo, h = espessura
const ARRUELA = T(["d1", "d2", "h"], [
  ["M2", 2.2, 5, 0.3], ["M2,5", 2.7, 6, 0.5], ["M3", 3.2, 7, 0.5], ["M4", 4.3, 9, 0.8], ["M5", 5.3, 10, 1], ["M6", 6.4, 12, 1.6], ["M8", 8.4, 16, 1.6],
  ["M10", 10.5, 20, 2], ["M12", 13, 24, 2.5], ["M14", 15, 28, 2.5], ["M16", 17, 30, 3], ["M18", 19, 34, 3], ["M20", 21, 37, 3], ["M22", 23, 39, 3],
  ["M24", 25, 44, 4], ["M27", 28, 50, 4], ["M30", 31, 56, 4],
]);
// arruela de pressão DIN 127 B: d1, d2, s = seção (altura livre = 2 s, modelada como anel)
const PRESSAO = T(["d1", "d2", "s"], [
  ["M3", 3.1, 6.2, 0.8], ["M4", 4.1, 7.6, 0.9], ["M5", 5.1, 9.2, 1.2], ["M6", 6.1, 11.8, 1.6], ["M8", 8.2, 14.8, 2], ["M10", 10.2, 18.1, 2.2],
  ["M12", 12.2, 21.1, 2.5], ["M14", 14.2, 24.1, 3], ["M16", 16.2, 27.4, 3.5], ["M20", 20.2, 33.6, 4], ["M24", 24.5, 40, 5],
]);
// arruela dentada DIN 6798 A (anel plano, dentes não modelados): d1, d2, s
const DENTADA = T(["d1", "d2", "s"], [
  ["M3", 3.2, 6, 0.4], ["M4", 4.3, 8, 0.5], ["M5", 5.3, 10, 0.6], ["M6", 6.4, 11, 0.7], ["M8", 8.4, 15, 0.8], ["M10", 10.5, 18, 0.9],
  ["M12", 13, 20.5, 1], ["M14", 15, 24, 1], ["M16", 17, 26, 1.2], ["M20", 21, 33, 1.4],
]);

// rebite de repuxo (cabeça redonda, ISO 15977/15978, aproximado): d = Ø do corpo, dk = Ø da cabeça, k = altura da cabeça, f = furo do corpo
const REPUXO = T(["dk", "k", "f"], [
  ["Ø2,4", 5, 0.6, 1.3], ["Ø3", 6.3, 0.8, 1.6], ["Ø3,2", 6.7, 0.8, 1.7], ["Ø4", 8.4, 1, 2.2], ["Ø4,8", 10, 1.2, 2.6], ["Ø6", 12.6, 1.5, 3.3], ["Ø6,4", 13.4, 1.6, 3.5],
], {
  "Ø2,4": [6, 16], "Ø3": [6, 20], "Ø3,2": [6, 25], "Ø4": [8, 30], "Ø4,8": [8, 30], "Ø6": [12, 40], "Ø6,4": [12, 40],
});
// rebite maciço de cabeça redonda (DIN 660 / ISO 1051): dk = 1,75 d, k = 0,7 d
const MACICO = (() => {
  const ds = [2, 2.5, 3, 4, 5, 6, 8, 10];
  const faixa: Record<string, [number, number]> = {};
  const linhas = ds.map((d) => {
    const tam = `Ø${String(d).replace(".", ",")}`;
    faixa[tam] = [Math.max(3, d * 1.5), Math.min(100, d * 10)];
    return [tam, Math.round(1.75 * d * 100) / 100, Math.round(0.7 * d * 100) / 100];
  });
  return T(["dk", "k"], linhas, faixa);
})();

// pino elástico (ISO 8752, uso pesado): s = espessura da parede
const ELASTICO = T(["s"], [
  ["Ø2", 0.4], ["Ø2,5", 0.5], ["Ø3", 0.6], ["Ø4", 0.8], ["Ø5", 1], ["Ø6", 1.2], ["Ø8", 1.5], ["Ø10", 2], ["Ø12", 2.5], ["Ø14", 3], ["Ø16", 3], ["Ø20", 4],
], {
  "Ø2": [4, 30], "Ø2,5": [4, 30], "Ø3": [4, 40], "Ø4": [4, 50], "Ø5": [5, 60], "Ø6": [6, 80], "Ø8": [8, 100], "Ø10": [10, 100], "Ø12": [12, 120], "Ø14": [14, 120], "Ø16": [16, 120], "Ø20": [20, 120],
});
// pino cilíndrico ISO 2338 (tolerância m6): maciço
const CILINDRICO = T([], [
  ["Ø1"], ["Ø1,5"], ["Ø2"], ["Ø2,5"], ["Ø3"], ["Ø4"], ["Ø5"], ["Ø6"], ["Ø8"], ["Ø10"], ["Ø12"], ["Ø16"], ["Ø20"],
], {
  "Ø1": [3, 10], "Ø1,5": [4, 16], "Ø2": [4, 20], "Ø2,5": [5, 24], "Ø3": [6, 30], "Ø4": [6, 40], "Ø5": [8, 50], "Ø6": [8, 60], "Ø8": [10, 80], "Ø10": [14, 100], "Ø12": [18, 100], "Ø16": [20, 100], "Ø20": [28, 100],
});

const F = (f: Familia): Familia => f;

export const FAMILIAS: Familia[] = [
  F({ id: "iso4017", grupo: "Parafusos", tipo: "Sextavado", norma: "ISO 4017", nome: "Parafuso", forma: "sextavado", comprimento: true, roscado: true, material: "aco-1045", conferencia: "norma", chaves: "cabeça sextavada rosca total din 933", tamanhos: SEXT }),
  F({ id: "iso4762", grupo: "Parafusos", tipo: "Allen cilíndrico", norma: "ISO 4762", nome: "Parafuso", forma: "allen", comprimento: true, roscado: true, material: "aco-1045", conferencia: "norma", chaves: "sextavado interno cabeça cilíndrica din 912 allen", tamanhos: ALLEN }),
  F({ id: "iso10642", grupo: "Parafusos", tipo: "Escareado", norma: "ISO 10642", nome: "Parafuso", forma: "escareado", comprimento: true, roscado: true, material: "aco-1045", conferencia: "norma", chaves: "cabeça escareada sextavado interno din 7991", tamanhos: ESCAREADO }),
  F({ id: "iso7380", grupo: "Parafusos", tipo: "Abaulado", norma: "ISO 7380-1", nome: "Parafuso", forma: "abaulado", comprimento: true, roscado: true, material: "aco-1045", conferencia: "norma", chaves: "cabeça abaulada redonda botão", tamanhos: ABAULADO }),
  F({ id: "din938", grupo: "Parafusos", tipo: "Prisioneiro", norma: "DIN 938", nome: "Prisioneiro", forma: "prisioneiro", comprimento: true, roscado: true, material: "aco-1045", conferencia: "norma", chaves: "espigão rosca dupla", tamanhos: PRISIONEIRO }),
  F({ id: "iso4026", grupo: "Parafusos", tipo: "Sem cabeça", norma: "ISO 4026", nome: "Parafuso sem cabeça", forma: "semCabeca", comprimento: true, roscado: true, material: "aco-1045", conferencia: "norma", chaves: "allen ponta plana pino roscado din 913 de pressão", tamanhos: SEMCABECA }),

  F({ id: "iso4032", grupo: "Porcas", tipo: "Sextavada", norma: "ISO 4032", nome: "Porca", forma: "porcaSextavada", comprimento: false, roscado: true, material: "aco-1045", conferencia: "norma", chaves: "din 934", tamanhos: PORCA }),
  F({ id: "iso7040", grupo: "Porcas", tipo: "Autotravante", norma: "ISO 7040", nome: "Porca autotravante", forma: "porcaAutotravante", comprimento: false, roscado: true, material: "aco-1045", conferencia: "aproximada", chaves: "náilon nylon din 985 trava", tamanhos: AUTOTRAVANTE }),
  F({ id: "din935", grupo: "Porcas", tipo: "Castelo", norma: "DIN 935", nome: "Porca castelo", forma: "porcaCastelo", comprimento: false, roscado: true, material: "aco-1045", conferencia: "aproximada", chaves: "fenda contrapino", tamanhos: CASTELO }),
  F({ id: "din315", grupo: "Porcas", tipo: "Borboleta", norma: "DIN 315", nome: "Porca borboleta", forma: "porcaBorboleta", comprimento: false, roscado: true, material: "aco-1045", conferencia: "aproximada", chaves: "orelha asa", tamanhos: BORBOLETA }),

  F({ id: "iso7089", grupo: "Arruelas", tipo: "Lisa", norma: "ISO 7089", nome: "Arruela lisa", forma: "arruelaLisa", comprimento: false, roscado: false, material: "aco-1045", conferencia: "norma", chaves: "din 125", tamanhos: ARRUELA }),
  F({ id: "din127", grupo: "Arruelas", tipo: "De pressão", norma: "DIN 127 B", nome: "Arruela de pressão", forma: "arruelaPressao", comprimento: false, roscado: false, material: "aco-1045", conferencia: "aproximada", chaves: "mola grower", tamanhos: PRESSAO }),
  F({ id: "din6798", grupo: "Arruelas", tipo: "Dentada", norma: "DIN 6798 A", nome: "Arruela dentada", forma: "arruelaDentada", comprimento: false, roscado: false, material: "aco-1045", conferencia: "aproximada", chaves: "leque estrela", tamanhos: DENTADA }),

  F({ id: "iso15977", grupo: "Rebites", tipo: "De repuxo", norma: "ISO 15977", nome: "Rebite de repuxo", forma: "rebiteRepuxo", comprimento: true, roscado: false, material: "aluminio-5052", conferencia: "aproximada", chaves: "pop cego", tamanhos: REPUXO }),
  F({ id: "iso1051", grupo: "Rebites", tipo: "Maciço", norma: "ISO 1051", nome: "Rebite maciço", forma: "rebiteMacico", comprimento: true, roscado: false, material: "aco-1020", conferencia: "norma", chaves: "cabeça redonda din 660", tamanhos: MACICO }),

  F({ id: "iso8752", grupo: "Pinos", tipo: "Elástico", norma: "ISO 8752", nome: "Pino elástico", forma: "pinoElastico", comprimento: true, roscado: false, material: "aco-1045", conferencia: "aproximada", chaves: "tubular fendido mola", tamanhos: ELASTICO }),
  F({ id: "iso2338", grupo: "Pinos", tipo: "Cilíndrico", norma: "ISO 2338", nome: "Pino cilíndrico", forma: "pinoCilindrico", comprimento: true, roscado: false, material: "aco-1045", conferencia: "norma", chaves: "guia de precisão din 7", tamanhos: CILINDRICO }),
];

export const familiaPorId = (id: string) => FAMILIAS.find((f) => f.id === id);
