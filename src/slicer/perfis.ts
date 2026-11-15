// WJSlicer3D: perfis de impressora e de material para o orçamento de tempo e material.
// Só duas impressoras (pedido do Johann, 15/11/2026): Bambu Lab P1S e Anycubic Kobra 3, bico de 0,4 mm,
// processo "0,20 mm padrão" de cada uma. Valores conferidos nos perfis de fábrica abertos (arquivos
// JSON de dados) do fatiador de referência, com a herança resolvida: camada, paredes, cascas,
// larguras de linha, velocidades, acelerações, jerk, suporte, borda, retração e levantamento do Z; dos
// filamentos: densidade, fluxo, vazão volumétrica máxima e tempo mínimo de camada. Só dados técnicos
// de compatibilidade: nenhum código, texto ou ícone copiado. Puro: testado em scripts/teste-slicer.ts.

export type Padrao = "grade" | "linhas" | "cruzado" | "triangulos" | "cubico" | "giroide" | "favo";
export const NOMES_PADROES: Record<Padrao, string> = {
  grade: "Grade", linhas: "Linhas", cruzado: "Linhas cruzadas", triangulos: "Triângulos", cubico: "Cúbico", giroide: "Giroide", favo: "Favo de mel",
};

export type TipoSuporte = "nenhum" | "normal" | "arvore";

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
  /** preenchimento esparso (0–1) e padrão */
  preenchimento: number;
  padrao: Padrao;
  /** larguras de linha (mm) */
  lParedeExt: number;
  lParedeInt: number;
  lEsparso: number;
  lSolido: number;
  lTopo: number;
  lPrimeira: number;
  lSuporte: number;
  /** velocidades (mm/s) */
  vParedeExt: number;
  vParedeInt: number;
  vEsparso: number;
  vSolido: number;
  vTopo: number;
  vPrimeira: number;
  vPrimeiraPreench: number;
  vPonte: number;
  vSuporte: number;
  vInterface: number;
  vDeslocamento: number;
  vSaia: number;
  /** parede em balanço: velocidade por faixa do quanto sai da camada de baixo (até 25/50/75/100% da largura; 0 = sem desacelerar) e além de 100% */
  vBalanco: [number, number, number, number];
  vBalancoTotal: number;
  /** acelerações (mm/s²) */
  aPadrao: number;
  aParedeExt: number;
  aParedeInt: number;
  aTopo: number;
  aEsparso: number;
  aSolido: number;
  aPonte: number;
  aPrimeira: number;
  aDeslocamento: number;
  aDeslocPrimeira: number;
  /** jerk / velocidade de canto por recurso (mm/s); 0 = o da máquina */
  jParedeExt: number;
  jParedeInt: number;
  jPreench: number;
  jTopo: number;
  jPrimeira: number;
  jDeslocamento: number;
  jPadrao: number;
  /** sobreposição do preenchimento nas paredes (fração da largura do preenchimento) */
  sobreposicao: number;
  /** razões de fluxo de topo e de ponte */
  fluxoTopo: number;
  fluxoPonte: number;
  /** ligação das linhas do preenchimento junto às paredes (mm) e área mínima de esparso (mm²; menor vira sólido) */
  ancoraMax: number;
  areaMinEsparso: number;
  /** suporte */
  suporteTipo: Exclude<TipoSuporte, "nenhum">;
  anguloSuporte: number;
  suporteDistZ: number;
  suporteDistXY: number;
  /** vão entre as linhas do corpo do suporte e da interface (mm) e camadas de interface */
  espacoSuporte: number;
  espacoInterface: number;
  interfaceTopo: number;
  interfaceFundo: number;
  soNaMesa: boolean;
  arvore: { angulo: number; diametro: number; ponta: number; anguloDiametro: number; distancia: number; paredeDupla: number };
  /** borda (aba) e saia */
  bordaLargura: number;
  bordaFolga: number;
  saiaDistancia: number;
}

/**
 * Troca de cor (sistema de 4 filamentos de cada impressora). Valores de fábrica = típicos do sistema de
 * cada máquina (estimativa, a confirmar com uma impressão medida); o usuário edita no projeto.
 */
export interface ConfigTroca {
  /** purga por troca (mm³ de filamento novo empurrado para limpar o bico) */
  purgaMm3: number;
  /** tempo de cada troca (s): recolher, trocar e carregar o filamento, sem a purga */
  tempoS: number;
  /** vazão da purga (mm³/s) */
  vazaoPurga: number;
  /** torre de purga: onde a purga é depositada (desligada: a purga cai fora da peça) */
  torre: boolean;
  /** lado da torre (mm) */
  larguraTorre: number;
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
  /** jerk da máquina (mm/s): variação instantânea de velocidade permitida em cada eixo */
  jerk: number;
  /** firmware Klipper: "acelerar até desacelerar" (fração) nas linhas curtas; 0 = não */
  aceleraDesacelera: number;
  /** eixo Z: velocidade e aceleração máximas */
  vZ: number;
  aZ: number;
  /** retração (mm), velocidades de retrair e de voltar (mm/s), deslocamento mínimo que retrai (mm) */
  retracao: number;
  vRetracao: number;
  vRecuperacao: number;
  retracaoMin: number;
  /** levantamento do Z ao retrair (mm) e altura a partir da qual levanta */
  zHop: number;
  zHopAcima: number;
  /** limpeza ao retrair: distância (mm) e fração da velocidade de deslocamento */
  limpeza: number;
  vLimpeza: number;
  /** preparo típico (aquecer mesa e bico, nivelar, linha de purga), minutos */
  preparoMin: number;
  /** troca de cor de fábrica (sistema de 4 filamentos) */
  troca: ConfigTroca;
  processo: Processo;
  /** materiais que a máquina oferece, com os valores do perfil desta máquina */
  materiais: Partial<Record<IdMaterial, Omit<Material, "id" | "nome" | "precoKg">>>;
}

export type IdMaterial = "pla" | "plaRapido" | "petg" | "abs" | "asa" | "tpu";

export interface Material {
  id: IdMaterial;
  nome: string;
  /** g/cm³ */
  densidade: number;
  /** razão de fluxo do filamento (multiplica o material extrudado) */
  fluxo: number;
  /** vazão volumétrica máxima do bico (mm³/s) */
  vazaoMax: number;
  /** tempo mínimo de camada (s) e velocidade mínima ao desacelerar para resfriar (mm/s) */
  tempoCamada: number;
  vMinResfriar: number;
  /** preço padrão sugerido (R$/kg), editável na tela */
  precoKg: number;
}

const NOMES: Record<IdMaterial, [string, number]> = {
  pla: ["PLA", 120], plaRapido: ["PLA alta velocidade", 130], petg: ["PETG", 130], abs: ["ABS", 120], asa: ["ASA", 150], tpu: ["TPU (flexível)", 200],
};

export const MAQUINAS: Maquina[] = [
  {
    id: "bbl-p1s", marca: "Bambu Lab", modelo: "P1S", mesa: [256, 256], alturaMax: 250,
    aMax: 20000, vMax: 500, jerk: 9, aceleraDesacelera: 0, vZ: 20, aZ: 500,
    retracao: 0.8, vRetracao: 30, vRecuperacao: 30, retracaoMin: 1, zHop: 0.4, zHopAcima: 0, limpeza: 2, vLimpeza: 0.8, preparoMin: 5,
    troca: { purgaMm3: 280, tempoS: 35, vazaoPurga: 9, torre: true, larguraTorre: 35 },
    processo: {
      altura: 0.2, alturaPrimeira: 0.2, paredes: 2, topo: 5, fundo: 3, topoMm: 1, fundoMm: 0, preenchimento: 0.15, padrao: "grade",
      lParedeExt: 0.42, lParedeInt: 0.45, lEsparso: 0.45, lSolido: 0.42, lTopo: 0.42, lPrimeira: 0.5, lSuporte: 0.42,
      vParedeExt: 200, vParedeInt: 300, vEsparso: 270, vSolido: 250, vTopo: 200, vPrimeira: 50, vPrimeiraPreench: 105, vPonte: 50,
      vSuporte: 150, vInterface: 80, vDeslocamento: 500, vSaia: 50, vBalanco: [0, 50, 30, 10], vBalancoTotal: 10,
      aPadrao: 10000, aParedeExt: 5000, aParedeInt: 10000, aTopo: 2000, aEsparso: 10000, aSolido: 10000, aPonte: 10000, aPrimeira: 500,
      aDeslocamento: 10000, aDeslocPrimeira: 6000,
      jParedeExt: 0, jParedeInt: 0, jPreench: 0, jTopo: 0, jPrimeira: 0, jDeslocamento: 0, jPadrao: 0,
      sobreposicao: 0.15, fluxoTopo: 1, fluxoPonte: 1, ancoraMax: 20, areaMinEsparso: 15,
      suporteTipo: "arvore", anguloSuporte: 30, suporteDistZ: 0.2, suporteDistXY: 0.35, espacoSuporte: 2.5, espacoInterface: 0.5,
      interfaceTopo: 2, interfaceFundo: 2, soNaMesa: false,
      arvore: { angulo: 45, diametro: 2, ponta: 0.8, anguloDiametro: 5, distancia: 5, paredeDupla: 3 },
      bordaLargura: 5, bordaFolga: 0.1, saiaDistancia: 2,
    },
    materiais: {
      pla: { densidade: 1.26, fluxo: 0.98, vazaoMax: 21, tempoCamada: 4, vMinResfriar: 20 },
      plaRapido: { densidade: 1.24, fluxo: 0.98, vazaoMax: 18, tempoCamada: 4, vMinResfriar: 20 },
      petg: { densidade: 1.27, fluxo: 0.95, vazaoMax: 12, tempoCamada: 12, vMinResfriar: 20 },
      abs: { densidade: 1.04, fluxo: 0.95, vazaoMax: 16, tempoCamada: 3, vMinResfriar: 20 },
      asa: { densidade: 1.04, fluxo: 0.95, vazaoMax: 12, tempoCamada: 3, vMinResfriar: 20 },
      tpu: { densidade: 1.24, fluxo: 1, vazaoMax: 3.2, tempoCamada: 8, vMinResfriar: 10 },
    },
  },
  {
    id: "acu-k3", marca: "Anycubic", modelo: "Kobra 3", mesa: [255, 255], alturaMax: 260,
    aMax: 15000, vMax: 600, jerk: 20, aceleraDesacelera: 0.5, vZ: 10, aZ: 5000,
    retracao: 1, vRetracao: 60, vRecuperacao: 60, retracaoMin: 1, zHop: 0.4, zHopAcima: 0.3, limpeza: 2, vLimpeza: 0.8, preparoMin: 4,
    troca: { purgaMm3: 250, tempoS: 50, vazaoPurga: 8, torre: true, larguraTorre: 35 },
    processo: {
      altura: 0.2, alturaPrimeira: 0.2, paredes: 2, topo: 5, fundo: 3, topoMm: 1, fundoMm: 0.6, preenchimento: 0.15, padrao: "cruzado",
      lParedeExt: 0.42, lParedeInt: 0.45, lEsparso: 0.45, lSolido: 0.42, lTopo: 0.42, lPrimeira: 0.5, lSuporte: 0.4,
      vParedeExt: 130, vParedeInt: 200, vEsparso: 300, vSolido: 130, vTopo: 130, vPrimeira: 45, vPrimeiraPreench: 45, vPonte: 30,
      vSuporte: 100, vInterface: 100, vDeslocamento: 350, vSaia: 50, vBalanco: [0, 50, 30, 20], vBalancoTotal: 20,
      aPadrao: 10000, aParedeExt: 5000, aParedeInt: 6000, aTopo: 2000, aEsparso: 5000, aSolido: 10000, aPonte: 5000, aPrimeira: 500,
      aDeslocamento: 15000, aDeslocPrimeira: 15000,
      jParedeExt: 15, jParedeInt: 15, jPreench: 9, jTopo: 9, jPrimeira: 9, jDeslocamento: 12, jPadrao: 20,
      sobreposicao: 0.15, fluxoTopo: 0.97, fluxoPonte: 0.9, ancoraMax: 20, areaMinEsparso: 15,
      suporteTipo: "arvore", anguloSuporte: 40, suporteDistZ: 0.25, suporteDistXY: 0.25, espacoSuporte: 0.2, espacoInterface: 0.2,
      interfaceTopo: 3, interfaceFundo: 3, soNaMesa: true,
      arvore: { angulo: 40, diametro: 5, ponta: 0.8, anguloDiametro: 5, distancia: 5, paredeDupla: 3 },
      bordaLargura: 5, bordaFolga: 0.15, saiaDistancia: 2,
    },
    materiais: {
      pla: { densidade: 1.24, fluxo: 0.96, vazaoMax: 12, tempoCamada: 8, vMinResfriar: 20 },
      plaRapido: { densidade: 1.24, fluxo: 0.97, vazaoMax: 18, tempoCamada: 7, vMinResfriar: 20 },
      petg: { densidade: 1.27, fluxo: 0.95, vazaoMax: 8, tempoCamada: 10, vMinResfriar: 25 },
      abs: { densidade: 1.04, fluxo: 0.98, vazaoMax: 5, tempoCamada: 16, vMinResfriar: 25 },
      asa: { densidade: 1.04, fluxo: 0.95, vazaoMax: 12, tempoCamada: 16, vMinResfriar: 20 },
      tpu: { densidade: 1.24, fluxo: 1, vazaoMax: 3.2, tempoCamada: 8, vMinResfriar: 20 },
    },
  },
];

export const maquinaPorId = (id: string) => MAQUINAS.find((m) => m.id === id) ?? MAQUINAS[0];

/** Materiais disponíveis na máquina, com os valores do perfil dela. */
export function materiaisDa(m: Maquina): Material[] {
  return (Object.keys(m.materiais) as IdMaterial[]).map((id) => ({ id, nome: NOMES[id][0], precoKg: NOMES[id][1], ...m.materiais[id]! }));
}

export function materialDa(m: Maquina, id: IdMaterial): Material {
  const ms = materiaisDa(m);
  return ms.find((x) => x.id === id) ?? ms[0];
}
