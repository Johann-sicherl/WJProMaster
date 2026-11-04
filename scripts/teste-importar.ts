// Teste da importação de montagem STEP: gera no próprio teste um STEP de montagem (conjunto com
// peça repetida, peça girada e submontagem), lê no kernel (src/kernel/importar.ts), monta o .wjasm
// (src/montagem/step.ts) e confere nomes, quantidades, posições e volumes de cada peça.
import opencascade from "replicad-opencascadejs";
import { getOC, makeBox, makeCylinder, setOC } from "replicad";
import { createRequire } from "node:module";
import { lerMontagemStep } from "../src/kernel/importar";
import { contarTriangulosStl, LIMITE_TRIANGULOS_SOLIDO, malhaDoStl, triangulosVaziosStl } from "../src/kernel/stl";
import { assinaturaDados, documentoImportado, LIMITE_DADOS_UMA_VEZ, PREFIXO_ENVIADO } from "../src/model";
import { regenerar, temDadosDe } from "../src/kernel/regenerar";
import { massa } from "../src/kernel/avaliar";
import { montagemDoStep, nomesDosCorpos, pecasDoStep, textoStep } from "../src/montagem/step";
import { aplicarPonto, quantidades, validarMontagem } from "../src/montagem/modelo";

const require = createRequire(import.meta.url);
setOC(await (opencascade as any)({ locateFile: () => require.resolve("replicad-opencascadejs/wasm") })); // eslint-disable-line @typescript-eslint/no-explicit-any

let falhas = 0;
function igual(nome: string, obtido: unknown, esperado: unknown) {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "ok  " : "FALHA"} ${nome}: ${JSON.stringify(obtido)}${ok ? "" : ` (esperado ${JSON.stringify(esperado)})`}`);
}
function verdade(nome: string, v: boolean) {
  if (!v) falhas++;
  console.log(`${v ? "ok  " : "FALHA"} ${nome}`);
}
const r = (v: number[]) => v.map((x) => Math.round(x * 1000) / 1000 + 0);

// ---------- textos do STEP ----------
igual("escapes de texto do STEP", [textoStep("Pino \\X2\\00D8\\X0\\10"), textoStep("D''Avila"), textoStep("a\\X\\E7o"), textoStep("\\X4\\0001F600\\X0\\")], ["Pino Ø10", "D'Avila", "aço", "😀"]);
igual("nomes casados pela quantidade quando a ordem difere", nomesDosCorpos([{ nome: "A", n: 1 }, { nome: "B", n: 3 }], [{ n: 3 }, { n: 1 }]), ["B", "A"]);
igual("quantidades ambíguas: nomes genéricos (nunca o nome errado)", nomesDosCorpos([{ nome: "A", n: 2 }, { nome: "B", n: 2 }], [{ n: 2 }, { n: 1 }]), ["Peça1", "Peça2"]);

// ---------- STEP de montagem gerado aqui ----------
function stepDeMontagem(): Uint8Array {
  const oc = getOC() as never as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const nomear = (l: unknown, n: string) => oc.TDataStd_Name.Set(l, new oc.TCollection_ExtendedString(n, true));
  const loc = (x: number, y: number, z: number, ang = 0) => {
    const t = new oc.gp_Trsf();
    t.SetTranslation(new oc.gp_Vec(x, y, z));
    if (ang) {
      const g = new oc.gp_Trsf();
      g.SetRotation(new oc.gp_Ax1(new oc.gp_Pnt(0, 0, 0), new oc.gp_Dir(1, 0, 0)), (ang * Math.PI) / 180);
      t.Multiply(g);
    }
    return new oc.TopLoc_Location(t);
  };
  const doc = new oc.TDocStd_Document(new oc.TCollection_ExtendedString("XmlOcaf", true));
  oc.XCAFDoc_ShapeTool.SetAutoNaming(false);
  const tool = oc.XCAFDoc_DocumentTool.ShapeTool(doc.Main());
  const base = tool.AddShape(makeBox([0, 0, 0], [100, 10, 60]).wrapped, false, true);
  nomear(base, "Base");
  const pino = tool.AddShape(makeCylinder(5, 30, [0, 0, 0], [0, 1, 0]).wrapped, false, true);
  nomear(pino, "Pino Ø10");
  const sub = tool.NewShape();
  nomear(sub, "Suporte");
  tool.AddComponent(sub, base, loc(0, 0, 0));
  tool.AddComponent(sub, pino, loc(50, 10, 30));
  const raiz = tool.NewShape();
  nomear(raiz, "Conjunto");
  tool.AddComponent(raiz, base, loc(0, 0, 0));
  tool.AddComponent(raiz, pino, loc(20, 10, 30));
  tool.AddComponent(raiz, pino, loc(80, 10, 30, 90));
  tool.AddComponent(raiz, sub, loc(0, 100, 0));
  tool.UpdateAssemblies();
  const w = new oc.STEPCAFControl_Writer(new oc.XSControl_WorkSession(), false);
  w.SetNameMode(true);
  oc.Interface_Static.SetIVal("write.step.assembly", 1);
  if (!w.Perform(doc, "/teste-montagem.step", new oc.Message_ProgressRange())) throw new Error("não gravou o STEP de teste");
  const b = oc.FS.readFile("/teste-montagem.step") as Uint8Array;
  oc.FS.unlink("/teste-montagem.step");
  return b;
}

const bytes = stepDeMontagem();
const texto = new TextDecoder().decode(bytes);
igual("árvore do texto: peças e quantidades", pecasDoStep(texto), [{ nome: "Base", n: 2 }, { nome: "Pino Ø10", n: 3 }]);
const leitura = await lerMontagemStep(bytes);
igual("kernel: 2 peças, 5 instâncias", [leitura.corpos.length, leitura.instancias.length, leitura.corpos.map((c) => c.n)], [2, 5, [2, 3]]);
igual("volumes das peças", leitura.corpos.map((c) => Math.round(c.volume)), [60000, Math.round(Math.PI * 25 * 30)]);
const m = validarMontagem(JSON.parse(JSON.stringify(montagemDoStep("conjunto.step", texto, leitura))));
igual("montagem com o nome do conjunto", m.nome, "Conjunto");
igual("peças com os nomes do STEP", m.pecas.map((p) => p.nome), ["Base", "Pino Ø10"]);
igual("lista de materiais", quantidades(m).map((q) => [q.peca.nome, q.qtd]), [["Base", 2], ["Pino Ø10", 3]]);
igual("todos fixos, como vieram", m.componentes.every((c) => c.fixo), true);
// posições: o centro do topo do pino (0, 30, 0 na peça) em cada instância
const pinos = m.componentes.filter((c) => c.peca === m.pecas[1].id).map((c) => r(aplicarPonto(c.t, [0, 30, 0])));
igual("pinos no lugar (o girado 90° em X aponta para +Z; o da submontagem sobe 100)", pinos.sort(), [[20, 40, 30], [50, 140, 30], [80, 10, 60]].sort());
const bases = m.componentes.filter((c) => c.peca === m.pecas[0].id).map((c) => r(aplicarPonto(c.t, [100, 10, 60])));
igual("bases no lugar", bases.sort(), [[100, 10, 60], [100, 110, 60]].sort());
// cada peça embutida regenera sozinha (corpo importado) com o volume certo
for (const p of m.pecas) {
  const res = regenerar(p.doc.features);
  igual(`peça "${p.nome}" regenera`, [res.erros.length, Math.round(res.volume ?? 0)], [0, p.nome === "Base" ? 60000 : Math.round(Math.PI * 25 * 30)]);
}

// ---------- STL grande: corpo de malha (sem virar sólido) ----------
{
  // cubo de 10 mm em STL ASCII (12 triângulos) e o mesmo sem um triângulo (aberto)
  const v = [[0, 0, 0], [10, 0, 0], [10, 10, 0], [0, 10, 0], [0, 0, 10], [10, 0, 10], [10, 10, 10], [0, 10, 10]];
  const f = [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]];
  const ascii = (fs: number[][]) => new TextEncoder().encode(`solid cubo\n${fs.map((t) => `facet normal 0 0 0\nouter loop\n${t.map((i) => `vertex ${v[i].join(" ")}`).join("\n")}\nendloop\nendfacet`).join("\n")}\nendsolid cubo\n`);
  const m = malhaDoStl(ascii(f));
  igual("cubo ASCII: 8 vértices soldados, 12 triângulos, volume 1000, área 600", [m.vertices.length / 3, m.triangulos.length / 3, Math.round(m.volume ?? -1), Math.round(m.area)], [8, 12, 1000, 600]);
  igual("malha aberta: sem volume", malhaDoStl(ascii(f.slice(1))).volume, null);
  igual("contagem de triângulos (ASCII)", contarTriangulosStl(ascii(f)), 12);
  // propriedades de massa de corpo de malha: cubo 10 mm → V 1000, centro (5, 5, 5), Ixx = 1000·200/12
  const pm = massa(null, [malhaDoStl(ascii(f))]);
  igual("massa do STL: volume, centro e Ixx do cubo", [Math.round(pm.volume), pm.centro.map((x) => Math.round(x * 1e6) / 1e6), Math.round(pm.inercia[0] * 100) / 100, Math.round(pm.area)], [1000, [5, 5, 5], 16666.67, 600]);
  // triângulos gravados ao contrário (exportador/escaneamento): a leitura reorienta
  const virar = (t: number[]) => [t[0], t[2], t[1]];
  const sentido = (mm: typeof m) => {
    // normal de cada triângulo aponta para fora do centro (5, 5, 5)
    let fora = 0;
    for (let t = 0; t < mm.triangulos.length; t += 3) {
      const [a, b, c] = [0, 1, 2].map((k) => [...mm.vertices.slice(mm.triangulos[t + k] * 3, mm.triangulos[t + k] * 3 + 3)]);
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
      if (n[0] * (a[0] + b[0] + c[0] - 15) + n[1] * (a[1] + b[1] + c[1] - 15) + n[2] * (a[2] + b[2] + c[2] - 15) > 0) fora++;
    }
    return fora;
  };
  const misto = malhaDoStl(ascii(f.map((t, i) => (i % 3 === 0 ? virar(t) : t))));
  igual("triângulos misturados: todos para fora, volume 1000", [sentido(misto), Math.round(misto.volume ?? -1)], [12, 1000]);
  const avesso = malhaDoStl(ascii(f.map(virar)));
  igual("malha inteira do avesso: virada para fora", [sentido(avesso), Math.round(avesso.volume ?? -1)], [12, 1000]);
  // dois cubos soltos, um deles com metade dos triângulos ao contrário
  const dois = [...f.map((t, i) => (i < 5 ? virar(t) : t)), ...f.map((t) => t.map((i) => i + 8))];
  v.push(...v.map((p) => [p[0] + 20, p[1], p[2]]));
  const m2 = malhaDoStl(ascii(dois));
  igual("duas partes: volume 2000", Math.round(m2.volume ?? -1), 2000);
  v.length = 8;
  // binário com mais triângulos que o limite: o documento marca como corpo de malha
  const n = LIMITE_TRIANGULOS_SOLIDO + 1;
  const bin = new Uint8Array(84 + 50 * n);
  new DataView(bin.buffer).setUint32(80, n, true);
  const dv = new DataView(bin.buffer);
  for (let i = 0; i < n; i++) for (let k = 0; k < 9; k++) dv.setFloat32(84 + i * 50 + 12 + k * 4, [i, 0, 0, i, 1, 0, i, 0, 1][k], true);
  igual("contagem de triângulos (binário)", contarTriangulosStl(bin), n);
  // triângulos vazios (0, 0, 0): contados para o aviso e fora da malha (não puxam a caixa para a origem)
  {
    const nv = 4, bv = new Uint8Array(84 + 50 * nv), d2 = new DataView(bv.buffer);
    d2.setUint32(80, nv, true);
    for (let k = 0; k < 9; k++) d2.setFloat32(84 + 12 + k * 4, [5, 5, 5, 6, 5, 5, 5, 6, 5][k], true);
    for (let k = 0; k < 9; k++) d2.setFloat32(84 + 50 + 12 + k * 4, [5, 5, 5, 5, 6, 5, 5, 5, 6][k], true);
    const mv = malhaDoStl(bv);
    igual("STL com 2 vazios: contados, fora da malha, caixa sem a origem", [triangulosVaziosStl(bv), mv.triangulos.length / 3, mv.min], [2, 2, [5, 5, 5]]);
  }
  const dGrande = documentoImportado("scan.stl", bin), dPequeno = documentoImportado("cubo.stl", ascii(f));
  igual("STL acima do limite vira corpo de malha; pequeno continua sólido", [dGrande.features[0].nome, (dGrande.features[0] as { malha?: boolean }).malha, (dPequeno.features[0] as { malha?: boolean }).malha], ["Malha1", true, undefined]);
  // regenerar: corpo de malha exibido (sem faces selecionáveis) e volume da malha fechada
  const cuboMalha = { ...dPequeno.features[0], malha: true } as typeof dPequeno.features[0];
  const r1 = regenerar([cuboMalha]);
  igual("corpo de malha regenera: 12 triângulos, sem faces, volume 1000", [r1.erros.length, r1.malha!.triangulos.length / 3, r1.malha!.faces.length, Math.round(r1.volume ?? 0), r1.topologia], [0, 12, 0, 1000, null]);
  // com um sólido depois: os dois aparecem; as faces do sólido continuam selecionáveis
  const r2 = regenerar([cuboMalha, ...documentoImportado("cubo.stl", ascii(f)).features]);
  igual("malha + sólido: faces só do sólido, triângulos dos dois", [r2.erros.length, r2.malha!.faces.length / 3, r2.topologia?.faces.length, r2.malha!.triangulos.length / 3 > 12], [0, 6, 6, true]);
}

// ---------- conteúdo importado grande: vai ao kernel uma vez, depois só a assinatura ----------
{
  const n = LIMITE_TRIANGULOS_SOLIDO + 30000; // corpo de malha com base64 > 1 MB
  const bin = new Uint8Array(84 + 50 * n);
  const dv = new DataView(bin.buffer);
  dv.setUint32(80, n, true);
  for (let i = 0; i < n; i++) for (let k = 0; k < 9; k++) dv.setFloat32(84 + i * 50 + 12 + k * 4, [i, 0, 0, i, 1, 0, i, 0, 1][k], true);
  const d = documentoImportado("grande.stl", bin);
  const f = d.features[0] as { id: string; dados: string };
  verdade("conteúdo maior que o limite de envio único", f.dados.length > LIMITE_DADOS_UMA_VEZ);
  const r1 = regenerar(d.features);
  const sig = assinaturaDados(f.id, f.dados);
  const soAssinatura = [{ ...d.features[0], dados: PREFIXO_ENVIADO + sig }] as typeof d.features;
  verdade("kernel já tem o conteúdo: a assinatura basta", temDadosDe(soAssinatura));
  const r2 = regenerar(soAssinatura);
  igual("reconstrói só com a assinatura (mesma malha)", [r2.erros.length, r2.malha!.triangulos.length], [0, r1.malha!.triangulos.length]);
  verdade("assinatura desconhecida: o kernel pede o conteúdo de novo", !temDadosDe([{ ...d.features[0], dados: PREFIXO_ENVIADO + "outro:1:a:b" }] as typeof d.features));
}

console.log(falhas ? `\nimportar: ${falhas} falha(s)` : "\nimportar: tudo certo");
if (falhas) process.exit(1);
