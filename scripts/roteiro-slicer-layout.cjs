// Roteiro do layout novo do WJSlicer3D (fatia L1a): as 4 abas, a barra lateral (Impressora, Filamento, Processo),
// perfil de camada que muda o resultado, selo ↺ de alterado, perfil do usuário salvo/renomeado/excluído/reaberto,
// alvos ≥ 44 px, e telas de celular (390×844) e computador (1440×900) sem rolagem horizontal. Capturas das 3 telas.
// Playwright do ambiente (não entra no pnpm teste):
//   node scripts/roteiro-slicer-layout.cjs   (com `pnpm dev --port 5199 --strictPort` rodando)
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const os = require("os");

const RAIZ = process.env.URL_WJ ?? "http://localhost:5199/";
const SAIDA = process.env.SAIDA ?? ".";
let falhas = 0;
const ok = (nome, cond, extra = "") => {
  if (!cond) falhas++;
  console.log(`${cond ? "ok  " : "FALHA"} ${nome}${extra ? ` (${extra})` : ""}`);
};

/** STL binário de um cubo de 20 mm com um degrau (peça simples e rápida). */
function stlPeca() {
  const tris = [];
  const caixa = (x0, y0, z0, x1, y1, z1) => {
    const v = [];
    for (const z of [z0, z1]) for (const y of [y0, y1]) for (const x of [x0, x1]) v.push([x, y, z]);
    for (const [a, b, c, d] of [[0, 2, 3, 1], [4, 5, 7, 6], [0, 1, 5, 4], [2, 6, 7, 3], [0, 4, 6, 2], [1, 3, 7, 5]]) tris.push([v[a], v[b], v[c]], [v[a], v[c], v[d]]);
  };
  caixa(0, 0, 0, 30, 30, 12);
  const buf = Buffer.alloc(84 + tris.length * 50);
  buf.writeUInt32LE(tris.length, 80);
  tris.forEach((t, i) => t.forEach((q, k) => q.forEach((x, e) => buf.writeFloatLE(x, 84 + i * 50 + 12 + k * 12 + e * 4))));
  return buf;
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "roteiro-layout-"));
  const arq = path.join(dir, "Bloco.stl");
  fs.writeFileSync(arq, stlPeca());
  const b = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
  const erros = [];

  /** abre o app num aparelho, limpa as preferências e põe a peça na mesa */
  async function abrir(opcoes, dispositivo) {
    const ctx = await b.newContext({ deviceScaleFactor: 1, ...opcoes });
    const p = await ctx.newPage();
    p.on("pageerror", (e) => erros.push(e.message));
    await p.goto(`${RAIZ}slicer/`);
    await p.evaluate((d) => {
      localStorage.setItem("jlscad:interface", JSON.stringify({ dispositivo: d, caixaFlutuante: false }));
      localStorage.removeItem("wjslicer:preferencias");
      localStorage.removeItem("wjslicer:perfis");
    }, dispositivo);
    await p.reload();
    await p.waitForTimeout(1200);
    return p;
  }
  const esperar = async (p) => {
    await p.waitForTimeout(450);
    await p.waitForFunction(() => document.getElementById("sl-ocupado").hidden && !document.getElementById("sl-resultado").hidden, null, { timeout: 60000 });
  };
  const camadas = async (p) => parseInt((await p.locator("#sl-dados div", { hasText: "Camadas" }).locator("dd").textContent()).replace(/\D/g, ""), 10);
  const toque = (p, sel) => p.locator(sel).tap();
  const poePeca = async (p) => {
    await toque(p, "#sl-vazio-abrir");
    const [fc] = await Promise.all([p.waitForEvent("filechooser"), p.getByText("STL do aparelho…").tap()]);
    await fc.setFiles(arq);
    await esperar(p);
  };
  const semRolagemLateral = (p) => p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1 && document.body.scrollWidth <= innerWidth + 1);

  // ================= tablet 1280×800 =================
  const p = await abrir({ viewport: { width: 1280, height: 800 }, hasTouch: true, isMobile: true }, "tablet");
  ok("perfil tablet", await p.evaluate(() => document.body.classList.contains("disp-tablet")));
  ok("abre na aba Preparar", (await p.locator("#sl-aba-preparar").getAttribute("aria-selected")) === "true" && (await p.locator("#sl-ferr").isVisible()));
  const larg = await p.locator("#sl-lateral").evaluate((e) => Math.round(e.getBoundingClientRect().width));
  ok("barra lateral de 360 px no tablet", larg === 360, `${larg} px`);

  // blocos da barra lateral
  ok("blocos Impressora, Filamento e Processo", (await p.locator("#sl-bloco-impressora").isVisible()) && (await p.locator("#sl-bloco-filamento").isVisible()) && (await p.locator("#sl-bloco-processo").isVisible()));
  const maq = await p.locator("#sl-maquina option").allTextContents();
  ok("lista só P1S e Kobra 3", maq.join("|") === "Bambu Lab P1S|Anycubic Kobra 3", maq.join(", "));
  ok("⚙ e ✎ da impressora desabilitados", (await p.locator("#sl-bloco-impressora button:disabled").count()) === 2);
  ok("4 posições de filamento", (await p.locator(".sl-filamento").count()) === 4);
  ok("Objetos desabilitado (em breve); busca e Avançado ligados", (await p.locator("#sl-proc-objetos").isDisabled()) && (await p.locator("#sl-busca").isEnabled()) && (await p.locator("#sl-nivel button").count()) === 3);
  const perf = await p.locator("#sl-perfil option").allTextContents();
  ok("9 perfis do sistema", perf.length === 10 && perf.includes("0,20 mm Padrão") && perf.includes("0,12 mm Alta qualidade") && perf.includes("0,28 mm"), `${perf.length} entradas`);
  const grupos = await p.locator("#sl-perfil optgroup").evaluateAll((l) => l.map((g) => g.label));
  ok("grupos: usuário e sistema", grupos.join("|") === "Perfis do usuário|Perfis do sistema", grupos.join("|"));
  ok("6 abas de processo", (await p.locator("#sl-pabs [data-pab]").count()) === 6);

  // as abas de processo mostram os campos de hoje nos lugares certos
  const onde = async (aba, sel) => {
    await toque(p, `#sl-pabs [data-pab=${aba}]`);
    return p.locator(sel).isVisible();
  };
  ok("Qualidade: altura da camada", await onde("qualidade", "[data-campo=altura]"));
  ok("Resistência: paredes, topo, fundo, preenchimento e padrão", (await onde("resistencia", "[data-campo=paredes]")) && (await p.locator("[data-campo=topo]").isVisible()) && (await p.locator("[data-campo=fundo]").isVisible()) && (await p.locator("[data-campo=preenchimento]").isVisible()) && (await p.locator("[data-campo=padrao]").isVisible()));
  ok("Suporte: tipo de suporte", await onde("suporte", "[data-campo=suporte]"));
  ok("Outros: borda e saia", (await onde("outros", "[data-campo=borda]")) && (await p.locator("[data-campo=saia]").isVisible()));
  ok("a nota \"chega na próxima etapa\" sumiu", (await p.locator(".sl-prox").count()) === 0 && !(await p.locator("#sl-bloco-processo").textContent()).includes("próxima etapa"));

  // 4 abas
  await poePeca(p);
  const r20 = await camadas(p);
  ok("peça fatiada", r20 > 0, `${r20} camadas`);
  await toque(p, "#sl-aba-inicio");
  ok("aba Início", (await p.locator("#sl-pagina-inicio").isVisible()) && !(await p.locator("#sl-lateral").isVisible()) && (await p.locator("#sl-ini-resumo").textContent()).includes("1 peça"));
  await p.screenshot({ path: path.join(SAIDA, "slicer-l1a-inicio-tablet.png") });
  await toque(p, "#sl-aba-previa");
  await p.waitForTimeout(700);
  ok("aba Prévia: resultado, deslizante e legenda", (await p.locator("#sl-resultado").isVisible()) && (await p.locator("#sl-deslizante").isVisible()) && (await p.locator("#sl-legenda span").count()) >= 2 && !(await p.locator("#sl-ferr").isVisible()));
  await p.screenshot({ path: path.join(SAIDA, "slicer-l1a-previa-tablet.png") });
  await toque(p, "#sl-aba-bancada");
  ok("aba Bancada: biblioteca, orçamento, proposta e projetos", (await p.locator("#sl-pagina-bancada").isVisible()) && (await p.locator("#sl-biblioteca, #sl-orcamento, #sl-proposta, #sl-bancada-salvar, #sl-abrir-projeto, #sl-cofre").count()) === 6);
  await toque(p, "#sl-orcamento");
  ok("orçamento abre DENTRO da aba", await p.locator("#sl-bancada-area .or-tela").isVisible() && (await p.locator("#sl-bancada-area .or-tela").evaluate((e) => e.getBoundingClientRect().top)) > 60);
  await p.screenshot({ path: path.join(SAIDA, "slicer-l1a-bancada-tablet.png") });
  await toque(p, ".or-tela [data-fechar]");
  await toque(p, "#sl-aba-preparar");
  await p.waitForTimeout(500);
  await p.screenshot({ path: path.join(SAIDA, "slicer-l1a-preparar-tablet.png") });

  // perfil de camada muda o resultado
  await p.locator("#sl-perfil").selectOption("s:0.12");
  await esperar(p);
  const r12 = await camadas(p);
  ok("perfil 0,12 mm dá mais camadas que 0,20 mm", r12 > r20 * 1.4, `${r20} → ${r12}`);
  await toque(p, "#sl-pabs [data-pab=qualidade]");
  ok("altura do perfil aparece no campo", (await p.locator("[data-campo=altura]").inputValue()) === "0.12");
  ok("recém-escolhido: sem selo ↺", await p.locator("#sl-perfil-voltar").isHidden());
  await p.locator("#sl-perfil").selectOption("s:0.20-padrao");
  await esperar(p);
  ok("de volta ao 0,20 mm: camadas iguais", (await camadas(p)) === r20);

  // selo ↺
  await toque(p, "#sl-pabs [data-pab=resistencia]");
  const par0 = await p.locator("[data-campo=paredes]").inputValue();
  await toque(p, "#sl-cp-paredes [data-passo='1']");
  ok("↺ aparece ao alterar (campo, aba e perfil)", (await p.locator("[data-voltar=paredes]").isVisible()) && (await p.locator("#sl-perfil-voltar").isVisible()) && (await p.locator("#sl-pabs [data-pab=resistencia]").evaluate((e) => e.classList.contains("alterada"))));
  ok("campo não alterado não tem ↺", await p.locator("[data-voltar=topo]").isHidden());
  await toque(p, "[data-voltar=paredes]");
  ok("↺ some ao reverter", (await p.locator("[data-campo=paredes]").inputValue()) === par0 && (await p.locator("#sl-perfil-voltar").isHidden()) && (await p.locator("[data-voltar=paredes]").isHidden()));
  await toque(p, "#sl-cp-paredes [data-passo='1']");
  await toque(p, "#sl-cp-topo [data-passo='1']");
  await toque(p, "#sl-perfil-voltar");
  ok("↺ do perfil volta tudo", (await p.locator("[data-campo=paredes]").inputValue()) === par0 && (await p.locator("#sl-perfil-voltar").isHidden()));
  await esperar(p);

  // perfil do usuário: salvar, trocar, reabrir, renomear, excluir
  await toque(p, "#sl-cp-paredes [data-passo='1']");
  await toque(p, "#sl-cp-paredes [data-passo='1']");
  const parForte = await p.locator("[data-campo=paredes]").inputValue();
  await toque(p, "#sl-perfil-menu");
  await p.getByText("Salvar como novo perfil…").tap();
  await p.locator("#sl-nome-perfil").fill("Peça forte");
  await p.locator(".wj-janela").getByRole("button", { name: "Salvar", exact: true }).tap();
  await p.waitForTimeout(300);
  ok("perfil do usuário salvo e escolhido", (await p.locator("#sl-perfil option:checked").textContent()) === "Peça forte" && (await p.locator("#sl-perfil-voltar").isHidden()));
  await p.locator("#sl-perfil").selectOption("s:0.20-padrao");
  ok("trocar de perfil traz os valores dele", (await p.locator("[data-campo=paredes]").inputValue()) === par0);
  const valorU = await p.locator("#sl-perfil option", { hasText: "Peça forte" }).getAttribute("value");
  await p.locator("#sl-perfil").selectOption(valorU);
  ok("perfil do usuário reaplicado", (await p.locator("[data-campo=paredes]").inputValue()) === parForte);
  await esperar(p);
  await p.reload();
  await p.waitForTimeout(1200);
  ok("perfil do usuário lembrado depois de recarregar", (await p.locator("#sl-perfil option:checked").textContent()) === "Peça forte");
  await toque(p, "#sl-pabs [data-pab=resistencia]");
  ok("…com os valores dele e sem ↺", (await p.locator("[data-campo=paredes]").inputValue()) === parForte && (await p.locator("#sl-perfil-voltar").isHidden()));
  await toque(p, "#sl-perfil-menu");
  await p.getByText("Renomear…").tap();
  await p.locator("#sl-nome-perfil").fill("Peça reforçada");
  await p.locator(".wj-janela").getByRole("button", { name: "Salvar", exact: true }).tap();
  await p.waitForTimeout(300);
  ok("perfil renomeado", (await p.locator("#sl-perfil option:checked").textContent()) === "Peça reforçada");
  await toque(p, "#sl-perfil-menu");
  await p.getByText("Excluir perfil").tap();
  await p.locator(".wj-janela").getByRole("button", { name: "Excluir", exact: true }).tap();
  await p.waitForTimeout(300);
  ok("perfil excluído: volta ao do sistema", !(await p.locator("#sl-perfil").textContent()).includes("reforçada") && (await p.locator("#sl-perfil option:checked").textContent()) === "0,20 mm Padrão");

  // posições de filamento: material e cor
  const fil = p.locator(".sl-filamento[data-i='2']");
  await fil.locator("[data-c=material]").selectOption("petg");
  const pf = await p.evaluate(() => JSON.parse(localStorage.getItem("wjslicer:preferencias")).filamentos[2].material);
  ok("posição 3 com material próprio", pf === "petg");

  // alvos de toque ≥ 44 px no tablet
  const pequenos = await p.evaluate(() =>
    [...document.querySelectorAll("#sl-abas button, .sl-tb, #sl-ferr button, #sl-lateral button:not([hidden]), #sl-lateral select, #sl-lateral input:not([type=range]):not([type=checkbox])")]
      .filter((e) => e.offsetParent && !e.disabled && e.getBoundingClientRect().height < 43.5).map((e) => e.id || e.className || e.textContent.slice(0, 20)));
  ok("alvos de toque ≥ 44 px (abas, topo, ferramentas e barra lateral)", pequenos.length === 0, pequenos.join(", "));
  ok("ferramentas ainda sem função ficam desabilitadas", (await p.locator("#sl-ferr button:disabled[title*='em breve']").count()) >= 3);
  ok("tablet sem rolagem lateral", await semRolagemLateral(p));
  await p.context().close();

  // ================= celular 390×844 =================
  const c = await abrir({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }, "celular");
  await poePeca(c);
  ok("celular: sem rolagem lateral (Preparar)", await semRolagemLateral(c));
  ok("celular: barra lateral é gaveta (fechada)", !(await c.locator("#sl-lateral").evaluate((e) => e.getBoundingClientRect().right > 8)));
  ok("celular: abas e ferramentas sem texto", !(await c.locator("#sl-aba-preparar span").isVisible()) && !(await c.locator("#sl-adicionar span").isVisible()));
  await toque(c, "#sl-gaveta");
  await c.waitForTimeout(300);
  ok("celular: gaveta abre", await c.locator("#sl-lateral").evaluate((e) => e.getBoundingClientRect().left >= -1 && e.getBoundingClientRect().right > 100));
  await c.screenshot({ path: path.join(SAIDA, "slicer-l1a-preparar-celular.png") });
  ok("celular: gaveta sem rolagem lateral", await semRolagemLateral(c));
  await toque(c, "#sl-gaveta");
  for (const a of ["inicio", "previa", "bancada", "preparar"]) {
    await toque(c, `#sl-aba-${a}`);
    await c.waitForTimeout(400);
    ok(`celular: aba ${a} sem rolagem lateral`, await semRolagemLateral(c));
  }
  const pc = await c.evaluate(() =>
    [...document.querySelectorAll("#sl-abas button, .sl-tb, #sl-ferr button")].filter((e) => e.offsetParent && !e.disabled && (e.getBoundingClientRect().height < 43.5 || e.getBoundingClientRect().width < 43.5)).map((e) => e.id || e.textContent));
  ok("celular: alvos ≥ 44 px", pc.length === 0, pc.join(", "));
  await c.context().close();

  // ================= computador 1440×900 =================
  const d = await abrir({ viewport: { width: 1440, height: 900 } }, "computador");
  await d.locator("#sl-vazio-abrir").click();
  const [fc] = await Promise.all([d.waitForEvent("filechooser"), d.getByText("STL do aparelho…").click()]);
  await fc.setFiles(arq);
  await esperar(d);
  const largD = await d.locator("#sl-lateral").evaluate((e) => Math.round(e.getBoundingClientRect().width));
  ok("barra lateral de 380 px no computador", largD === 380, `${largD} px`);
  for (const a of ["inicio", "previa", "bancada", "preparar"]) {
    await d.locator(`#sl-aba-${a}`).click();
    await d.waitForTimeout(300);
    ok(`computador: aba ${a} sem rolagem lateral`, await semRolagemLateral(d));
  }
  ok("computador: abas com texto", await d.locator("#sl-aba-previa span").isVisible());
  await d.screenshot({ path: path.join(SAIDA, "slicer-l1a-preparar-computador.png") });
  await d.context().close();

  ok("sem erros na página", erros.length === 0, erros.join(" | "));
  await b.close();
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(falhas ? `\n${falhas} falha(s)` : "\nroteiro do layout do WJSlicer3D: tudo certo");
  process.exit(falhas ? 1 : 0);
})();
