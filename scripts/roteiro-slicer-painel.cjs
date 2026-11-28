// Roteiro do painel de processo gerado do esquema (WJSlicer3D, fatia L1b), no tablet 1280×800 (toque, perfil Tablet):
// as 6 abas com todos os campos do esquema, grupos recolhíveis, selos ✅🟡🔶, nível Simples/Avançado/Especialista, busca,
// ↺ por campo, os 15 parâmetros da costura, "visível se", alvos ≥ 44 px, campo editado que muda o resultado e lembrança ao recarregar.
// Playwright do ambiente (não entra no pnpm teste):  node scripts/roteiro-slicer-painel.cjs   (com `pnpm dev --port 5199 --strictPort` rodando)
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

function stlBloco() {
  const tris = [];
  const caixa = (x0, y0, z0, x1, y1, z1) => {
    const v = [];
    for (const z of [z0, z1]) for (const y of [y0, y1]) for (const x of [x0, x1]) v.push([x, y, z]);
    for (const [a, b, c, d] of [[0, 2, 3, 1], [4, 5, 7, 6], [0, 1, 5, 4], [2, 6, 7, 3], [0, 4, 6, 2], [1, 3, 7, 5]]) tris.push([v[a], v[b], v[c]], [v[a], v[c], v[d]]);
  };
  caixa(10, 10, 0, 20, 20, 10); // pé
  caixa(0, 0, 10, 30, 30, 14); // placa em balanço (precisa de suporte)
  const buf = Buffer.alloc(84 + tris.length * 50);
  buf.writeUInt32LE(tris.length, 80);
  tris.forEach((t, i) => t.forEach((q, k) => q.forEach((x, e) => buf.writeFloatLE(x, 84 + i * 50 + 12 + k * 12 + e * 4))));
  return buf;
}

// campos de cada aba no esquema (nível Especialista = todos): conferidos em scripts/teste-painel.ts
const TOTAIS = { qualidade: 67, resistencia: 15, velocidade: 38, suporte: 39, multimaterial: 37, outros: 20 };

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "roteiro-painel-"));
  const arq = path.join(dir, "Bloco.stl");
  fs.writeFileSync(arq, stlBloco());
  const b = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
  const erros = [];
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => erros.push(e.message));
  await p.goto(`${RAIZ}slicer/`);
  await p.evaluate(() => {
    localStorage.setItem("jlscad:interface", JSON.stringify({ dispositivo: "tablet", caixaFlutuante: false }));
    localStorage.removeItem("wjslicer:preferencias");
    localStorage.removeItem("wjslicer:perfis");
  });
  await p.reload();
  await p.waitForTimeout(1200);

  const esperar = async () => {
    await p.waitForTimeout(450);
    await p.waitForFunction(() => document.getElementById("sl-ocupado").hidden && !document.getElementById("sl-resultado").hidden, null, { timeout: 60000 });
  };
  const tempo = async () => (await p.locator("#sl-tempo").textContent()).trim();
  const aba = (nome) => p.locator(`#sl-pabs [data-pab=${nome}]`).tap();
  const nivel = (n) => p.locator(`#sl-nivel [data-nivel=${n}]`).tap();
  /** abre o grupo do campo (grupos sem campo Simples começam recolhidos) e rola até ele */
  const rolar = async (sel) => {
    const d = p.locator("details.sl-grupo", { has: p.locator(sel) });
    if (!(await d.evaluate((e) => e.open))) await d.locator("summary").tap();
    await p.locator(sel).scrollIntoViewIfNeeded();
  };
  const visiveis = () => p.locator(".sl-painel-campos .sl-cp:not([hidden])").count();

  await p.locator("#sl-vazio-abrir").tap();
  const [fc] = await Promise.all([p.waitForEvent("filechooser"), p.getByText("STL do aparelho…").tap()]);
  await fc.setFiles(arq);
  await esperar();
  const t0 = await tempo();

  // ---------- nível Simples (padrão) ----------
  ok("nível Simples é o padrão", (await p.locator("#sl-nivel [data-nivel=simples]").getAttribute("aria-pressed")) === "true");
  ok("busca ligada, sem 'em breve'", (await p.locator("#sl-busca").isEnabled()) && !(await p.locator("#sl-bloco-processo").textContent()).includes("em breve ")); // "Objetos em breve" continua
  const simples = {};
  for (const a of Object.keys(TOTAIS)) {
    await aba(a);
    simples[a] = await visiveis();
  }
  ok("Simples mostra poucos campos em cada aba", Object.values(simples).every((n) => n <= 14) && simples.qualidade >= 1 && simples.resistencia >= 5, JSON.stringify(simples));

  // ---------- Especialista: todo campo do esquema, por aba ----------
  await nivel("especialista");
  for (const [a, total] of Object.entries(TOTAIS)) {
    await aba(a);
    const n = await p.locator(".sl-painel-campos .sl-cp").count();
    ok(`aba ${a}: todos os ${total} campos do esquema desenhados`, n === total, `${n}`);
    await p.waitForTimeout(150);
    await p.screenshot({ path: path.join(SAIDA, `slicer-l1b-${a}-tablet.png`) });
  }

  // ---------- grupos recolhíveis ----------
  await aba("qualidade");
  const g0 = p.locator(".sl-grupo").first();
  const resumo = g0.locator("summary");
  const antes = await g0.evaluate((e) => e.open);
  await resumo.tap();
  ok("grupo recolhe e abre ao toque", (await g0.evaluate((e) => e.open)) === !antes);
  await resumo.tap();
  ok("grupo volta a abrir", (await g0.evaluate((e) => e.open)) === antes);
  const nomeG0 = (await resumo.locator("span").first().textContent()).trim();
  await resumo.tap(); // recolhe
  await aba("resistencia");
  await aba("qualidade");
  ok("grupo lembra o estado ao trocar de aba", (await p.locator(".sl-grupo").first().evaluate((e) => e.open)) === !antes, nomeG0);
  await resumo.tap();

  // ---------- selos de estado ✅🟡🔶 ----------
  const selos = async (id) => (await p.locator(`#sl-cp-${id} .sl-selo`).first().textContent()).trim();
  ok("selo ✅ em campo do motor", (await selos("altura")) === "✅");
  ok("selo 🔶 em campo ainda não aplicado", (await selos("ferroTipo")) === "🔶");
  await aba("multimaterial");
  ok("selo 🟡 em campo parcial", (await selos("purgarNosObjetos")) === "🟡");
  ok("legenda dos selos na tela", (await p.locator(".sl-legenda-selos").textContent()).includes("🔶"));

  // ---------- os 15 parâmetros da costura ----------
  await aba("qualidade");
  const costura = ["costuraPosicao", "costuraAlternada", "costuraVao", "costuraRampaTipo", "costuraRampaAltura", "costuraRampaComprimento", "costuraRampaPassos", "costuraRampaLacoInteiro", "costuraVelocidade", "limpezaVelocidade", "limparNosLacos", "limparAntesParedeExt", "ordemParedes", "evitarCruzarParedes", "evitarCruzarDesvio"];
  const faltam = [];
  for (const id of costura) if ((await p.locator(`#sl-cp-${id}`).count()) !== 1) faltam.push(id);
  ok("os 15 parâmetros da costura (M2) têm tela", faltam.length === 0, faltam.join(","));

  // ---------- "visível se" ----------
  await rolar("[data-campo=costuraRampaTipo]");
  ok("rampa escondida com costura em rampa 'nenhuma'", await p.locator("#sl-cp-costuraRampaAltura").isHidden());
  await rolar("[data-campo=costuraRampaTipo]");
  await p.locator("[data-campo=costuraRampaTipo]").selectOption("contorno");
  ok("rampa aparece ao escolher contorno", await p.locator("#sl-cp-costuraRampaAltura").isVisible());
  ok("↺ no campo alterado, na aba e no perfil", (await p.locator("[data-voltar=costuraRampaTipo]").isVisible()) && (await p.locator("#sl-perfil-voltar").isVisible()) && (await p.locator("#sl-pabs [data-pab=qualidade]").evaluate((e) => e.classList.contains("alterada"))));
  await esperar();
  await p.locator("[data-voltar=costuraRampaTipo]").tap();
  ok("↺ do campo volta ao perfil e esconde a rampa", ((await p.locator("[data-campo=costuraRampaTipo]").inputValue()) === "nenhuma") && (await p.locator("#sl-cp-costuraRampaAltura").isHidden()) && (await p.locator("#sl-perfil-voltar").isHidden()));
  await esperar();

  // ---------- campo editado muda o resultado ----------
  await aba("velocidade");
  await rolar("[data-campo=vParedeExt]");
  const v0 = await p.locator("[data-campo=vParedeExt]").inputValue();
  await p.locator("[data-campo=vParedeExt]").fill("40");
  await p.locator("[data-campo=vParedeExt]").blur();
  await esperar();
  const t1 = await tempo();
  ok("velocidade da parede externa menor → tempo maior", t1 !== t0, `${t0} → ${t1} (era ${v0} mm/s)`);
  ok("↺ na aba Velocidade", await p.locator("#sl-pabs [data-pab=velocidade]").evaluate((e) => e.classList.contains("alterada")));
  await p.locator("#sl-perfil-voltar").tap();
  await esperar();
  ok("↺ do perfil volta o tempo", (await tempo()) === t0 && (await p.locator("[data-campo=vParedeExt]").inputValue()) === v0);

  await aba("suporte");
  await nivel("simples");
  await p.locator("[data-campo=suporte]").selectOption("normal");
  await esperar();
  const partes = (await p.locator("#sl-partes tbody tr").allTextContents()).join("|");
  ok("Suporte normal → suporte no tempo por caminho", partes.includes("Suporte") || partes.includes("Interface"), (await tempo()));
  await p.locator("[data-campo=suporte]").selectOption("nenhum");
  await nivel("especialista");
  await aba("suporte");
  await rolar("[data-campo=suporteTipo]").catch(() => {});
  ok("campos do suporte somem com 'sem suporte'", await p.locator("#sl-cp-anguloSuporte").isHidden());

  await aba("multimaterial");
  await rolar("[data-campo=torreAuto]");
  ok("posição X da torre escondida na posição automática", await p.locator("#sl-cp-torreX").isHidden());
  await rolar("[data-campo=torreAuto]");
  await p.locator("[data-campo=torreAuto]").tap();
  ok("posição X/Y da torre aparece ao desligar o automático", (await p.locator("#sl-cp-torreX").isVisible()) && (await p.locator("#sl-cp-torreY").isVisible()));
  await p.locator("[data-voltar=torreAuto]").tap();

  await aba("outros");
  await rolar("[data-campo=saia]");
  ok("saia desligada: distância escondida", await p.locator("#sl-cp-saiaDistancia").isHidden());
  await rolar("[data-campo=saia]");
  await p.locator("[data-campo=saia]").tap();
  ok("saia ligada: distância, voltas e tipo aparecem", (await p.locator("#sl-cp-saiaDistancia").isVisible()) && (await p.locator("#sl-cp-saiaVoltas").isVisible()) && (await p.locator("#sl-cp-saiaTipo").isVisible()));
  await p.locator("[data-campo=saia]").tap();
  await esperar();

  // ---------- campo 🔶 guarda o valor e não muda o resultado ----------
  await aba("qualidade");
  const t2 = await tempo();
  await rolar("[data-campo=ferroTipo]");
  await p.locator("[data-campo=ferroTipo]").selectOption("todasTopo");
  await esperar();
  ok("campo 🔶 (passar ferro) guarda o valor sem mudar o tempo", (await p.locator("[data-campo=ferroTipo]").inputValue()) === "todasTopo" && (await tempo()) === t2 && (await p.locator("#sl-cp-ferroFluxo").isVisible()));
  await p.locator("[data-voltar=ferroTipo]").tap();

  // ---------- nível ----------
  await aba("resistencia");
  await nivel("simples");
  const s1 = await visiveis();
  await nivel("avancado");
  const s2 = await visiveis();
  await nivel("especialista");
  const s3 = await visiveis();
  ok("Simples < Avançado ≤ Especialista na aba Resistência", s1 < s2 && s2 <= s3, `${s1} < ${s2} ≤ ${s3}`);
  ok("o nível fica marcado", (await p.locator("#sl-nivel [data-nivel=especialista]").getAttribute("aria-pressed")) === "true");

  // ---------- busca ----------
  await p.locator("#sl-busca").fill("costura");
  await p.waitForTimeout(400);
  const achados = await p.locator(".sl-painel-campos .sl-cp").count();
  ok("busca \"costura\" acha os campos em qualquer aba", achados >= 12 && (await p.locator("#sl-cp-costuraPosicao").isVisible()), `${achados}`);
  ok("resultado mostra aba › grupo", (await p.locator(".sl-grupo summary span").first().textContent()).includes("›"));
  await p.locator("#sl-busca").fill("pe de elefante");
  await p.waitForTimeout(400);
  ok("busca sem acento (pé de elefante)", await p.locator("#sl-cp-peDeElefante").isVisible());
  await p.locator("#sl-busca").fill("temperatura");
  await p.waitForTimeout(400);
  ok("busca nunca mostra campo oculto (G-code, temperatura)", (await p.locator(".sl-painel-campos .sl-cp").count()) === 0 && (await p.locator(".sl-vazio-painel").count()) === 1);
  await p.locator("#sl-busca").fill("");
  await p.waitForTimeout(400);
  ok("limpar a busca volta à aba", (await p.locator(".sl-painel-campos .sl-cp").count()) > 0);
  await aba("qualidade");

  // ---------- alvos de toque ≥ 44 px ----------
  const pequenos = [];
  for (const a of Object.keys(TOTAIS)) {
    await aba(a);
    const l = await p.evaluate(() => {
      const r = [];
      for (const e of document.querySelectorAll(".sl-painel-campos summary, .sl-painel-campos select, .sl-painel-campos input:not([type=checkbox]):not([type=range]), .sl-painel-campos .sl-chave, .sl-painel-campos .sl-passo button, .sl-painel-campos .sl-voltar:not([hidden])")) {
        const bb = e.getBoundingClientRect();
        if (!bb.width || e.closest("[hidden]") || e.closest("details:not([open])") && e.tagName !== "SUMMARY") continue;
        if (bb.height < 43.5) r.push(`${e.tagName}${e.dataset.campo ? "#" + e.dataset.campo : ""} ${Math.round(bb.height)}`);
      }
      return r;
    });
    pequenos.push(...l.map((x) => `${a}:${x}`));
  }
  ok("alvos de toque do painel ≥ 44 px", pequenos.length === 0, pequenos.slice(0, 6).join("; "));
  ok("sem rolagem lateral", await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));

  // ---------- lembra depois de recarregar ----------
  await aba("qualidade");
  await rolar("[data-campo=lParedeExt]");
  await p.locator("[data-campo=lParedeExt]").fill("0.5");
  await p.locator("[data-campo=lParedeExt]").blur();
  await esperar();
  await nivel("avancado");
  await p.reload();
  await p.waitForTimeout(1500);
  await aba("qualidade");
  ok("nível lembrado depois de recarregar", (await p.locator("#sl-nivel [data-nivel=avancado]").getAttribute("aria-pressed")) === "true");
  await nivel("especialista");
  await aba("qualidade");
  await rolar("[data-campo=lParedeExt]");
  ok("valor editado lembrado (0,5 mm) e com ↺", ((await p.locator("[data-campo=lParedeExt]").inputValue()) === "0.5") && (await p.locator("[data-voltar=lParedeExt]").isVisible()));

  // projeto: abre pelo salvar/abrir? (o autosave do projeto leva o plano completo)
  ok("sem erros na página", erros.length === 0, erros.slice(0, 3).join(" | "));
  await b.close();
  console.log(falhas ? `\n${falhas} falha(s)` : "\nTudo certo.");
  process.exit(falhas ? 1 : 0);
})();
