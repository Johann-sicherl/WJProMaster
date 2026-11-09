// WJSlicer3D: perfis de impressora e de material para a estimativa de tempo e material.
// Valores tirados dos perfis de fábrica abertos (JSON) do fatiador de referência para bico de
// 0,4 mm e processo "0,20 mm padrão" (velocidades, acelerações, larguras de linha, cascas,
// limites da máquina) e dos perfis de filamento (densidade, vazão volumétrica máxima e tempo
// mínimo de camada). Só dados técnicos de compatibilidade: nenhum texto ou código copiado.
// Puro: testado em scripts/teste-slicer.ts.

export interface Processo {
  /** altura de camada e da primeira camada (mm) */
  altura: number;
  alturaPrimeira: number;
  paredes: number;
  topo: number;
  fundo: number;
  /** espessura mínima das cascas (mm): vale o maior entre camadas × altura e este valor */
  topoMm: number;
  fundoMm: number;
  /** preenchimento esparso (0–1) */
  preenchimento: number;
  /** larguras de linha (mm) */
  lParedeExt: number;
  lParedeInt: number;
  lEsparso: number;
  lSolido: number;
  lPrimeira: number;
  /** velocidades (mm/s) */
  vParedeExt: number;
  vParedeInt: number;
  vEsparso: number;
  vSolido: number;
  vTopo: number;
  vPrimeira: number;
  vPrimeiraPreench: number;
  vSuporte: number;
  vDeslocamento: number;
  /** acelerações (mm/s²) */
  aPadrao: number;
  aParedeExt: number;
  aParedeInt: number;
  aTopo: number;
  aEsparso: number;
  aPrimeira: number;
  aDeslocamento: number;
  /** ângulo-limite do suporte (graus a partir da horizontal) */
  anguloSuporte: number;
  /**
   * parede externa em balanço: velocidade por faixa do quanto a linha sai da camada de baixo
   * (até 25%, 50%, 75% e 100% da largura; 0 = sem desacelerar) e velocidade de ponte (mm/s)
   */
  vBalanco: [number, number, number, number];
  vPonte: number;
}

export interface Maquina {
  id: string;
  marca: "Bambu Lab" | "Anycubic";
  modelo: string;
  /** mesa (mm) e altura útil */
  mesa: [number, number];
  alturaMax: number;
  /** limites do firmware */
  aMax: number;
  vMax: number;
  /** velocidade de canto (mm/s): variação instantânea de velocidade permitida */
  jerk: number;
  /** firmware Klipper: pseudoaceleração "acelerar até desacelerar" de 50% nas linhas curtas */
  klipper: boolean;
  /** velocidade máxima do eixo Z (mm/s): levantamento e troca de camada */
  vZ: number;
  /** retração (mm, mm/s) e levantamento do eixo Z (mm) */
  retracao: number;
  vRetracao: number;
  zHop: number;
  /** preparo típico (aquecer mesa e bico, nivelar, linha de purga), minutos */
  preparoMin: number;
  processo: Processo;
  /** materiais que a máquina oferece (ids de MATERIAIS) e ajustes do perfil desta máquina */
  materiais: Partial<Record<IdMaterial, Partial<Material>>>;
}

export type IdMaterial = "pla" | "plaRapido" | "petg" | "abs" | "asa" | "tpu";

export interface Material {
  id: IdMaterial;
  nome: string;
  /** g/cm³ */
  densidade: number;
  /** vazão volumétrica máxima do bico (mm³/s) */
  vazaoMax: number;
  /** tempo mínimo de camada (s) e velocidade mínima ao desacelerar para resfriar (mm/s) */
  tempoCamada: number;
  vMinResfriar: number;
  /** preço padrão sugerido (R$/kg), editável na tela */
  precoKg: number;
}

/** Valores de base de cada material (os perfis das máquinas ajustam o que muda). */
export const MATERIAIS: Record<IdMaterial, Material> = {
  pla: { id: "pla", nome: "PLA", densidade: 1.24, vazaoMax: 12, tempoCamada: 8, vMinResfriar: 20, precoKg: 120 },
  plaRapido: { id: "plaRapido", nome: "PLA alta velocidade", densidade: 1.24, vazaoMax: 18, tempoCamada: 7, vMinResfriar: 20, precoKg: 130 },
  petg: { id: "petg", nome: "PETG", densidade: 1.27, vazaoMax: 8, tempoCamada: 12, vMinResfriar: 20, precoKg: 130 },
  abs: { id: "abs", nome: "ABS", densidade: 1.04, vazaoMax: 15, tempoCamada: 3, vMinResfriar: 20, precoKg: 120 },
  asa: { id: "asa", nome: "ASA", densidade: 1.05, vazaoMax: 12, tempoCamada: 3, vMinResfriar: 20, precoKg: 150 },
  tpu: { id: "tpu", nome: "TPU (flexível)", densidade: 1.22, vazaoMax: 3.2, tempoCamada: 8, vMinResfriar: 10, precoKg: 200 },
};

/** Processo 0,20 mm padrão das máquinas Bambu Lab (iguais em X1 Carbon, P1S, A1 e A1 mini, salvo acelerações). */
const BAMBU: Processo = {
  altura: 0.2, alturaPrimeira: 0.2, paredes: 3, topo: 5, fundo: 3, topoMm: 1, fundoMm: 0, preenchimento: 0.15,
  lParedeExt: 0.4, lParedeInt: 0.45, lEsparso: 0.45, lSolido: 0.4, lPrimeira: 0.5,
  vParedeExt: 200, vParedeInt: 300, vEsparso: 270, vSolido: 250, vTopo: 200, vPrimeira: 50, vPrimeiraPreench: 105, vSuporte: 150, vDeslocamento: 500,
  aPadrao: 10000, aParedeExt: 5000, aParedeInt: 10000, aTopo: 2000, aEsparso: 10000, aPrimeira: 500, aDeslocamento: 10000,
  anguloSuporte: 30, vBalanco: [0, 50, 30, 10], vPonte: 50,
};
const BAMBU_A1: Processo = { ...BAMBU, vDeslocamento: 700, aPadrao: 6000, aParedeInt: 6000, aEsparso: 6000, aDeslocamento: 6000 };

/** Base dos processos Anycubic (cada máquina muda velocidades e acelerações). */
const ANYCUBIC: Processo = {
  altura: 0.2, alturaPrimeira: 0.2, paredes: 2, topo: 5, fundo: 3, topoMm: 1, fundoMm: 0, preenchimento: 0.15,
  lParedeExt: 0.42, lParedeInt: 0.45, lEsparso: 0.45, lSolido: 0.42, lPrimeira: 0.5,
  vParedeExt: 130, vParedeInt: 200, vEsparso: 300, vSolido: 130, vTopo: 130, vPrimeira: 45, vPrimeiraPreench: 45, vSuporte: 100, vDeslocamento: 350,
  aPadrao: 10000, aParedeExt: 5000, aParedeInt: 6000, aTopo: 2000, aEsparso: 5000, aPrimeira: 500, aDeslocamento: 10000,
  anguloSuporte: 30, vBalanco: [0, 50, 30, 10], vPonte: 30,
};

const PLA_BAMBU_X = { densidade: 1.26, vazaoMax: 21, tempoCamada: 4, vMinResfriar: 20 };
const PLA_BAMBU_A = { densidade: 1.26, vazaoMax: 21, tempoCamada: 6, vMinResfriar: 10 };
const MAT_BAMBU_X: Maquina["materiais"] = {
  pla: PLA_BAMBU_X, petg: { densidade: 1.28, vazaoMax: 21, tempoCamada: 10, vMinResfriar: 20 },
  abs: { vazaoMax: 16, tempoCamada: 12 }, asa: { vazaoMax: 18, tempoCamada: 12 }, tpu: { vazaoMax: 3.6, tempoCamada: 8, vMinResfriar: 10 },
};
const MAT_BAMBU_A: Maquina["materiais"] = {
  pla: PLA_BAMBU_A, petg: { densidade: 1.28, vazaoMax: 18, tempoCamada: 7, vMinResfriar: 10 },
  abs: { vazaoMax: 16, tempoCamada: 12, vMinResfriar: 10 }, asa: { vazaoMax: 18, tempoCamada: 12, vMinResfriar: 10 }, tpu: { vazaoMax: 3.6, tempoCamada: 8, vMinResfriar: 10 },
};

export const MAQUINAS: Maquina[] = [
  {
    id: "bbl-x1c", marca: "Bambu Lab", modelo: "X1 Carbon", mesa: [256, 256], alturaMax: 250, aMax: 20000, vMax: 500, jerk: 9, klipper: false, vZ: 20,
    retracao: 0.8, vRetracao: 30, zHop: 0.4, preparoMin: 6, processo: BAMBU, materiais: MAT_BAMBU_X,
  },
  {
    id: "bbl-p1s", marca: "Bambu Lab", modelo: "P1S", mesa: [256, 256], alturaMax: 250, aMax: 20000, vMax: 500, jerk: 9, klipper: false, vZ: 20,
    retracao: 0.8, vRetracao: 30, zHop: 0.4, preparoMin: 5, processo: BAMBU, materiais: MAT_BAMBU_X,
  },
  {
    id: "bbl-a1", marca: "Bambu Lab", modelo: "A1", mesa: [256, 256], alturaMax: 256, aMax: 12000, vMax: 500, jerk: 9, klipper: false, vZ: 30,
    retracao: 0.8, vRetracao: 30, zHop: 0.4, preparoMin: 5, processo: BAMBU_A1, materiais: MAT_BAMBU_A,
  },
  {
    id: "bbl-a1m", marca: "Bambu Lab", modelo: "A1 mini", mesa: [180, 180], alturaMax: 180, aMax: 20000, vMax: 500, jerk: 9, klipper: false, vZ: 30,
    retracao: 0.8, vRetracao: 30, zHop: 0.4, preparoMin: 4, processo: BAMBU_A1, materiais: MAT_BAMBU_A,
  },
  {
    id: "acu-k2neo", marca: "Anycubic", modelo: "Kobra 2 Neo", mesa: [220, 220], alturaMax: 250, aMax: 2000, vMax: 300, jerk: 10, klipper: false, vZ: 8,
    retracao: 2.5, vRetracao: 100, zHop: 0, preparoMin: 5,
    processo: {
      ...ANYCUBIC, alturaPrimeira: 0.24, topo: 3, fundoMm: 0.6, lSolido: 0.42,
      vParedeExt: 60, vParedeInt: 100, vEsparso: 150, vSolido: 100, vTopo: 60, vPrimeira: 50, vPrimeiraPreench: 50, vSuporte: 100, vDeslocamento: 300,
      aPadrao: 2000, aParedeExt: 1000, aParedeInt: 1500, aTopo: 1000, aEsparso: 2000, aPrimeira: 500, aDeslocamento: 2000, anguloSuporte: 40, vBalanco: [60, 50, 30, 10],
    },
    materiais: { pla: { tempoCamada: 9 }, petg: {}, abs: {}, tpu: {} },
  },
  {
    id: "acu-k2pro", marca: "Anycubic", modelo: "Kobra 2 Pro", mesa: [220, 220], alturaMax: 250, aMax: 20000, vMax: 500, jerk: 20, klipper: true, vZ: 16,
    retracao: 1.5, vRetracao: 30, zHop: 0, preparoMin: 5,
    processo: {
      ...ANYCUBIC, alturaPrimeira: 0.24, fundoMm: 0.6,
      vParedeExt: 120, vParedeInt: 200, vEsparso: 200, vSolido: 130, vTopo: 120, vPrimeira: 60, vPrimeiraPreench: 60, vSuporte: 150, vDeslocamento: 300,
      aPadrao: 10000, aParedeExt: 5000, aParedeInt: 10000, aTopo: 2000, aEsparso: 10000, aPrimeira: 5000, aDeslocamento: 10000,
      vBalanco: [0, 50, 40, 30], vPonte: 50,
    },
    materiais: { pla: { tempoCamada: 9 }, plaRapido: {}, petg: {}, abs: {}, tpu: {} },
  },
  {
    id: "acu-k3", marca: "Anycubic", modelo: "Kobra 3", mesa: [255, 255], alturaMax: 260, aMax: 15000, vMax: 600, jerk: 20, klipper: true, vZ: 10,
    retracao: 1, vRetracao: 60, zHop: 0.4, preparoMin: 4,
    processo: { ...ANYCUBIC, fundoMm: 0.6, aDeslocamento: 15000, anguloSuporte: 40, vBalanco: [0, 50, 30, 20] },
    materiais: { pla: {}, plaRapido: {}, petg: { tempoCamada: 10, vMinResfriar: 25 }, abs: {}, asa: { tempoCamada: 16 }, tpu: {} },
  },
  {
    id: "acu-k3v2", marca: "Anycubic", modelo: "Kobra 3 V2", mesa: [255, 255], alturaMax: 260, aMax: 20000, vMax: 600, jerk: 20, klipper: true, vZ: 15,
    retracao: 1, vRetracao: 60, zHop: 0.4, preparoMin: 4,
    processo: ANYCUBIC,
    materiais: { pla: {}, plaRapido: {}, petg: { densidade: 1.23, tempoCamada: 10, vMinResfriar: 25 }, abs: { densidade: 1.05, vazaoMax: 5, tempoCamada: 16, vMinResfriar: 25 }, asa: {}, tpu: { densidade: 1.23 } },
  },
  {
    id: "acu-k3max", marca: "Anycubic", modelo: "Kobra 3 Max", mesa: [426, 420], alturaMax: 500, aMax: 10000, vMax: 600, jerk: 20, klipper: true, vZ: 20,
    retracao: 0.8, vRetracao: 30, zHop: 0.4, preparoMin: 6,
    processo: {
      ...ANYCUBIC, vParedeExt: 150, vSolido: 150, vTopo: 100, vDeslocamento: 300,
      aPadrao: 5000, aParedeExt: 2000, aParedeInt: 5000, aTopo: 1000, aEsparso: 5000,
    },
    materiais: {
      pla: { vazaoMax: 13, tempoCamada: 9 }, plaRapido: { tempoCamada: 8 }, petg: { densidade: 1.3, tempoCamada: 10 },
      abs: { densidade: 1.05, vazaoMax: 5, tempoCamada: 16 }, tpu: { densidade: 1.08 },
    },
  },
  {
    id: "acu-s1", marca: "Anycubic", modelo: "Kobra S1", mesa: [250, 250], alturaMax: 250, aMax: 10000, vMax: 600, jerk: 9, klipper: true, vZ: 15,
    retracao: 0.8, vRetracao: 40, zHop: 0.4, preparoMin: 5,
    processo: {
      ...ANYCUBIC, vParedeExt: 200, vParedeInt: 300, vEsparso: 270, vSolido: 250, vTopo: 200, vPrimeira: 50, vPrimeiraPreench: 80, vSuporte: 150, vDeslocamento: 300,
      aPadrao: 10000, aParedeExt: 5000, aParedeInt: 5000, aTopo: 2000, aEsparso: 10000, aPrimeira: 500, aDeslocamento: 10000,
    },
    materiais: { pla: {}, plaRapido: { tempoCamada: 4 }, petg: { vazaoMax: 12 }, abs: {}, asa: {}, tpu: { densidade: 1.24 } },
  },
  {
    id: "acu-s1max", marca: "Anycubic", modelo: "Kobra S1 Max", mesa: [350, 350], alturaMax: 350, aMax: 20000, vMax: 600, jerk: 15, klipper: true, vZ: 10,
    retracao: 0.4, vRetracao: 30, zHop: 0.4, preparoMin: 6,
    processo: {
      ...ANYCUBIC, vParedeExt: 200, vParedeInt: 300, vEsparso: 300, vSolido: 250, vTopo: 200, vPrimeira: 50, vPrimeiraPreench: 100, vSuporte: 150, vDeslocamento: 300,
      aPadrao: 10000, aParedeExt: 5000, aParedeInt: 5000, aTopo: 2000, aEsparso: 10000, aPrimeira: 500, aDeslocamento: 10000,
    },
    materiais: { pla: { vazaoMax: 15 }, plaRapido: { tempoCamada: 4 }, petg: { vazaoMax: 12 }, abs: { vazaoMax: 16 }, asa: { densidade: 1.06, vazaoMax: 15 }, tpu: { densidade: 1.24 } },
  },
];

export const maquinaPorId = (id: string) => MAQUINAS.find((m) => m.id === id) ?? MAQUINAS[0];

/** Materiais disponíveis na máquina, já com os ajustes do perfil dela. */
export function materiaisDa(m: Maquina): Material[] {
  return (Object.keys(m.materiais) as IdMaterial[]).map((id) => ({ ...MATERIAIS[id], ...m.materiais[id] }));
}

export function materialDa(m: Maquina, id: IdMaterial): Material {
  const ms = materiaisDa(m);
  return ms.find((x) => x.id === id) ?? ms[0];
}
