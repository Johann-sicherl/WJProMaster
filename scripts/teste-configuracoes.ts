// Teste das preferências do WJCAD em Node (Configurações → Mouse e zoom): passo do zoom por clique,
// sentido da roda, pinça do touchpad, modos de deltaY e a velocidade equivalente da vista 3D
// (OrbitControls: afasta 0,95^velocidade a cada 100 px de roda).
import {
  ampliacaoDaRoda, deltaEmPixels, passoZoom, velocidadeZoom3D, PASSO_ZOOM_MAX, PASSO_ZOOM_MIN, PASSO_ZOOM_PADRAO,
} from "../src/ui/preferenciasCad";

let falhas = 0;
function igual(nome: string, obtido: unknown, esperado: unknown, tol = 1e-9) {
  const ok = typeof esperado === "number" && typeof obtido === "number" ? Math.abs(obtido - esperado) <= tol * Math.max(1, Math.abs(esperado)) : String(obtido) === String(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "ok  " : "FALHA"} ${nome}: ${String(obtido)}${ok ? "" : ` (esperado ${String(esperado)})`}`);
}

// --- passo: padrão, faixa e valores inválidos ---
igual("passo padrão", passoZoom({}), 5);
igual("constante do padrão", PASSO_ZOOM_PADRAO, 5);
igual("passo 12 %", passoZoom({ passoZoom: 12 }), 12);
igual("passo abaixo da faixa vai para o mínimo", passoZoom({ passoZoom: 1 }), PASSO_ZOOM_MIN);
igual("passo acima da faixa vai para o máximo", passoZoom({ passoZoom: 90 }), PASSO_ZOOM_MAX);
igual("passo arredondado", passoZoom({ passoZoom: 7.6 }), 8);
igual("passo inválido = padrão", passoZoom({ passoZoom: NaN }), 5);
igual("passo zero = padrão", passoZoom({ passoZoom: 0 }), 5);
igual("passo texto inválido = padrão", passoZoom({ passoZoom: "abc" as unknown as number }), 5);

// --- vista 3D: o padrão é exatamente o comportamento de antes (velocidade 1) ---
igual("velocidade 3D no padrão = 1", velocidadeZoom3D({}), 1);
for (const p of [2, 10, 25, 50]) {
  const v = velocidadeZoom3D({ passoZoom: p });
  igual(`vista 3D afasta ${p} % por clique`, 1 - Math.pow(0.95, v), p / 100);
}

// --- sentido da roda (deltaY < 0 = rolar para a frente) ---
const k5 = 1 / 0.95;
igual("padrão: frente aproxima 5 %", ampliacaoDaRoda(-100, {}), k5);
igual("padrão: trás afasta 5 %", ampliacaoDaRoda(100, {}), 0.95);
igual("invertida: frente afasta", ampliacaoDaRoda(-100, { rodaFrenteAfasta: true }), 0.95);
igual("invertida: trás aproxima", ampliacaoDaRoda(100, { rodaFrenteAfasta: true }), k5);
igual("pinça do touchpad mantém o sentido natural", ampliacaoDaRoda(-100, { rodaFrenteAfasta: true }, 0, true), k5);
igual("aproximar e afastar se desfazem", ampliacaoDaRoda(-100, { passoZoom: 20 }) * ampliacaoDaRoda(100, { passoZoom: 20 }), 1);
igual("passo 20 %: trás afasta 20 %", ampliacaoDaRoda(100, { passoZoom: 20 }), 0.8);
igual("sem movimento = sem zoom", ampliacaoDaRoda(0, {}), 1);

// --- touchpad (frações de clique) e modos de deltaY ---
igual("meio clique = metade do passo (em escala logarítmica)", ampliacaoDaRoda(50, {}) ** 2, 0.95);
igual("dois cliques num evento = passo duas vezes", ampliacaoDaRoda(200, {}), 0.95 ** 2);
igual("modo linha: 3 linhas = 48 px", deltaEmPixels(3, 1), 48);
igual("modo página: 1 página = 100 px", deltaEmPixels(1, 2), 100);
igual("modo pixel fica como está", deltaEmPixels(-120, 0), -120);
igual("modo página: 1 página = 1 clique", ampliacaoDaRoda(1, {}, 2), 0.95);

console.log(falhas ? `\n${falhas} falha(s)` : "\nPreferências do WJCAD (mouse e zoom): tudo certo");
if (falhas) process.exit(1);
