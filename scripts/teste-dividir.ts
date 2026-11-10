// Teste do fluxo Dividir → escolher regiões → Mover corpo → esboço na face do corte (Converter
// entidades) → Extrusão "até a superfície" com mesclar → um corpo só (docs/funcional/features.md §13).
// Peça em "S" sintética: o Plano Lateral (x = 0) cruza as três barras do S = 4 regiões.
import opencascade from "replicad-opencascadejs";
import { setOC } from "replicad";
import { createRequire } from "node:module";
import {
  documentoImportado, novaFeature, novoEsboco, type Feature, type FeatureDividir, type FeatureEsboco, type FeatureExtrusao,
  type FeatureMoverCorpo, type Referencia, type Vec3,
} from "../src/model";
import { casarRegioes, regenerar } from "../src/kernel/regenerar";
import { criarExterna, projetar } from "../src/esboco/externas";
import { eixoXParaNormal, referencial } from "../src/esboco/referencial";
import * as op from "../src/esboco/operacoes";

const require = createRequire(import.meta.url);
setOC(await (opencascade as any)({ locateFile: () => require.resolve("replicad-opencascadejs/wasm") })); // eslint-disable-line @typescript-eslint/no-explicit-any

let falhas = 0;
function confere(nome: string, obtido: number | null | undefined, esperado: number, tol = 1e-3) {
  const v = obtido ?? NaN;
  const ok = Math.abs(v - esperado) <= tol * Math.max(1, Math.abs(esperado));
  if (!ok) falhas++;
  console.log(`${ok ? "ok  " : "FALHA"} ${nome}: ${v.toFixed(2)} (esperado ${esperado.toFixed(2)})`);
}
function verdade(nome: string, v: boolean) {
  if (!v) falhas++;
  console.log(`${v ? "ok  " : "FALHA"} ${nome}`);
}
function semErros(nome: string, r: ReturnType<typeof regenerar>) {
  const ok = !r.erros.length;
  if (!ok) falhas++;
  console.log(`${ok ? "ok  " : "FALHA"} ${nome}${ok ? "" : `: ${r.erros.map((e) => e.mensagem).join(" | ")}`}`);
}

// ---------- casar regiões por assinatura (puro) ----------
{
  const calc = [{ centro: [0, 0, 0] as Vec3, volume: 1000 }, { centro: [50, 0, 0] as Vec3, volume: 1000 }];
  verdade("sem lista guardada: todas separadas", casarRegioes(calc, undefined).every((x) => x));
  const salvas = [{ centro: [50.3, 0, 0] as Vec3, volume: 1010, separar: false }, { centro: [0, 0.2, 0] as Vec3, volume: 990, separar: true }];
  verdade("casa pela região mais parecida (ordem trocada)", JSON.stringify(casarRegioes(calc, salvas)) === "[true,false]");
  verdade("região longe demais não casa (fica separada)", casarRegioes(calc, [{ centro: [500, 0, 0], volume: 1000, separar: false }]).every((x) => x));
}

// ---------- o "S": 3 barras 10 mm de espessura, conectores alternados, 10 mm de altura ----------
// área 2 400 mm² → volume 24 000 mm³. Plano x = 0 corta as 3 barras: regiões de 3 000, 9 000, 9 000, 3 000.
const s = novoEsboco(1, { tipo: "plano", plano: "XY", deslocamento: 0 });
{
  const v: [number, number][] = [[-30, 0], [40, 0], [40, 30], [-30, 30], [-30, 40], [30, 40], [30, 50], [-40, 50], [-40, 20], [30, 20], [30, 10], [-30, 10]];
  const pts = v.map(([x, y]) => op.ponto(s, { x, y }));
  pts.forEach((p, i) => op.linha(s, p, pts[(i + 1) % pts.length]));
}
const extS: FeatureExtrusao = { ...(novaFeature("extrusao", 1) as FeatureExtrusao), esboco: s.id, profundidade: 10 };
const div = { ...(novaFeature("dividir", 1) as FeatureDividir), ferramentas: [{ tipo: "plano", id: "YZ" } as Referencia] };
confere("S inteiro: volume", regenerar([s, extS]).volume, 24000);

// 1) dividir sem escolher: 4 regiões, cada uma um corpo; a prévia lista as regiões com malha
const r1 = regenerar([s, extS, div], 0.05, { previa: div.id });
semErros("dividir o S pelo Plano Lateral", r1);
verdade("o plano cruza o S 3 vezes: 4 regiões na lista", r1.regioes?.length === 4);
verdade("regiões de 3 000 / 9 000 / 9 000 / 3 000 mm³", JSON.stringify(r1.regioes?.map((r) => Math.round(r.volume)).sort((a, b) => a - b)) === "[3000,3000,9000,9000]");
verdade("cada região tem malha para o destaque", !!r1.regioes?.every((r) => r.malha.triangulos.length > 0));
verdade("sem escolha: 4 corpos separados", r1.corpos?.length === 4);
verdade("fora da prévia o kernel não gera a lista", regenerar([s, extS, div]).regioes === undefined);

// 2) só a ponta de cima à direita (x 0…30, y 40…50) vira corpo; as outras 3 voltam a se unir
const ponta = r1.regioes!.find((r) => r.centro[0] > 0 && r.centro[1] > 40)!;
div.regioes = r1.regioes!.map((r) => ({ centro: r.centro, volume: r.volume, separar: r === ponta }));
const r2 = regenerar([s, extS, div]);
semErros("dividir com as regiões escolhidas", r2);
verdade("2 corpos: 21 000 (juntas) + 3 000 (separada)", r2.corpos?.length === 2 && JSON.stringify(r2.corpos.map((c) => Math.round(c.volume)).sort((a, b) => a - b)) === "[3000,21000]");
confere("volume total igual ao do S", r2.volume, 24000);

// a escolha é reaplicada ao reconstruir mesmo com a peça um pouco diferente (altura 10 → 12)
const extS12 = { ...extS, profundidade: 12 };
const r2b = regenerar([s, extS12, div]);
verdade("reconstruir com altura 12: a escolha continua (2 corpos)", r2b.corpos?.length === 2 && JSON.stringify(r2b.corpos.map((c) => Math.round(c.volume)).sort((a, b) => a - b)) === "[3600,25200]");

// 3) mover a ponta separada 5 mm em +X
const corpoPonta = r2.corpos!.find((c) => Math.abs(c.volume - 3000) < 1)!;
const mover: FeatureMoverCorpo = {
  ...(novaFeature("moverCorpo", 1) as FeatureMoverCorpo), corpos: [{ tipo: "corpo", centro: corpoPonta.centro, volume: corpoPonta.volume }], dx: 5,
};
const base: Feature[] = [s, extS, div, mover];
const r3 = regenerar(base);
semErros("mover a ponta 5 mm", r3);
verdade("continuam 2 corpos, com folga de 5 mm", r3.corpos?.length === 2);

// 4) esboço na face do corte da ponta (x = 5, normal −X) e Converter entidades com a face inteira
const topo = r3.topologia!;
const iFace = topo.faces.findIndex((f) => f.normal && f.normal[0] < -0.999 && Math.abs(f.centro[0] - 5) < 1e-6 && f.centro[1] > 40);
verdade("face do corte da ponta encontrada", iFace >= 0);
const fa = topo.faces[iFace];
const n = fa.normal!;
const k = -(n[0] * fa.centro[0] + n[1] * fa.centro[1] + n[2] * fa.centro[2]);
const origem: Vec3 = [-n[0] * k, -n[1] * k, -n[2] * k]; // origem da peça projetada no plano da face
const esb: FeatureEsboco = novoEsboco(2, { tipo: "face", origem, normal: n, eixoX: eixoXParaNormal(n), face: fa });
const ref = referencial(esb.suporte);
let convertidas = 0;
for (const ia of topo.arestasDaFace![iFace]) {
  const r: Referencia = { tipo: "aresta", ass: topo.arestas[ia] };
  const proj = projetar(r, ref);
  if (!proj || proj.tipo === "ponto") continue;
  delete criarExterna(esb, proj, r).construcao;
  convertidas++;
}
verdade("face do corte convertida: contorno de 4 linhas no esboço", convertidas === 4);

// 5) extrusão até a face do corte do outro corpo (x = 0, normal +X), mesclar → um corpo só
const alvo = topo.faces.find((f) => f.normal && f.normal[0] > 0.999 && Math.abs(f.centro[0]) < 1e-6 && f.centro[1] > 40);
verdade("face do corte do outro corpo encontrada", !!alvo);
const ponte: FeatureExtrusao = {
  ...(novaFeature("extrusao", 2) as FeatureExtrusao), esboco: esb.id, profundidade: 1,
  condicao: { tipo: "superficie", dist: 0, ref: { tipo: "face", ass: alvo! } },
};
const r5 = regenerar([...base, esb, ponte]);
semErros("extrusão até a superfície do outro corpo", r5);
verdade("mesclar uniu os dois corpos: 1 corpo", r5.corpos?.length === 1);
confere("volume = S + ponte de 5 × 10 × 10", r5.volume, 24000 + 500);

// ---------- STL: corpo de malha não se corta (pede converter); sólido do STL divide ----------
{
  const L = 10, W = 60; // barra 60 × 10 × 10 em STL binário (12 triângulos)
  const p = (x: number, y: number, z: number): Vec3 => [x, y, z];
  const v = [p(-W / 2, 0, 0), p(W / 2, 0, 0), p(W / 2, L, 0), p(-W / 2, L, 0), p(-W / 2, 0, L), p(W / 2, 0, L), p(W / 2, L, L), p(-W / 2, L, L)];
  const tris = [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]];
  const buf = new ArrayBuffer(84 + 50 * tris.length);
  const dv = new DataView(buf);
  dv.setUint32(80, tris.length, true);
  tris.forEach((t, i) => t.forEach((iv, j) => v[iv].forEach((c, e) => dv.setFloat32(84 + 50 * i + 12 + 12 * j + 4 * e, c, true))));
  const bytes = new Uint8Array(buf);
  const solido = documentoImportado("barra.stl", bytes).features[0];
  const divB = { ...(novaFeature("dividir", 2) as FeatureDividir), ferramentas: [{ tipo: "plano", id: "YZ" } as Referencia] };
  const rs = regenerar([solido, divB]);
  semErros("STL sólido: dividir", rs);
  verdade("STL sólido dividido em 2 corpos de 3 000", rs.corpos?.length === 2 && rs.corpos.every((c) => Math.abs(c.volume - 3000) < 1));
  const malha = { ...solido, malha: true } as Feature;
  const rm = regenerar([malha, divB]);
  verdade("corpo de malha: erro pedindo converter em sólido", rm.erros.some((e) => e.id === divB.id && /Converta a malha em sólido/.test(e.mensagem)));
}

console.log(falhas ? `\n${falhas} falha(s)` : "\nDividir: tudo certo");
process.exit(falhas ? 1 : 0);
