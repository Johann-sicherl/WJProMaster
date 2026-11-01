// Teste da importação de montagem STEP: gera no próprio teste um STEP de montagem (conjunto com
// peça repetida, peça girada e submontagem), lê no kernel (src/kernel/importar.ts), monta o .wjasm
// (src/montagem/step.ts) e confere nomes, quantidades, posições e volumes de cada peça.
import opencascade from "replicad-opencascadejs";
import { getOC, makeBox, makeCylinder, setOC } from "replicad";
import { createRequire } from "node:module";
import { lerMontagemStep } from "../src/kernel/importar";
import { regenerar } from "../src/kernel/regenerar";
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

console.log(falhas ? `\nimportar: ${falhas} falha(s)` : "\nimportar: tudo certo");
if (falhas) process.exit(1);
