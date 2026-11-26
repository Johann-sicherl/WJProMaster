// WJSlicer3D: esquema de TODOS os parâmetros (L0 do novo layout, docs/global/wjslicer3d-layout.md §3–§4).
// Uma tabela só: id, aba, grupo, rótulo em português (nomes nossos), tipo, unidade, limites, nível
// (simples/avançado/especialista), estado (motor ✅, parcial 🟡, ainda não aplicado 🔶, oculto ⚪/⛔) e "visível se".
// A tela do processo (L1 em diante) é GERADA daqui; campo novo = uma linha. Puro: testado em scripts/teste-esquema.ts.
// Campos 🔶 entram com valor padrão neutro e NÃO mudam o motor; campos ⚪/⛔ (G-code, temperaturas, ventoinhas…)
// entram como OCULTOS (decisão do Johann, 26/11/2026): só guardam o valor para a importação de perfis não perdê-lo.

import { NOMES_PADROES, type Maquina, type Material, type Processo } from "./perfis";

export type Valor = number | boolean | string;
/** Valores "achatados": id → valor (ex.: "vBalanco.2", "arvore.angulo"). É o que as camadas de perfil guardam. */
export type Plano = Record<string, Valor>;

export type Aba = "qualidade" | "resistencia" | "velocidade" | "suporte" | "multimaterial" | "outros" | "impressora" | "filamento";
export type TipoCampo = "numero" | "inteiro" | "percentual" | "booleano" | "lista" | "padrao" | "texto";
export type Nivel = "simples" | "avancado" | "especialista";
/** motor ✅ · parcial 🟡 · naoAplicado 🔶 · oculto ⚪/⛔ */
export type Estado = "motor" | "parcial" | "naoAplicado" | "oculto";
/** de onde vem o valor: campo do `Processo`, do projeto (fora do `Processo`), da `Maquina`, do `Material` ou novo (ainda sem lugar no motor) */
export type Origem = "processo" | "projeto" | "maquina" | "material" | "novo";

export interface Campo {
  id: string;
  origem: Origem;
  aba: Aba;
  grupo: string;
  rotulo: string;
  tipo: TipoCampo;
  /** mm, mm/s, mm/s², °, s, mm³… (vazio = sem unidade). `percentual` guarda fração 0–1 e a tela mostra em % */
  unidade: string;
  min?: number;
  max?: number;
  nivel: Nivel;
  estado: Estado;
  /** lista: [valor, rótulo]; tipo `padrao` usa os padrões de preenchimento do motor */
  opcoes?: [string, string][];
  /** valor de fábrica dos campos que não vêm do `Processo`/`Maquina`/`Material` (neutro: não muda o motor) */
  padrao?: Valor;
  /** "outroId" (verdadeiro), "outroId=valor" ou "outroId!=valor": só mostra o campo quando for verdade */
  visivelSe?: string;
  nota?: string;
}

// ---------- achatar / desachatar o Processo ----------

/** `Processo` → id → valor (arrays viram "nome.0", objetos "nome.chave"). */
export function achatar(o: object, prefixo = "", saida: Plano = {}): Plano {
  for (const [k, v] of Object.entries(o)) {
    const id = prefixo ? `${prefixo}.${k}` : k;
    if (v !== null && typeof v === "object") achatar(v, id, saida);
    else saida[id] = v as Valor;
  }
  return saida;
}

/** Inverso de `achatar`: monta o objeto a partir dos ids que existem no modelo (ids de fora do modelo são ignorados). */
export function desachatar<T extends object>(plano: Plano, modelo: T): T {
  const copia = (m: unknown, prefixo: string): unknown => {
    if (Array.isArray(m)) return m.map((_, i) => copia(m[i], `${prefixo}.${i}`));
    if (m !== null && typeof m === "object") return Object.fromEntries(Object.keys(m).map((k) => [k, copia((m as Record<string, unknown>)[k], prefixo ? `${prefixo}.${k}` : k)]));
    return prefixo in plano ? plano[prefixo] : m;
  };
  return copia(modelo, "") as T;
}

// ---------- construção compacta da tabela ----------

type Linha = [id: string, rotulo: string, tipo: TipoCampo, unidade: string, min: number | undefined, max: number | undefined, extra?: Partial<Campo>];

const CAMPOS: Campo[] = [];
function grupo(aba: Aba, nome: string, origem: Origem, estado: Estado, nivel: Nivel, linhas: Linha[]) {
  for (const [id, rotulo, tipo, unidade, min, max, extra] of linhas)
    CAMPOS.push({ id, origem, aba, grupo: nome, rotulo, tipo, unidade, min, max, nivel, estado, ...extra });
}
const lista = (...o: [string, string][]) => o;
const OPC_PADRAO = Object.entries(NOMES_PADROES) as [string, string][];
const NOVO = "novo" as const;

// ===== Qualidade =====
grupo("qualidade", "Altura da camada", "processo", "motor", "simples", [
  ["altura", "Altura da camada", "numero", "mm", 0.04, 0.4],
  ["alturaPrimeira", "Altura da 1ª camada", "numero", "mm", 0.1, 0.4],
]);
grupo("qualidade", "Largura da linha", "processo", "motor", "avancado", [
  ["lPrimeira", "1ª camada", "numero", "mm", 0.25, 0.8],
  ["lParedeExt", "Parede externa", "numero", "mm", 0.25, 0.8],
  ["lParedeInt", "Parede interna", "numero", "mm", 0.25, 0.8],
  ["lTopo", "Superfície de topo", "numero", "mm", 0.25, 0.8],
  ["lEsparso", "Preenchimento esparso", "numero", "mm", 0.25, 0.8],
  ["lSolido", "Preenchimento sólido interno", "numero", "mm", 0.25, 0.8],
  ["lSuporte", "Suporte", "numero", "mm", 0.25, 0.8],
]);
grupo("qualidade", "Largura da linha", NOVO, "naoAplicado", "avancado", [["lPadrao", "Padrão", "numero", "mm", 0.25, 0.8, { padrao: 0.42 }]]);
grupo("qualidade", "Costura", NOVO, "naoAplicado", "avancado", [
  ["costuraPosicao", "Posição da costura", "lista", "", undefined, undefined, { padrao: "maisProxima", opcoes: lista(["maisProxima", "Mais próxima"], ["alinhada", "Alinhada"], ["alinhadaAtras", "Alinhada atrás"], ["atras", "Atrás"], ["aleatoria", "Aleatória"]) }],
  ["costuraAlternada", "Costuras internas alternadas", "booleano", "", undefined, undefined, { padrao: false, nivel: "especialista" }],
  ["costuraVao", "Vão da costura", "percentual", "%", 0, 1, { padrao: 0, nivel: "especialista" }],
  ["costuraRampaTipo", "Costura em rampa", "lista", "", undefined, undefined, { padrao: "nenhuma", opcoes: lista(["nenhuma", "Nenhuma"], ["contorno", "Contorno"], ["contornoFuros", "Contorno e furos"]) }],
  ["costuraRampaAltura", "Altura inicial da rampa", "percentual", "%", 0, 1, { padrao: 0, nivel: "especialista", visivelSe: "costuraRampaTipo!=nenhuma" }],
  ["costuraRampaComprimento", "Comprimento da rampa", "numero", "mm", 0, 50, { padrao: 0, nivel: "especialista", visivelSe: "costuraRampaTipo!=nenhuma" }],
  ["costuraRampaPassos", "Passos da rampa", "inteiro", "", 1, 100, { padrao: 10, nivel: "especialista", visivelSe: "costuraRampaTipo!=nenhuma" }],
  ["costuraRampaLacoInteiro", "Rampa no laço inteiro", "booleano", "", undefined, undefined, { padrao: false, nivel: "especialista", visivelSe: "costuraRampaTipo!=nenhuma" }],
  ["costuraVelocidade", "Velocidade da costura (0 = a da parede)", "numero", "mm/s", 0, 500, { padrao: 0, nivel: "especialista" }],
  ["limpezaVelocidade", "Velocidade de limpeza", "numero", "mm/s", 0, 500, { padrao: 0, nivel: "especialista" }],
  ["limparNosLacos", "Limpar nos laços", "booleano", "", undefined, undefined, { padrao: false, nivel: "especialista" }],
  ["limparAntesParedeExt", "Limpar antes da parede externa", "booleano", "", undefined, undefined, { padrao: false, nivel: "especialista" }],
]);
grupo("qualidade", "Precisão", NOVO, "naoAplicado", "especialista", [
  ["fechamentoFresta", "Raio de fechamento de fresta", "numero", "mm", 0, 2, { padrao: 0, nota: "Hoje é uma constante interna do motor (🟡)." }],
  ["resolucao", "Resolução", "numero", "mm", 0, 1, { padrao: 0, nota: "Hoje é uma constante interna do motor (🟡)." }],
  ["ajusteArcos", "Ajuste de arcos", "booleano", "", undefined, undefined, { padrao: false }],
  ["compensacaoFuroXY", "Compensação XY de furo", "numero", "mm", -1, 1, { padrao: 0 }],
  ["compensacaoContornoXY", "Compensação XY de contorno", "numero", "mm", -1, 1, { padrao: 0 }],
  ["peDeElefante", "Compensação de pé de elefante", "numero", "mm", 0, 2, { padrao: 0, nivel: "avancado" }],
  ["paredePrecisa", "Parede precisa", "booleano", "", undefined, undefined, { padrao: false }],
  ["furoParaPolifuro", "Furo vira polifuro", "booleano", "", undefined, undefined, { padrao: false }],
  ["modoFatiamento", "Modo de fatiamento", "lista", "", undefined, undefined, { padrao: "normal", opcoes: lista(["normal", "Normal"], ["parImpar", "Par-ímpar"], ["fecharFuros", "Fechar furos"]) }],
]);
grupo("qualidade", "Passar ferro", NOVO, "naoAplicado", "avancado", [
  ["ferroTipo", "Passar ferro", "lista", "", undefined, undefined, { padrao: "nenhum", opcoes: lista(["nenhum", "Nenhum"], ["soTopoMaisAlto", "Só o topo mais alto"], ["todasTopo", "Todas as superfícies de topo"], ["todoSolido", "Todo o sólido"]) }],
  ["ferroPadrao", "Padrão", "lista", "", undefined, undefined, { padrao: "retilineo", opcoes: lista(["retilineo", "Retilíneo"], ["concentrico", "Concêntrico"]), visivelSe: "ferroTipo!=nenhum" }],
  ["ferroFluxo", "Fluxo", "percentual", "%", 0, 1, { padrao: 0.15, visivelSe: "ferroTipo!=nenhum" }],
  ["ferroEspacamento", "Espaçamento", "numero", "mm", 0.01, 2, { padrao: 0.1, visivelSe: "ferroTipo!=nenhum" }],
  ["ferroRecuo", "Recuo", "numero", "mm", 0, 5, { padrao: 0, visivelSe: "ferroTipo!=nenhum" }],
  ["ferroVelocidade", "Velocidade", "numero", "mm/s", 1, 500, { padrao: 15, visivelSe: "ferroTipo!=nenhum" }],
  ["ferroAngulo", "Ângulo", "numero", "°", 0, 360, { padrao: 0, visivelSe: "ferroTipo!=nenhum" }],
]);
grupo("qualidade", "Gerador de paredes", NOVO, "naoAplicado", "especialista", [
  ["geradorParedes", "Gerador de paredes", "lista", "", undefined, undefined, { padrao: "classico", nivel: "avancado", opcoes: lista(["classico", "Clássico"], ["larguraVariavel", "Largura variável"]) }],
  ["geradorAnguloTransicao", "Ângulo de transição", "numero", "°", 1, 59, { padrao: 10, visivelSe: "geradorParedes=larguraVariavel" }],
  ["geradorFiltro", "Filtro de transição", "numero", "mm", 0, 5, { padrao: 1, visivelSe: "geradorParedes=larguraVariavel" }],
  ["geradorParedesTransicao", "Paredes na transição", "inteiro", "", 1, 10, { padrao: 3, visivelSe: "geradorParedes=larguraVariavel" }],
  ["geradorLarguraMinima", "Largura mínima de parede", "percentual", "%", 0, 2, { padrao: 0.85, visivelSe: "geradorParedes=larguraVariavel" }],
  ["geradorDetalheMinimo", "Tamanho mínimo de detalhe", "percentual", "%", 0, 2, { padrao: 0.25, visivelSe: "geradorParedes=larguraVariavel" }],
]);
grupo("qualidade", "Paredes e pontes", "processo", "motor", "avancado", [["fluxoPonte", "Fluxo de ponte", "numero", "", 0.5, 1.5]]);
grupo("qualidade", "Paredes e pontes", NOVO, "naoAplicado", "especialista", [
  ["ordemParedes", "Ordem das paredes", "lista", "", undefined, undefined, { padrao: "internaExterna", nivel: "avancado", opcoes: lista(["internaExterna", "Interna e depois externa"], ["externaInterna", "Externa e depois interna"], ["internaExternaInterna", "Interna, externa, interna"]) }],
  ["pontesGrossas", "Pontes grossas", "booleano", "", undefined, undefined, { padrao: false }],
  ["densidadePonte", "Densidade da ponte", "percentual", "%", 0, 1, { padrao: 1 }],
  ["detectarSolidoEstreito", "Detectar sólido interno estreito", "booleano", "", undefined, undefined, { padrao: false }],
  ["garantirCascaVertical", "Garantir espessura vertical da casca", "booleano", "", undefined, undefined, { padrao: false }],
  ["paredesExtrasBalanco", "Paredes extras em balanço", "booleano", "", undefined, undefined, { padrao: false }],
  ["inverterParImpar", "Inverter em camadas pares/ímpares", "booleano", "", undefined, undefined, { padrao: false }],
  ["inverterLimite", "Limite para inverter", "numero", "mm", 0, 50, { padrao: 0, visivelSe: "inverterParImpar" }],
  ["umaParedeTopo", "Só uma parede no topo", "booleano", "", undefined, undefined, { padrao: false, nivel: "avancado" }],
  ["umaParedeTopoLimite", "Limite da parede única no topo", "numero", "mm", 0, 50, { padrao: 0, visivelSe: "umaParedeTopo" }],
  ["umaParedePrimeira", "Só uma parede na 1ª camada", "booleano", "", undefined, undefined, { padrao: false }],
  ["evitarCruzarParedes", "Evitar cruzar paredes", "booleano", "", undefined, undefined, { padrao: false, nivel: "avancado" }],
  ["evitarCruzarDesvio", "Desvio máximo para evitar cruzar", "numero", "mm", 0, 100, { padrao: 0, visivelSe: "evitarCruzarParedes" }],
]);
grupo("qualidade", "Avançado", "processo", "motor", "avancado", [
  ["sobreposicao", "Sobreposição do preenchimento nas paredes", "percentual", "%", 0, 0.5],
  ["ancoraMax", "Âncora máxima do preenchimento", "numero", "mm", 0, 50],
  ["areaMinEsparso", "Área mínima de esparso (menor vira sólido)", "numero", "mm²", 0, 200, { nivel: "especialista" }],
]);
grupo("qualidade", "Avançado", NOVO, "naoAplicado", "especialista", [
  ["direcaoPreenchimento", "Direção do preenchimento", "numero", "°", 0, 360, { padrao: 45 }],
  ["direcaoPonte", "Direção da ponte (0 = automática)", "numero", "°", 0, 360, { padrao: 0 }],
  ["densidadeTopo", "Densidade da superfície de topo", "percentual", "%", 0, 1, { padrao: 1 }],
  ["densidadeFundo", "Densidade da superfície de fundo", "percentual", "%", 0, 1, { padrao: 1 }],
  ["alinharDirecaoAoModelo", "Alinhar a direção do preenchimento ao modelo", "booleano", "", undefined, undefined, { padrao: false }],
  ["combinarPreenchimento", "Combinar preenchimento a cada N camadas", "inteiro", "", 1, 8, { padrao: 1 }],
]);

// ===== Resistência =====
grupo("resistencia", "Paredes", "processo", "motor", "simples", [["paredes", "Número de paredes", "inteiro", "", 1, 20]]);
grupo("resistencia", "Paredes", NOVO, "naoAplicado", "avancado", [
  ["paredeExtraAlternada", "Parede extra alternada", "booleano", "", undefined, undefined, { padrao: false }],
  ["detectarParedeFina", "Detectar parede fina", "booleano", "", undefined, undefined, { padrao: false }],
]);
grupo("resistencia", "Cascas de topo e fundo", "processo", "motor", "simples", [
  ["topo", "Camadas de topo", "inteiro", "", 0, 50],
  ["topoMm", "Espessura mínima do topo", "numero", "mm", 0, 20, { nivel: "avancado" }],
  ["fundo", "Camadas de fundo", "inteiro", "", 0, 50],
  ["fundoMm", "Espessura mínima do fundo", "numero", "mm", 0, 20, { nivel: "avancado" }],
  ["fluxoTopo", "Fluxo da superfície de topo", "numero", "", 0.5, 1.5, { nivel: "avancado" }],
]);
const PADROES_CASCA = lista(["retilineo", "Retilíneo"], ["concentrico", "Concêntrico"]);
grupo("resistencia", "Cascas de topo e fundo", NOVO, "naoAplicado", "avancado", [
  ["padraoTopo", "Padrão da superfície de topo", "lista", "", undefined, undefined, { padrao: "retilineo", opcoes: PADROES_CASCA }],
  ["padraoFundo", "Padrão da superfície de fundo", "lista", "", undefined, undefined, { padrao: "retilineo", opcoes: PADROES_CASCA }],
  ["padraoSolidoInterno", "Padrão do sólido interno", "lista", "", undefined, undefined, { padrao: "retilineo", opcoes: PADROES_CASCA }],
]);
grupo("resistencia", "Preenchimento esparso", "processo", "motor", "simples", [
  ["preenchimento", "Densidade do preenchimento", "percentual", "%", 0, 1],
  ["padrao", "Padrão do preenchimento", "padrao", "", undefined, undefined, { opcoes: OPC_PADRAO }],
]);
grupo("resistencia", "Preenchimento de vãos", NOVO, "naoAplicado", "avancado", [
  ["preenchimentoVaos", "Preencher vãos", "booleano", "", undefined, undefined, { padrao: false }],
  ["vVaos", "Velocidade do preenchimento de vãos", "numero", "mm/s", 1, 500, { padrao: 30, visivelSe: "preenchimentoVaos" }],
]);

// ===== Velocidade =====
grupo("velocidade", "1ª camada", "processo", "motor", "simples", [
  ["vPrimeira", "Velocidade da 1ª camada", "numero", "mm/s", 1, 1000],
  ["vPrimeiraPreench", "Preenchimento da 1ª camada", "numero", "mm/s", 1, 1000],
]);
grupo("velocidade", "Outras camadas", "processo", "motor", "simples", [
  ["vParedeExt", "Parede externa", "numero", "mm/s", 1, 1000],
  ["vParedeInt", "Parede interna", "numero", "mm/s", 1, 1000],
  ["vEsparso", "Preenchimento esparso", "numero", "mm/s", 1, 1000],
  ["vSolido", "Sólido interno", "numero", "mm/s", 1, 1000],
  ["vTopo", "Superfície de topo", "numero", "mm/s", 1, 1000],
  ["vSuporte", "Suporte", "numero", "mm/s", 1, 1000],
  ["vInterface", "Interface do suporte", "numero", "mm/s", 1, 1000],
]);
grupo("velocidade", "Outras camadas", NOVO, "naoAplicado", "avancado", [
  ["vPerimetroPequeno", "Perímetro pequeno", "numero", "mm/s", 1, 1000, { padrao: 50 }],
  ["limitePerimetroPequeno", "Limite de perímetro pequeno", "numero", "mm", 0, 100, { padrao: 0 }],
]);
grupo("velocidade", "Balanços e pontes", "processo", "motor", "avancado", [
  ["vBalanco.0", "Balanço até 25 % (0 = sem desacelerar)", "numero", "mm/s", 0, 1000],
  ["vBalanco.1", "Balanço de 25 a 50 %", "numero", "mm/s", 0, 1000],
  ["vBalanco.2", "Balanço de 50 a 75 %", "numero", "mm/s", 0, 1000],
  ["vBalanco.3", "Balanço de 75 a 100 %", "numero", "mm/s", 0, 1000],
  ["vBalancoTotal", "Balanço total (acima de 100 %)", "numero", "mm/s", 0, 1000],
  ["vPonte", "Ponte", "numero", "mm/s", 1, 1000],
]);
grupo("velocidade", "Deslocamento", "processo", "motor", "simples", [["vDeslocamento", "Velocidade de deslocamento", "numero", "mm/s", 1, 2000]]);
grupo("velocidade", "Aceleração", "processo", "motor", "avancado", [
  ["aPadrao", "Padrão", "numero", "mm/s²", 0, 100000],
  ["aParedeExt", "Parede externa", "numero", "mm/s²", 0, 100000],
  ["aParedeInt", "Parede interna", "numero", "mm/s²", 0, 100000],
  ["aTopo", "Superfície de topo", "numero", "mm/s²", 0, 100000],
  ["aEsparso", "Preenchimento esparso", "numero", "mm/s²", 0, 100000],
  ["aSolido", "Sólido interno", "numero", "mm/s²", 0, 100000],
  ["aPrimeira", "1ª camada", "numero", "mm/s²", 0, 100000],
  ["aDeslocamento", "Deslocamento", "numero", "mm/s²", 0, 100000],
  ["aPonte", "Ponte", "numero", "mm/s²", 0, 100000],
  ["aDeslocPrimeira", "Deslocamento da 1ª camada", "numero", "mm/s²", 0, 100000],
]);
grupo("velocidade", "Jerk (0 = o da máquina)", "processo", "motor", "especialista", [
  ["jPadrao", "Padrão", "numero", "mm/s", 0, 100],
  ["jParedeExt", "Parede externa", "numero", "mm/s", 0, 100],
  ["jParedeInt", "Parede interna", "numero", "mm/s", 0, 100],
  ["jPreench", "Preenchimento", "numero", "mm/s", 0, 100],
  ["jTopo", "Superfície de topo", "numero", "mm/s", 0, 100],
  ["jPrimeira", "1ª camada", "numero", "mm/s", 0, 100],
  ["jDeslocamento", "Deslocamento", "numero", "mm/s", 0, 100],
]);
grupo("velocidade", "Suavizar a taxa de extrusão", NOVO, "naoAplicado", "especialista", [
  ["suavizarExtrusao", "Suavizar a taxa de extrusão", "booleano", "", undefined, undefined, { padrao: false }],
  ["suavizarTaxaMax", "Taxa máxima", "numero", "mm³/s²", 0, 1000, { padrao: 0, visivelSe: "suavizarExtrusao" }],
  ["suavizarJanela", "Janela", "numero", "mm", 0, 100, { padrao: 0, visivelSe: "suavizarExtrusao" }],
]);

// ===== Suporte =====
grupo("suporte", "Suporte", "projeto", "motor", "simples", [
  ["suporte", "Suporte", "lista", "", undefined, undefined, { padrao: "nenhum", opcoes: lista(["nenhum", "Sem suporte"], ["normal", "Normal"], ["arvore", "Árvore"]) }],
]);
grupo("suporte", "Suporte", "processo", "motor", "avancado", [
  ["suporteTipo", "Tipo de suporte do perfil (ao ligar)", "lista", "", undefined, undefined, { opcoes: lista(["normal", "Normal"], ["arvore", "Árvore"]), visivelSe: "suporte!=nenhum" }],
  ["anguloSuporte", "Ângulo-limite do balanço", "numero", "°", 0, 90, { visivelSe: "suporte!=nenhum" }],
  ["soNaMesa", "Só a partir da mesa", "booleano", "", undefined, undefined, { visivelSe: "suporte!=nenhum" }],
]);
grupo("suporte", "Suporte", NOVO, "naoAplicado", "avancado", [
  ["suporteEstilo", "Estilo do suporte", "lista", "", undefined, undefined, { padrao: "padrao", visivelSe: "suporte!=nenhum", opcoes: lista(["padrao", "Padrão"], ["grade", "Grade"], ["justo", "Justo"], ["organico", "Orgânico"], ["arvoreForte", "Árvore forte"], ["arvoreFina", "Árvore fina"], ["arvoreHibrida", "Árvore híbrida"]) }],
  ["removerBalancosPequenos", "Remover balanços pequenos", "booleano", "", undefined, undefined, { padrao: false, visivelSe: "suporte!=nenhum" }],
  ["soRegioesCriticas", "Só regiões críticas", "booleano", "", undefined, undefined, { padrao: false, visivelSe: "suporte!=nenhum" }],
  ["garantirPontesLongas", "Garantir suporte de pontes longas", "booleano", "", undefined, undefined, { padrao: false, visivelSe: "suporte!=nenhum" }],
]);
grupo("suporte", "Jangada", NOVO, "naoAplicado", "avancado", [
  ["jangadaCamadas", "Camadas da jangada", "inteiro", "", 0, 20, { padrao: 0 }],
  ["jangadaDistZ", "Distância Z de contato", "numero", "mm", 0, 1, { padrao: 0.1, visivelSe: "jangadaCamadas" }],
  ["jangadaExpansao", "Expansão", "numero", "mm", 0, 20, { padrao: 0, visivelSe: "jangadaCamadas" }],
  ["jangadaDensidadePrimeira", "Densidade da 1ª camada", "percentual", "%", 0, 1, { padrao: 1, visivelSe: "jangadaCamadas" }],
  ["jangadaExpansaoPrimeira", "Expansão da 1ª camada", "numero", "mm", 0, 20, { padrao: 0, visivelSe: "jangadaCamadas" }],
]);
grupo("suporte", "Filamento do suporte", NOVO, "naoAplicado", "avancado", [
  ["filamentoSuporte", "Filamento da base (0 = o do objeto)", "inteiro", "", 0, 4, { padrao: 0 }],
  ["filamentoInterface", "Filamento da interface (0 = o do objeto)", "inteiro", "", 0, 4, { padrao: 0 }],
]);
grupo("suporte", "Avançado", "processo", "motor", "especialista", [
  ["suporteDistZ", "Distância Z do topo", "numero", "mm", 0, 2, { visivelSe: "suporte!=nenhum" }],
  ["suporteDistXY", "Distância XY da peça", "numero", "mm", 0, 5, { visivelSe: "suporte!=nenhum" }],
  ["espacoSuporte", "Espaçamento das linhas do corpo", "numero", "mm", 0.1, 20, { visivelSe: "suporte!=nenhum" }],
  ["interfaceTopo", "Camadas de interface no topo", "inteiro", "", 0, 10, { visivelSe: "suporte!=nenhum" }],
  ["interfaceFundo", "Camadas de interface no fundo", "inteiro", "", 0, 10, { visivelSe: "suporte!=nenhum" }],
  ["espacoInterface", "Espaçamento das linhas da interface", "numero", "mm", 0.1, 20, { visivelSe: "suporte!=nenhum" }],
]);
grupo("suporte", "Avançado", NOVO, "naoAplicado", "especialista", [
  ["suporteDensidadePrimeira", "Densidade da 1ª camada", "percentual", "%", 0, 1, { padrao: 1 }],
  ["suporteExpansaoPrimeira", "Expansão da 1ª camada", "numero", "mm", 0, 20, { padrao: 0 }],
  ["suporteDistZFundo", "Distância Z do fundo", "numero", "mm", 0, 2, { padrao: 0 }],
  ["suportePadraoBase", "Padrão da base", "lista", "", undefined, undefined, { padrao: "padrao", opcoes: lista(["padrao", "Padrão"], ["retilineo", "Retilíneo"], ["grade", "Grade"], ["favo", "Favo"], ["relampago", "Relâmpago"], ["oco", "Oco"]) }],
  ["suporteAngulo", "Ângulo do padrão", "numero", "°", 0, 360, { padrao: 0 }],
  ["suportePadraoInterface", "Padrão da interface", "lista", "", undefined, undefined, { padrao: "padrao", opcoes: lista(["padrao", "Padrão"], ["retilineo", "Retilíneo"], ["grade", "Grade"]) }],
  ["suporteExpansaoNormal", "Expansão do suporte normal", "numero", "mm", 0, 20, { padrao: 0 }],
  ["naoApoiarPontes", "Não apoiar pontes", "booleano", "", undefined, undefined, { padrao: false }],
  ["alturaCamadaIndependente", "Altura de camada independente", "booleano", "", undefined, undefined, { padrao: false }],
  ["suporteParedes", "Paredes do suporte", "inteiro", "", 0, 10, { padrao: 0 }],
]);
grupo("suporte", "Árvore", "processo", "motor", "avancado", [
  ["arvore.distancia", "Distância entre galhos", "numero", "mm", 1, 30, { visivelSe: "suporte=arvore" }],
  ["arvore.diametro", "Diâmetro do galho", "numero", "mm", 0.5, 20, { visivelSe: "suporte=arvore" }],
  ["arvore.angulo", "Ângulo do galho", "numero", "°", 0, 80, { visivelSe: "suporte=arvore" }],
  ["arvore.ponta", "Diâmetro da ponta", "numero", "mm", 0.2, 5, { nivel: "especialista", visivelSe: "suporte=arvore" }],
  ["arvore.anguloDiametro", "Ângulo de engrossar o galho", "numero", "°", 0, 30, { nivel: "especialista", visivelSe: "suporte=arvore" }],
  ["arvore.paredeDupla", "Parede dupla a partir do diâmetro de", "numero", "mm", 0, 30, { nivel: "especialista", visivelSe: "suporte=arvore" }],
]);
grupo("suporte", "Árvore", NOVO, "naoAplicado", "especialista", [
  ["arvorePreenchida", "Árvore com preenchimento", "booleano", "", undefined, undefined, { padrao: false, visivelSe: "suporte=arvore" }],
  ["arvoreBordaAuto", "Largura da borda automática", "numero", "mm", 0, 20, { padrao: 0, visivelSe: "suporte=arvore" }],
]);

// ===== Multimaterial =====
grupo("multimaterial", "Filamento por função", NOVO, "naoAplicado", "avancado", [
  ["filamentoParede", "Filamento da parede (0 = o do objeto)", "inteiro", "", 0, 4, { padrao: 0 }],
  ["filamentoSolidoInterno", "Filamento do sólido interno (0 = o do objeto)", "inteiro", "", 0, 4, { padrao: 0 }],
]);
grupo("multimaterial", "Torre de purga", NOVO, "naoAplicado", "avancado", [
  ["torreBorda", "Largura da borda da torre", "numero", "mm", 0, 20, { padrao: 0 }],
  ["torreX", "Posição X da torre (arrastar na mesa)", "numero", "mm", 0, 1000, { padrao: 0 }],
  ["torreY", "Posição Y da torre", "numero", "mm", 0, 1000, { padrao: 0 }],
  ["purgarNoPreenchimento", "Purgar dentro do preenchimento", "booleano", "", undefined, undefined, { padrao: false }],
  ["purgarNosObjetos", "Purgar dentro dos objetos", "booleano", "", undefined, undefined, { padrao: false }],
  ["purgarNoSuporte", "Purgar dentro do suporte", "booleano", "", undefined, undefined, { padrao: false }],
  ["torreAngulo", "Ângulo de rotação da torre", "numero", "°", 0, 360, { padrao: 0, nivel: "especialista" }],
  ["torreDistPonte", "Distância máxima de ponte", "numero", "mm", 0, 100, { padrao: 0, nivel: "especialista" }],
  ["torreEspacoExtra", "Espaçamento extra", "numero", "mm", 0, 20, { padrao: 0, nivel: "especialista" }],
  ["torreAnguloCone", "Ângulo do cone de estabilização", "numero", "°", 0, 90, { padrao: 0, nivel: "especialista" }],
  ["torreEspacoLinhas", "Espaçamento das linhas de purga", "numero", "mm", 0, 20, { padrao: 0, nivel: "especialista" }],
  ["torreFluxoExtra", "Fluxo extra da purga", "numero", "", 0.5, 2, { padrao: 1, nivel: "especialista" }],
  ["torreParede", "Tipo de parede da torre", "lista", "", undefined, undefined, { padrao: "reta", nivel: "especialista", opcoes: lista(["reta", "Reta"], ["nervura", "Nervura"]) }],
]);
grupo("multimaterial", "Matriz de purga", NOVO, "naoAplicado", "avancado", [
  ["matrizPurgaMultiplicador", "Multiplicador da matriz", "numero", "", 0, 10, { padrao: 1 }],
]);
for (let i = 0; i < 4; i++)
  for (let j = 0; j < 4; j++)
    if (i !== j) grupo("multimaterial", "Matriz de purga", NOVO, "naoAplicado", "especialista", [[`matrizPurga.${i}.${j}`, `Purga de ${i + 1} para ${j + 1}`, "numero", "mm³", 0, 5000, { padrao: 0 }]]);
grupo("multimaterial", "Evitar vazamento", NOVO, "oculto", "especialista", [
  ["vazamentoLigar", "Evitar vazamento", "booleano", "", undefined, undefined, { padrao: false }],
  ["vazamentoVariacaoTemp", "Variação de temperatura", "numero", "°C", 0, 100, { padrao: 0 }],
  ["vazamentoPreAquecimento", "Tempo de pré-aquecimento", "numero", "s", 0, 600, { padrao: 0 }],
  ["vazamentoPassos", "Passos", "inteiro", "", 0, 20, { padrao: 0 }],
]);
grupo("multimaterial", "Avançado", NOVO, "naoAplicado", "especialista", [
  ["encaixeFeixes", "Encaixe de feixes (intertravar cores)", "booleano", "", undefined, undefined, { padrao: false }],
  ["encaixeCamadas", "Camadas do encaixe", "inteiro", "", 1, 20, { padrao: 2, visivelSe: "encaixeFeixes" }],
  ["encaixeLargura", "Largura do encaixe", "numero", "mm", 0, 10, { padrao: 0, visivelSe: "encaixeFeixes" }],
  ["encaixeProfundidade", "Profundidade do encaixe", "numero", "mm", 0, 10, { padrao: 0, visivelSe: "encaixeFeixes" }],
  ["encaixeOrientacao", "Orientação do encaixe", "lista", "", undefined, undefined, { padrao: "auto", visivelSe: "encaixeFeixes", opcoes: lista(["auto", "Automática"], ["x", "Em X"], ["y", "Em Y"]) }],
  ["cascaInterface", "Casca de interface", "booleano", "", undefined, undefined, { padrao: false }],
  ["evitarCruzarParedeTroca", "Evitar cruzar parede ao trocar", "booleano", "", undefined, undefined, { padrao: false }],
]);

// ===== Outros =====
grupo("outros", "Saia", "projeto", "motor", "simples", [["saia", "Saia", "booleano", "", undefined, undefined, { padrao: false }]]);
grupo("outros", "Saia", "processo", "motor", "avancado", [
  ["saiaDistancia", "Distância da peça", "numero", "mm", 0, 50, { visivelSe: "saia" }],
  ["vSaia", "Velocidade", "numero", "mm/s", 1, 1000, { visivelSe: "saia" }],
]);
grupo("outros", "Saia", NOVO, "naoAplicado", "avancado", [
  ["saiaVoltas", "Voltas", "inteiro", "", 1, 20, { padrao: 1, visivelSe: "saia", nota: "Hoje o motor faz uma volta (🟡)." }],
  ["saiaAltura", "Altura (camadas)", "inteiro", "", 1, 20, { padrao: 1, visivelSe: "saia" }],
  ["saiaTipo", "Tipo", "lista", "", undefined, undefined, { padrao: "combinada", visivelSe: "saia", opcoes: lista(["combinada", "Combinada"], ["porObjeto", "Por objeto"]) }],
  ["saiaFilamentoMin", "Filamento mínimo extrudado", "numero", "mm", 0, 2000, { padrao: 0, visivelSe: "saia", nivel: "especialista" }],
]);
grupo("outros", "Borda", "projeto", "motor", "simples", [["borda", "Borda (aba)", "booleano", "", undefined, undefined, { padrao: false }]]);
grupo("outros", "Borda", "processo", "motor", "avancado", [
  ["bordaLargura", "Largura", "numero", "mm", 0, 50, { visivelSe: "borda" }],
  ["bordaFolga", "Vão da borda até a peça", "numero", "mm", 0, 5, { visivelSe: "borda" }],
]);
grupo("outros", "Borda", NOVO, "naoAplicado", "avancado", [
  ["bordaTipo", "Tipo de borda", "lista", "", undefined, undefined, { padrao: "auto", visivelSe: "borda", opcoes: lista(["auto", "Automática"], ["soExterna", "Só externa"], ["soInterna", "Só interna"], ["externaEInterna", "Externa e interna"], ["pintada", "Pintada"]) }],
  ["bordaOrelhas", "Orelhas de borda", "booleano", "", undefined, undefined, { padrao: false, visivelSe: "borda" }],
]);
grupo("outros", "Modo especial", NOVO, "naoAplicado", "avancado", [
  ["sequenciaImpressao", "Sequência de impressão", "lista", "", undefined, undefined, { padrao: "porCamada", opcoes: lista(["porCamada", "Por camada"], ["porObjeto", "Por objeto"]) }],
  ["sequenciaFolga", "Folga entre objetos", "numero", "mm", 0, 100, { padrao: 0, visivelSe: "sequenciaImpressao=porObjeto" }],
  ["vasoEspiral", "Vaso em espiral", "booleano", "", undefined, undefined, { padrao: false }],
  ["peleFelpuda", "Pele felpuda", "lista", "", undefined, undefined, { padrao: "desligada", opcoes: lista(["desligada", "Desligada"], ["contorno", "Contorno"], ["contornoFuros", "Contorno e furos"], ["todasParedes", "Todas as paredes"]) }],
  ["peleEspessura", "Espessura da pele felpuda", "numero", "mm", 0, 2, { padrao: 0, visivelSe: "peleFelpuda!=desligada" }],
  ["peleDistancia", "Distância entre pontos", "numero", "mm", 0, 5, { padrao: 0, visivelSe: "peleFelpuda!=desligada" }],
  ["peleRuido", "Tipo de ruído", "lista", "", undefined, undefined, { padrao: "perlin", visivelSe: "peleFelpuda!=desligada", opcoes: lista(["perlin", "Suave"], ["aleatorio", "Aleatório"]) }],
]);
grupo("outros", "Modo especial", NOVO, "oculto", "especialista", [["timelapse", "Vídeo time-lapse", "lista", "", undefined, undefined, { padrao: "nenhum", opcoes: lista(["nenhum", "Nenhum"], ["suave", "Suave"], ["tradicional", "Tradicional"]) }]]);
grupo("outros", "Saída (só G-code)", NOVO, "oculto", "especialista", [
  ["reduzirRetracaoPreench", "Reduzir retração no preenchimento", "booleano", "", undefined, undefined, { padrao: false }],
  ["resolucaoGcode", "Resolução do G-code", "numero", "mm", 0, 1, { padrao: 0 }],
  ["numerarLinhas", "Numerar linhas", "booleano", "", undefined, undefined, { padrao: false }],
  ["excluirObjetos", "Excluir objetos", "booleano", "", undefined, undefined, { padrao: false }],
  ["rotularObjetos", "Rotular objetos", "booleano", "", undefined, undefined, { padrao: false }],
  ["formatoNomeArquivo", "Formato do nome do arquivo", "texto", "", undefined, undefined, { padrao: "" }],
  ["scriptsPos", "Scripts de pós-processamento", "texto", "", undefined, undefined, { padrao: "" }],
  ["comentarios", "Comentários", "booleano", "", undefined, undefined, { padrao: false }],
]);
grupo("outros", "Observações", "projeto", "motor", "simples", [["observacoes", "Observações do perfil", "texto", "", undefined, undefined, { padrao: "" }]]);

// ===== Impressora (⚙, §3.8) =====
grupo("impressora", "Geral", "maquina", "motor", "simples", [
  ["mesa.0", "Mesa X", "numero", "mm", 50, 1000],
  ["mesa.1", "Mesa Y", "numero", "mm", 50, 1000],
  ["alturaMax", "Altura máxima", "numero", "mm", 20, 1000],
]);
grupo("impressora", "Geral", NOVO, "naoAplicado", "simples", [
  ["bico", "Diâmetro do bico (fixo em 0,4)", "numero", "mm", 0.4, 0.4, { padrao: 0.4, nota: "Só bico de 0,4 mm (decisão do Johann, 26/11/2026)." }],
  ["areasProibidas", "Áreas proibidas", "texto", "", undefined, undefined, { padrao: "", nivel: "avancado" }],
]);
grupo("impressora", "Movimento", "maquina", "motor", "avancado", [
  ["vMax", "Velocidade máxima", "numero", "mm/s", 10, 2000],
  ["aMax", "Aceleração máxima", "numero", "mm/s²", 100, 100000],
  ["jerk", "Jerk da máquina", "numero", "mm/s", 0, 100],
  ["aceleraDesacelera", "Acelerar até desacelerar (fração, Klipper)", "percentual", "%", 0, 1, { nivel: "especialista" }],
  ["vZ", "Velocidade máxima do eixo Z", "numero", "mm/s", 1, 200],
  ["aZ", "Aceleração máxima do eixo Z", "numero", "mm/s²", 10, 100000],
]);
grupo("impressora", "Extrusor", "maquina", "motor", "avancado", [
  ["retracao", "Retração", "numero", "mm", 0, 20],
  ["vRetracao", "Velocidade de retrair", "numero", "mm/s", 1, 200],
  ["vRecuperacao", "Velocidade de voltar", "numero", "mm/s", 1, 200],
  ["retracaoMin", "Deslocamento mínimo que retrai", "numero", "mm", 0, 50],
  ["zHop", "Levantar Z ao retrair", "numero", "mm", 0, 5],
  ["zHopAcima", "Só levanta acima de", "numero", "mm", 0, 100],
  ["limpeza", "Distância de limpeza", "numero", "mm", 0, 20],
  ["vLimpeza", "Velocidade de limpeza (fração do deslocamento)", "percentual", "%", 0, 1, { nivel: "especialista" }],
]);
grupo("impressora", "Extrusor", NOVO, "naoAplicado", "especialista", [
  ["zHopTipo", "Tipo de levantamento", "lista", "", undefined, undefined, { padrao: "normal", opcoes: lista(["normal", "Normal"], ["espiral", "Espiral"], ["inclinado", "Inclinado"]) }],
  ["retracaoTrocaCamada", "Retração ao trocar de camada", "booleano", "", undefined, undefined, { padrao: true }],
]);
grupo("impressora", "Multimaterial", "maquina", "motor", "avancado", [
  ["troca.purgaMm3", "Purga por troca de cor", "numero", "mm³", 0, 5000],
  ["troca.tempoS", "Tempo de cada troca", "numero", "s", 0, 600],
  ["troca.vazaoPurga", "Vazão da purga", "numero", "mm³/s", 0.5, 50],
  ["troca.torre", "Torre de purga", "booleano", "", undefined, undefined, { nivel: "simples" }],
  ["troca.larguraTorre", "Largura da torre", "numero", "mm", 5, 100, { visivelSe: "troca.torre" }],
]);
grupo("impressora", "Preparo", "maquina", "motor", "simples", [["preparoMin", "Tempo típico de preparo", "numero", "min", 0, 60]]);
grupo("impressora", "G-code", NOVO, "oculto", "especialista", [
  ["gcodeInicio", "G-code de início", "texto", "", undefined, undefined, { padrao: "" }],
  ["gcodeFim", "G-code de fim", "texto", "", undefined, undefined, { padrao: "" }],
  ["gcodeTroca", "G-code de troca de filamento", "texto", "", undefined, undefined, { padrao: "" }],
  ["gcodeCamada", "G-code de troca de camada", "texto", "", undefined, undefined, { padrao: "" }],
]);

// ===== Filamento (⚙, §3.9) =====
grupo("filamento", "Filamento", "material", "motor", "simples", [
  ["densidade", "Densidade", "numero", "g/cm³", 0.5, 3],
  ["fluxo", "Razão de fluxo", "numero", "", 0.5, 1.5],
  ["vazaoMax", "Vazão volumétrica máxima", "numero", "mm³/s", 0.5, 60],
  ["precoKg", "Preço", "numero", "R$/kg", 0, 5000],
]);
grupo("filamento", "Filamento", NOVO, "naoAplicado", "avancado", [["diametro", "Diâmetro do filamento", "numero", "mm", 1.5, 3, { padrao: 1.75 }]]);
grupo("filamento", "Resfriamento", "material", "motor", "avancado", [
  ["tempoCamada", "Tempo mínimo de camada", "numero", "s", 0, 120],
  ["vMinResfriar", "Velocidade mínima ao desacelerar para resfriar", "numero", "mm/s", 1, 200],
]);
grupo("filamento", "Resfriamento", NOVO, "naoAplicado", "avancado", [
  ["desacelerarParaResfriar", "Desacelerar para resfriar", "booleano", "", undefined, undefined, { padrao: true }],
  ["limiteTempoCamada", "Limite de tempo de camada", "numero", "s", 0, 300, { padrao: 0 }],
]);
grupo("filamento", "Multimaterial", NOVO, "naoAplicado", "especialista", [
  ["cargaFilamento", "Volume de carga", "numero", "mm³", 0, 1000, { padrao: 0 }],
  ["descargaFilamento", "Volume de descarga", "numero", "mm³", 0, 1000, { padrao: 0 }],
  ["ramming", "Ramming", "booleano", "", undefined, undefined, { padrao: false }],
]);
// ⚪/⛔ do filamento: só guardam o valor (importação de perfis); nunca aparecem na tela
grupo("filamento", "Temperaturas e ventoinhas (só G-code)", NOVO, "oculto", "especialista", [
  ["tempBico", "Temperatura do bico", "numero", "°C", 0, 500, { padrao: 0 }],
  ["tempBicoPrimeira", "Temperatura do bico na 1ª camada", "numero", "°C", 0, 500, { padrao: 0 }],
  ["tempMesa", "Temperatura da mesa", "numero", "°C", 0, 200, { padrao: 0 }],
  ["tempMesaPrimeira", "Temperatura da mesa na 1ª camada", "numero", "°C", 0, 200, { padrao: 0 }],
  ["ventoinhaMin", "Ventoinha da peça (mínimo)", "percentual", "%", 0, 1, { padrao: 0 }],
  ["ventoinhaMax", "Ventoinha da peça (máximo)", "percentual", "%", 0, 1, { padrao: 0 }],
  ["ventoinhaPrimeira", "Ventoinha na 1ª camada", "percentual", "%", 0, 1, { padrao: 0 }],
  ["avancoPressao", "Avanço de pressão", "numero", "", 0, 5, { padrao: 0 }],
  ["encolhimento", "Encolhimento", "percentual", "%", 0, 1, { padrao: 0 }],
  ["gcodeFilamento", "G-code do filamento", "texto", "", undefined, undefined, { padrao: "" }],
]);

/** A tabela inteira (somente leitura). */
export const ESQUEMA: readonly Campo[] = CAMPOS;
export const ABAS_PROCESSO: Aba[] = ["qualidade", "resistencia", "velocidade", "suporte", "multimaterial", "outros"];
export const NOMES_ABAS: Record<Aba, string> = {
  qualidade: "Qualidade", resistencia: "Resistência", velocidade: "Velocidade", suporte: "Suporte", multimaterial: "Multimaterial", outros: "Outros", impressora: "Impressora", filamento: "Filamento",
};

const POR_ID = new Map(CAMPOS.map((c) => [c.id, c]));
export const campoDe = (id: string) => POR_ID.get(id);

/** Campos que a tela mostra: os ocultos (⚪/⛔) nunca aparecem, nem na busca. */
export const camposVisiveis = (aba?: Aba) => CAMPOS.filter((c) => c.estado !== "oculto" && (!aba || c.aba === aba));

/** Campos do processo (as seis abas), de fábrica na ordem da tela. */
export const camposDoProcesso = () => CAMPOS.filter((c) => c.origem !== "maquina" && c.origem !== "material" && !["impressora", "filamento"].includes(c.aba));

/** Avalia o "visível se" de um campo sobre os valores atuais. Sem condição = visível. */
export function visivelAgora(c: Campo, valores: Plano): boolean {
  const cond = c.visivelSe;
  if (!cond) return true;
  const m = /^([^!=]+)(!?=)(.+)$/.exec(cond);
  if (!m) return !!valores[cond];
  const v = String(valores[m[1]]);
  return m[2] === "=" ? v === m[3] : v !== m[3];
}

/** Valor sugerido do campo (só para os que não vêm do perfil de fábrica); undefined = vem do `Processo`/`Maquina`/`Material`. */
export const valorNeutro = (c: Campo): Valor | undefined => c.padrao;

/** Confere se um valor cabe no campo (tipo, lista e limites). */
export function valorValido(c: Campo, v: unknown): boolean {
  switch (c.tipo) {
    case "booleano": return typeof v === "boolean";
    case "texto": return typeof v === "string";
    case "lista": return typeof v === "string" && !!c.opcoes?.some(([o]) => o === v);
    case "padrao": return typeof v === "string" && v in NOMES_PADROES;
    case "inteiro": if (!Number.isInteger(v)) return false; // cai no limite abaixo
    // eslint-disable-next-line no-fallthrough
    default: return typeof v === "number" && Number.isFinite(v) && (c.min === undefined || v >= c.min - 1e-9) && (c.max === undefined || v <= c.max + 1e-9);
  }
}

// Tipos usados só para o teste e para quem precisar listar as chaves reais
export type ChavesMaquina = Omit<Maquina, "processo" | "materiais" | "id" | "marca" | "modelo">;
export type ChavesMaterial = Omit<Material, "id" | "nome">;
export type { Processo };
