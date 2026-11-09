// Roteiro de interface: o aviso de conexões "Cofre:" (Drive, pendrive, pasta) aparece com o botão
// "Não mostrar de novo" em todas as páginas; dispensado na página inicial, some de todas; religado
// em Cópias do cofre, volta. Tablet simulado. Uso: pnpm dev --port 5199 e depois
//   node scripts/roteiro-aviso-conexoes.cjs
const { chromium } = require("playwright");
const BASE = process.env.URL_BASE ?? "http://localhost:5199/";
const PAGS = ["", "cad/", "cad/montagem/", "cad/desenho/", "pdm/", "planilha/", "documento/", "apresentacao/", "cronograma/", "erp/", "tarefas/", "calceng/", "joia/", "flow/"];
(async () => {
  const b = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, hasTouch: true, isMobile: true });
  await ctx.addInitScript(() => localStorage.setItem("jlscad:interface", JSON.stringify({ dispositivo: "tablet", caixaFlutuante: false })));
  const p = await ctx.newPage();
  const espera = async () => { try { await p.waitForSelector(".wjc-faixa", { timeout: 12000 }); return true; } catch { return false; } };
  // 1) antes: cada página mostra a faixa e o botão
  const antes = [];
  for (const g of PAGS) { await p.goto(BASE + g); const t = await espera(); antes.push(`${g || "início"}:${t ? (await p.locator(".wjc-faixa [data-n]").count() ? "faixa+botão" : "faixa SEM botão") : "sem faixa"}`); }
  console.log("ANTES:", antes.join(" · "));
  // 2) dispensar na página inicial
  await p.goto(BASE); await espera(); await p.locator(".wjc-faixa [data-n]").tap();
  // 3) depois: nenhuma página mostra
  const depois = [];
  for (const g of PAGS) { await p.goto(BASE + g); const t = await espera(); depois.push(`${g || "início"}:${t ? "FAIXA" : "ok"}`); }
  console.log("DEPOIS de dispensar no início:", depois.join(" · "));
  // 4) religar em Cópias do cofre (⚙ Configurações do início) traz a faixa de volta
  await p.goto(BASE); await p.waitForTimeout(800);
  await p.locator('button[aria-label="Configurações"]').tap(); await p.waitForTimeout(1200);
  await p.locator("[data-aviso]").tap();
  await p.goto(BASE + "planilha/");
  const volta = await espera();
  console.log("religado no início, faixa no WJPlan:", volta ? "voltou" : "NÃO voltou");
  const falhas = antes.filter((x) => !x.endsWith("faixa+botão")).length + depois.filter((x) => !x.endsWith(":ok")).length + (volta ? 0 : 1);
  console.log(falhas ? `${falhas} FALHA(S)` : "aviso de conexões: tudo certo");
  await b.close();
  process.exit(falhas ? 1 : 0);
})();
