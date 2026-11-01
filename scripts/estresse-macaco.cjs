// "Macaco" de interface: em cada página (montagem, desenho, WJPDM, WJERP, WJPlan, WJWrite,
// WJApresentation, WJCronProject, WJTaskPlan, WJFlow, início), clica em botões, abas, itens de
// menu e da árvore ao acaso, toca e arrasta no viewport/folha, aperta Esc/Enter/Delete/Ctrl+Z,
// e anota todo erro de JavaScript ou do console. Repetível com SEMENTE. Precisa de pnpm dev --port 5199.
//   node scripts/estresse-macaco.cjs [computador|tablet] [acoes=400]
const { chromium } = require("playwright");

const BASE = process.env.URL_BASE ?? "http://localhost:5199/";
const perfil = process.argv[2] ?? "computador";
const nAcoes = Number(process.argv.find((a) => a.startsWith("acoes="))?.slice(6) ?? 400);
let semente = Number(process.env.SEMENTE ?? 7);
const rnd = () => ((semente = (semente * 1664525 + 1013904223) % 4294967296) / 4294967296);

(async () => {
  const b = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
  const ctx = await b.newContext({ viewport: perfil === "tablet" ? { width: 1280, height: 800 } : { width: 1400, height: 900 }, hasTouch: perfil === "tablet", acceptDownloads: true });
  const p = await ctx.newPage();
  const achados = [];
  let onde = "";
  const achar = (t, m) => { const l = `[${t}] ${onde}: ${String(m).slice(0, 300)}`; if (!achados.includes(l)) { achados.push(l); console.log(l); } };
  p.on("pageerror", (e) => achar("JS", `${e.message} ${(e.stack ?? "").split("\n").slice(1, 3).join(" ")}`));
  p.on("console", (m) => m.type() === "error" && !/favicon|Failed to load resource|WebGPU|webgpu|GPU adapter/.test(m.text()) && achar("console", m.text()));
  p.on("dialog", (d) => d.accept(d.type() === "prompt" ? "Teste" : undefined).catch(() => {}));
  p.on("popup", (x) => x.close().catch(() => {}));
  await p.addInitScript((d) => localStorage.setItem("jlscad:interface", JSON.stringify({ dispositivo: d })), perfil);

  const tocar = async (x, y) => (perfil === "tablet" ? p.touchscreen.tap(x, y) : p.mouse.click(x, y));
  async function macaco(nome, n) {
    onde = nome;
    for (let i = 0; i < n; i++) {
      const r = rnd();
      try {
        if (r < 0.62) {
          // botão/aba/item visível ao acaso (sem sair da página nem baixar o mesmo arquivo mil vezes)
          const alvos = await p.$$eval("button:not([disabled]), [role=tab], [role=menuitem], .arvore li, li[data-id], tr[data-arquivo], tr[data-pasta], [data-pasta], .pc-tipo, .aba-folha, summary, label input[type=checkbox], select", (els) =>
            els.map((e, k) => { const r = e.getBoundingClientRect(); return { k, x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height, t: (e.textContent ?? "").trim().slice(0, 40), tag: e.tagName }; })
              .filter((e) => e.w > 2 && e.h > 2 && e.x > 0 && e.y > 0 && e.x < innerWidth && e.y < innerHeight && !/Abrir no WJFlow|Imprimir|Excluir pasta|Restaurar|Sair|Fechar (peça|montagem|desenho)|Apagar tudo|Limpar|Esvaziar/.test(e.t)));
          if (!alvos.length) continue;
          const a = alvos[Math.floor(rnd() * alvos.length)];
          if (a.tag === "SELECT") {
            const sels = await p.$$("select");
            const s = sels[Math.floor(rnd() * sels.length)];
            const ops = await s.$$eval("option", (o) => o.map((x) => x.value));
            if (ops.length) await s.selectOption(ops[Math.floor(rnd() * ops.length)]).catch(() => {});
          } else await tocar(a.x, a.y);
        } else if (r < 0.8) {
          // toque ou arraste na área de trabalho
          const vp = await p.$("#viewport, #folha, canvas, main");
          const bb = vp && (await vp.boundingBox());
          if (!bb) continue;
          const x = bb.x + rnd() * bb.width, y = bb.y + rnd() * bb.height;
          if (rnd() < 0.6) await tocar(x, y);
          else {
            await p.mouse.move(x, y); await p.mouse.down();
            for (let k = 1; k <= 5; k++) await p.mouse.move(x + k * (rnd() * 20 - 10), y + k * (rnd() * 20 - 10));
            await p.mouse.up();
          }
        } else if (r < 0.9) {
          const tecla = ["Escape", "Enter", "Delete", "Control+z", "Control+y", "f", "Tab"][Math.floor(rnd() * 7)];
          if (!(await p.$("input:focus, textarea:focus, [contenteditable]:focus"))) await p.keyboard.press(tecla);
        } else {
          // digitar num campo visível
          const campos = await p.$$("input[type=number]:visible, input[type=text]:visible, input:not([type]):visible, textarea:visible");
          if (campos.length) {
            const c = campos[Math.floor(rnd() * campos.length)];
            await c.fill(["0", "-5", "1e9", "abc", "12,5", "", "3"][Math.floor(rnd() * 7)]).catch(() => {});
            await c.press("Enter").catch(() => {});
          }
        }
        await p.waitForTimeout(40 + rnd() * 120);
        // voltou para outra página (um link): retorna
        if (!p.url().includes(nome.split(" ")[0])) await p.goto(BASE + nome.split(" ")[0]).then(() => p.waitForTimeout(1500)).catch(() => {});
      } catch (e) {
        if (!/Target closed|detached|navigation|Execution context/.test(e.message)) achar("teste", e.message.split("\n")[0]);
      }
    }
  }

  // preparo: peça exemplo no cofre e na montagem e no desenho
  await p.goto(BASE + "cad/"); await p.waitForTimeout(2500);
  await p.evaluate(() => window.__cad?.abrirExemplo()); await p.waitForTimeout(1500);
  const peca = await p.evaluate(() => localStorage.getItem("jlscad:documento"));
  await p.goto(BASE + "cad/montagem/"); await p.waitForTimeout(3000);
  await p.evaluate((pc) => window.__asm.abrir({ formato: "wjasm", versao: 1, nome: "Conjunto", pecas: [{ id: "p1", nome: "Suporte", doc: JSON.parse(pc) }],
    componentes: [{ id: "c1", peca: "p1", instancia: 1, t: { pos: [0, 0, 0], rot: [0, 0, 0, 1] }, fixo: true }, { id: "c2", peca: "p1", instancia: 2, t: { pos: [100, 0, 0], rot: [0, 0, 0, 1] }, fixo: false }, { id: "c3", peca: "p1", instancia: 3, t: { pos: [0, 60, 0], rot: [0, 0, 0, 1] }, fixo: false }],
    posicionamentos: [] }), peca);
  await p.waitForTimeout(3000);
  await macaco("cad/montagem/", nAcoes);
  await p.goto(BASE + "cad/desenho/#de-montagem"); await p.waitForTimeout(8000);
  await macaco("cad/desenho/", nAcoes);
  for (const pg of ["pdm/", "erp/", "planilha/", "documento/", "apresentacao/", "cronograma/", "tarefas/", "flow/", ""]) {
    await p.goto(BASE + pg).catch(() => {}); await p.waitForTimeout(2000);
    if (await p.locator(".wj-fundo input").count()) { await p.locator(".wj-fundo input").first().fill("Johann"); await p.locator(".wj-fundo input").first().press("Enter").catch(() => {}); }
    await macaco(pg || "início", Math.round(nAcoes / 2));
  }
  await b.close();
  console.log(achados.length ? `\nmacaco (${perfil}): ${achados.length} achado(s)\n${achados.join("\n")}` : `\nmacaco (${perfil}): nenhum achado`);
  process.exit(achados.length ? 1 : 0);
})();
