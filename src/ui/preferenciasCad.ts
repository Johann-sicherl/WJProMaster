// Preferências do WJCAD (Peça, Montagem e Desenho) guardadas neste aparelho em `jlscad:interface`.
// Módulo puro (sem DOM no topo): a tela de Configurações, a vista 3D e a folha do Desenho leem daqui,
// e o teste em Node (`scripts/teste-configuracoes.ts`) confere as contas do zoom da roda.

export const CHAVE_PREFS_CAD = "jlscad:interface";
export type Dispositivo = "celular" | "tablet" | "computador";

/** Campos comuns aos três ambientes (a Peça guarda outros só dela na mesma chave). */
export interface PrefsCad {
  dispositivo?: Dispositivo;
  /** Toque longo (caneta/dedo parado) abre o menu de contexto: tempo em ms (0 = desligado). */
  toqueLongoMs?: number;
  /** Comandos com caixa flutuante perto da peça (padrão: celular e tablet). */
  caixaFlutuante?: boolean;
  estilo?: string;
  /** Esboço em escala real 1:1. */
  escalaReal?: boolean;
  /** Sentido da roda: true = rolar para a frente afasta (padrão: rolar para a frente aproxima). */
  rodaFrenteAfasta?: boolean;
  /** Passo do zoom por clique da roda, em % (padrão 5 %, faixa 2–50 %). */
  passoZoom?: number;
}

export const PASSO_ZOOM_PADRAO = 5;
export const PASSO_ZOOM_MIN = 2;
export const PASSO_ZOOM_MAX = 50;
/** Um clique da roda do mouse = 100 px de `deltaY` (Chrome/Edge); o touchpad manda frações disso. */
export const DELTA_CLIQUE = 100;

export function lerPrefsCad(): PrefsCad {
  try {
    const p = JSON.parse(localStorage.getItem(CHAVE_PREFS_CAD) ?? "{}");
    return p && typeof p === "object" ? p : {};
  } catch {
    return {};
  }
}

/** Junta `mudancas` ao que está guardado (sem apagar os campos que só a Peça usa). */
export function gravarPrefsCad(mudancas: Partial<PrefsCad>): PrefsCad {
  const p = { ...lerPrefsCad(), ...mudancas };
  try {
    localStorage.setItem(CHAVE_PREFS_CAD, JSON.stringify(p));
  } catch {
    /* armazenamento indisponível */
  }
  return p;
}

/** Outra janela (Peça, Montagem ou Desenho) mudou as preferências: chama `f` com o valor novo. */
export function aoMudarPrefsCad(f: (p: PrefsCad) => void) {
  window.addEventListener("storage", (e) => {
    if (e.key === CHAVE_PREFS_CAD) f(lerPrefsCad());
  });
}

/** Passo do zoom em %, dentro da faixa (valor inválido = padrão). */
export function passoZoom(p: PrefsCad): number {
  const v = Number(p.passoZoom);
  if (!Number.isFinite(v) || v <= 0) return PASSO_ZOOM_PADRAO;
  return Math.min(PASSO_ZOOM_MAX, Math.max(PASSO_ZOOM_MIN, Math.round(v)));
}

/** `deltaY` em pixels (o modo linha vale 16 px e o modo página 100 px, como na vista 3D). */
export function deltaEmPixels(deltaY: number, deltaMode = 0): number {
  return deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 100 : deltaY;
}

/**
 * Quanto a vista amplia num evento da roda (> 1 aproxima, < 1 afasta). Um clique (100 px) afasta
 * `passo` % e aproximar desfaz exatamente o afastar. `pinca` (Ctrl + roda = pinça do touchpad)
 * mantém o sentido natural do gesto, mesmo com a roda invertida.
 */
export function ampliacaoDaRoda(deltaY: number, p: PrefsCad, deltaMode = 0, pinca = false): number {
  const d = deltaEmPixels(deltaY, deltaMode);
  if (!d) return 1;
  const k = Math.pow(1 - passoZoom(p) / 100, Math.abs(d) / DELTA_CLIQUE);
  const frente = d < 0; // roda para a frente (para longe de quem usa) = deltaY negativo
  const aproxima = p.rodaFrenteAfasta && !pinca ? !frente : frente;
  return aproxima ? 1 / k : k;
}

/**
 * Velocidade do zoom da vista 3D (`OrbitControls.zoomSpeed`): ela afasta 0,95^(velocidade) a cada
 * 100 px de roda; escolhida para afastar exatamente `passo` %. 5 % = 1 (o comportamento de antes).
 */
export function velocidadeZoom3D(p: PrefsCad): number {
  return Math.log(1 - passoZoom(p) / 100) / Math.log(0.95);
}
