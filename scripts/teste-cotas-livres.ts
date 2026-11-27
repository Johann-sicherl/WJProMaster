// Reorganizar o desenho da cota (pedido do Johann, 27/11/2026: "organizar as cotas dentro do esboço é quase
// impossível; depois de inseridas ficam muito rígidas"). O arrasto do número e da linha de cota só mexe em
// `texto` (posição visual guardada na cota): valor, geometria e solução do solver nunca mudam. No arrasto
// livre não há afastamento mínimo nem centralização forçada; só um ímã curto nos múltiplos do passo.
import { novoEsboco, ehCota, type CotaEsboco, type FeatureEsboco } from "../src/model";
import { SolverEsboco } from "../src/esboco/solver";
import * as op from "../src/esboco/operacoes";
import { ORIGEM, dist, type P2 } from "../src/esboco/geometria";
import { ajustarTextoCota, desenharCota, LIMITE_IMA_PX, medirCota, moverLinhaCota, PASSO_COTA_PX } from "../src/esboco/cotas";

const solver = await SolverEsboco.criar();
let falhas = 0;
function verdade(nome: string, v: boolean, extra = "") {
  if (!v) falhas++;
  console.log(`${v ? "ok  " : "FALHA"} ${nome}${!v && extra ? ` — ${extra}` : ""}`);
}
const perto = (a: number, b: number, tol = 1e-6) => Math.abs(a - b) <= tol;
const MM_PX = 0.2; // 0,2 mm por pixel: 1 passo = 5,2 mm

// retângulo 60 × 40 com furo Ø20 e uma linha inclinada (cota angular com a base)
const e: FeatureEsboco = novoEsboco(1, { tipo: "plano", plano: "XY", deslocamento: 0 });
const a = op.ponto(e, { x: 0, y: 0 }), c = op.ponto(e, { x: 60, y: 40 });
const [l1, l2] = op.retangulo(e, a, c);
op.restringir(e, { tipo: "coincidente", a, b: ORIGEM });
const cc = op.ponto(e, { x: 30, y: 20 });
const furo = op.circulo(e, cc, 10);
const inc = op.linha(e, op.ponto(e, { x: 70, y: 0 }), op.ponto(e, { x: 90, y: 20 }));
const cotas: CotaEsboco[] = [
  op.restringir(e, { tipo: "distancia", a: l1.id, valor: 60 }) as CotaEsboco,
  op.restringir(e, { tipo: "distancia", a: l2.id, valor: 40 }) as CotaEsboco,
  op.restringir(e, { tipo: "diametro", a: furo.id, valor: 20 }) as CotaEsboco,
  op.restringir(e, { tipo: "distanciaH", a, b: cc, valor: 30 }) as CotaEsboco,
  op.restringir(e, { tipo: "distanciaV", a, b: cc, valor: 20 }) as CotaEsboco,
  op.restringir(e, { tipo: "angulo", a: l1.id, b: inc.id, valor: 45 }) as CotaEsboco,
];
solver.resolver(e);
const todas = e.restricoes.filter(ehCota);
verdade("esboço de teste com 6 cotas de tipos diferentes", todas.length === 6);

const fotoGeo = () => JSON.stringify({ pontos: e.pontos, geos: e.geos, valores: todas.map((k) => [k.id, k.valor, medirCota(k, e)]) });
const antes = fotoGeo();

// 1. Texto perto da linha (8 px): no arrasto livre fica onde foi solto; ao criar continua em 1 passo
{
  const k = todas[0]; // base, de (0,0) a (60,0)
  const local: P2 = { x: 25, y: -8 * MM_PX };
  const livre = ajustarTextoCota(k, e, local, MM_PX, true);
  verdade("livre: texto a 8 px da linha fica a 8 px (sem salto para 26 px)", perto(livre.y, -8 * MM_PX, 1e-9), `y=${livre.y}`);
  verdade("livre: posição ao longo da linha fica onde foi solta (x = 25)", perto(livre.x, 25, 1e-9), `x=${livre.x}`);
  const novo = ajustarTextoCota(k, e, local, MM_PX, false);
  verdade("ao criar: o distanciador continua (mínimo de 1 passo, centrado)", perto(novo.y, -PASSO_COTA_PX * MM_PX, 1e-9) && perto(novo.x, 30, 1e-9), JSON.stringify(novo));
  // ímã: a 3 px de 2 passos grudam; a 12 px de 2 passos ficam livres
  const dentro = ajustarTextoCota(k, e, { x: 25, y: -(2 * PASSO_COTA_PX + 3) * MM_PX }, MM_PX, true);
  verdade(`ímã de ${LIMITE_IMA_PX} px: a 3 px do 2º passo gruda nele`, perto(dentro.y, -2 * PASSO_COTA_PX * MM_PX, 1e-9), `y=${dentro.y}`);
  const fora = ajustarTextoCota(k, e, { x: 25, y: -(2 * PASSO_COTA_PX + 12) * MM_PX }, MM_PX, true);
  verdade("fora do ímã (12 px) a posição fica livre", perto(fora.y, -(2 * PASSO_COTA_PX + 12) * MM_PX, 1e-9), `y=${fora.y}`);
  const centro = ajustarTextoCota(k, e, { x: 30 + 3 * MM_PX, y: -10 * MM_PX }, MM_PX, true);
  verdade("ímã do centro: a 3 px do meio o número centraliza", perto(centro.x, 30, 1e-9), `x=${centro.x}`);
  const lado = ajustarTextoCota(k, e, { x: 30 + 30 * MM_PX, y: -10 * MM_PX }, MM_PX, true);
  verdade("a 30 px do meio o número fica onde foi posto (livre ao longo)", perto(lado.x, 30 + 30 * MM_PX, 1e-9), `x=${lado.x}`);
}

// 2. Arrastar a linha de cota: só o afastamento muda; o número fica na mesma posição ao longo dela
{
  const k = todas[0];
  k.texto = { x: 40, y: -10 };
  const T0 = desenharCota(k, e, MM_PX)!.texto;
  const T = moverLinhaCota(k, e, { x: 5, y: -17 }, T0, MM_PX); // dedo longe do número, em x = 5
  verdade("linha alinhada: afastamento segue o dedo (y = −17) e o número fica em x = 40", perto(T.y, -17, 1e-9) && perto(T.x, 40, 1e-9), JSON.stringify(T));
  const kH = todas[3];
  kH.texto = { x: 15, y: 30 };
  const H = moverLinhaCota(kH, e, { x: 99, y: 37 }, { x: 15, y: 30 }, MM_PX);
  verdade("cota horizontal: só o y muda", perto(H.x, 15, 1e-9) && perto(H.y, 37, 1e-9), JSON.stringify(H));
  const kV = todas[4];
  kV.texto = { x: 40, y: 10 };
  const V = moverLinhaCota(kV, e, { x: 47, y: -5 }, { x: 40, y: 10 }, MM_PX);
  verdade("cota vertical: só o x muda", perto(V.x, 47, 1e-9) && perto(V.y, 10, 1e-9), JSON.stringify(V));
  // diâmetro: o ângulo do texto em volta do centro fica; a distância ao centro segue o dedo
  const kD = todas[2];
  kD.texto = { x: 30 + 20 * Math.cos(0.6), y: 20 + 20 * Math.sin(0.6) };
  const D = moverLinhaCota(kD, e, { x: 30 + 32, y: 20 }, kD.texto, MM_PX);
  const angD = Math.atan2(D.y - 20, D.x - 30);
  verdade("diâmetro: o ângulo do texto não muda; a distância ao centro segue o dedo", perto(angD, 0.6, 1e-6) && perto(dist(D, { x: 30, y: 20 }), 32, 1e-6), `ang=${angD}`);
}

// 3. Todas as cotas: arrastar número e linha só mexe em `texto` (valor, geometria e solução intactos)
{
  const alvos: P2[] = [{ x: 12, y: -9 }, { x: 70, y: 33 }, { x: 3, y: 3 }, { x: -20, y: 55 }, { x: 40, y: 10 }];
  for (const k of todas) {
    const T0 = desenharCota(k, e, MM_PX)!.texto;
    for (const p of alvos) {
      k.texto = ajustarTextoCota(k, e, p, MM_PX, true);
      k.texto = moverLinhaCota(k, e, p, k.texto, MM_PX);
    }
    verdade(`cota ${k.tipo}: depois de arrastar, o texto mudou de lugar (${T0.x.toFixed(1)},${T0.y.toFixed(1)} → ${k.texto!.x.toFixed(1)},${k.texto!.y.toFixed(1)})`, !!k.texto && Number.isFinite(k.texto.x) && Number.isFinite(k.texto.y) && dist(k.texto, T0) > 1e-3);
    verdade(`cota ${k.tipo}: ainda desenha (linha de cota e número)`, !!desenharCota(k, e, MM_PX));
  }
  verdade("valores, pontos e geometria intactos depois de reorganizar todas as cotas", fotoGeo() === antes);
  const r = solver.resolver(e);
  verdade("resolver depois de reorganizar: nenhum conflito e nenhum ponto andou", r.conflitantes.length === 0 && fotoGeo() === antes, JSON.stringify(r.conflitantes));
}

// 4. Guardado e reaberto: o deslocamento sobrevive ao salvar (JSON) sem alterar nada além de `texto`
{
  const copia = JSON.parse(JSON.stringify(e)) as FeatureEsboco;
  const txt = (f: FeatureEsboco) => JSON.stringify(f.restricoes.filter(ehCota).map((k) => [k.id, k.texto]));
  verdade("o deslocamento das 6 cotas volta igual do arquivo salvo", txt(copia) === txt(e));
  const k = todas[1];
  const guardado = { ...k.texto! };
  k.texto = undefined; // Esc/cancelar: volta ao que havia antes do arrasto
  k.texto = guardado;
  verdade("Esc/cancelar: restaurar o texto guardado devolve a posição de antes", dist(k.texto, guardado) === 0);
}

console.log(falhas ? `${falhas} FALHA(S)` : "cotas livres: tudo certo");
process.exit(falhas ? 1 : 0);
