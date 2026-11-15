// Roteiro do orçamento do WJSlicer3D no tablet simulado (1280×800, toque, perfil tablet), do STL até a proposta gerada:
// biblioteca de custos (incluir, editar, duplicar, desativar, buscar, igual depois de limpar o aparelho = veio do cofre),
// orçamento (linhas da impressão, item da biblioteca com quantidade, lucro por linha, totais, faixas), proposta comercial
// (vista isométrica automática + vista do WJCAD, salva no cofre, abre no WJWrite, DOCX). Não entra no pnpm teste.
//   node scripts/roteiro-orcamento.cjs   (com `pnpm dev --port 5199 --strictPort` rodando)
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFileSync } = require("child_process");

const RAIZ = process.env.URL_WJ ?? "http://localhost:5199/";
const SAIDA = process.env.SAIDA ?? ".";
let falhas = 0;
const ok = (nome, cond, extra = "") => {
  if (!cond) falhas++;
  console.log(`${cond ? "ok  " : "FALHA"} ${nome}${extra ? ` (${extra})` : ""}`);
};
const num = (t) => parseFloat(String(t).replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", "."));

function stl(tris) {
  const buf = Buffer.alloc(84 + tris.length * 50);
  buf.writeUInt32LE(tris.length, 80);
  tris.forEach((t, i) => t.forEach((p, k) => p.forEach((x, e) => buf.writeFloatLE(x, 84 + i * 50 + 12 + k * 12 + e * 4))));
  return buf;
}
function stlCaixas(lista) {
  const tris = [];
  for (const [x0, y0, z0, x1, y1, z1] of lista) {
    const v = [];
    for (const z of [z0, z1]) for (const y of [y0, y1]) for (const x of [x0, x1]) v.push([x, y, z]);
    for (const [a, b, c, d] of [[0, 2, 3, 1], [4, 5, 7, 6], [0, 1, 5, 4], [2, 6, 7, 3], [0, 4, 6, 2], [1, 3, 7, 5]]) tris.push([v[a], v[b], v[c]], [v[a], v[c], v[d]]);
  }
  return stl(tris);
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "roteiro-orc-"));
  const fT = path.join(dir, "Suporte T.stl");
  fs.writeFileSync(fT, stlCaixas([[10, 0, 0, 20, 10, 20], [0, 0, 20, 30, 10, 23]]));

  const b = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1, acceptDownloads: true });
  const p = await ctx.newPage();
  const erros = [];
  p.on("pageerror", (e) => erros.push(e.message));
  await p.goto(`${RAIZ}slicer/`);
  await p.evaluate(() => {
    localStorage.setItem("jlscad:interface", JSON.stringify({ dispositivo: "tablet", caixaFlutuante: false }));
    ["wjslicer:preferencias", "wjslicer:orcamento", "wjslicer:biblioteca", "wjslicer:proposta", "wjslicer:logo"].forEach((k) => localStorage.removeItem(k));
  });
  await p.reload();
  await p.waitForTimeout(1200);
  ok("perfil tablet", await p.evaluate(() => document.body.classList.contains("disp-tablet")));

  // ---- STL do aparelho ----
  await p.locator("#sl-vazio-abrir").tap();
  const [fc] = await Promise.all([p.waitForEvent("filechooser"), p.getByText("STL do aparelho…").tap()]);
  await fc.setFiles(fT);
  await p.waitForFunction(() => document.getElementById("sl-ocupado").hidden && !document.getElementById("sl-resultado").hidden, null, { timeout: 60000 });
  const massa = parseFloat((await p.locator("#sl-massa").textContent()).replace(",", "."));
  ok("peça fatiada", massa > 0, `${massa} g`);

  // ---- biblioteca de custos ----
  await p.locator("#sl-biblioteca").tap();
  await p.waitForSelector(".or-tela [data-linhas] tr");
  const itens0 = await p.locator(".or-tela [data-linhas] tr").count();
  ok("biblioteca de fábrica com os exemplos", itens0 === 11 && (await p.locator(".or-tela").textContent()).includes("Chumbo") && (await p.locator(".or-tela").textContent()).includes("Ímã 10×4"), `${itens0} itens`);
  await p.locator(".or-tela [data-busca]").fill("ima");
  ok("busca sem acento (ímã)", (await p.locator(".or-tela [data-linhas] tr").count()) === 1);
  await p.locator(".or-tela [data-busca]").fill("");
  await p.locator(".or-tela [data-cat]").selectOption("filamento");
  ok("filtro por categoria: 6 filamentos", (await p.locator(".or-tela [data-linhas] tr").count()) === 6);
  await p.locator(".or-tela [data-cat]").selectOption("");
  // incluir
  await p.locator(".or-tela [data-novo]").tap();
  await p.locator(".wj-janela [data-f=nome]").fill("Parafuso M3");
  await p.locator(".wj-janela [data-f=unidade]").fill("un");
  await p.locator(".wj-janela [data-f=custo]").fill("0.5");
  await p.locator(".wj-janela [data-f=lucro]").fill("100");
  await p.getByRole("button", { name: "Salvar", exact: true }).tap();
  ok("incluir item", (await p.locator(".or-tela [data-linhas] tr").count()) === 12);
  // editar
  await p.locator(".or-tela tr", { hasText: "Parafuso M3" }).locator("[data-a=editar]").tap();
  await p.locator(".wj-janela [data-f=custo]").fill("0.75");
  await p.getByRole("button", { name: "Salvar", exact: true }).tap();
  ok("editar item", (await p.locator(".or-tela tr", { hasText: "Parafuso M3" }).textContent()).includes("0,75"));
  // item inválido não fecha
  await p.locator(".or-tela [data-novo]").tap();
  await p.getByRole("button", { name: "Salvar", exact: true }).tap();
  ok("nome em branco é recusado", await p.locator(".wj-janela [data-erro]").isVisible());
  await p.getByRole("button", { name: "Cancelar" }).tap();
  // duplicar (abre a cópia para editar)
  await p.locator(".or-tela tr", { hasText: "Parafuso M3" }).locator("[data-a=duplicar]").tap();
  ok("duplicar abre a cópia", (await p.locator(".wj-janela [data-f=nome]").inputValue()) === "Parafuso M3 (cópia)");
  await p.getByRole("button", { name: "Salvar", exact: true }).tap();
  ok("cópia na lista", (await p.locator(".or-tela [data-linhas] tr").count()) === 13);
  // desativar
  await p.locator(".or-tela tr", { hasText: "Parafuso M3 (cópia)" }).locator("[data-a=ativo]").tap();
  ok("desativado some da lista", (await p.locator(".or-tela [data-linhas] tr").count()) === 12);
  await p.locator(".or-tela [data-inativos]").check();
  ok("'Mostrar desativados' traz de volta", (await p.locator(".or-tela [data-linhas] tr.off").count()) === 1);
  await p.locator(".or-tela [data-inativos]").uncheck();
  await p.waitForFunction(() => /Salva no cofre/.test(document.querySelector(".or-tela [data-estado]")?.textContent ?? ""), null, { timeout: 20000 }).catch(() => {});
  const estado = await p.locator(".or-tela [data-estado]").textContent();
  ok("biblioteca salva no cofre", /Salva no cofre/.test(estado), estado);
  const noCofre = await p.evaluate(async () => {
    const abrir = () => new Promise((ok, er) => { const r = indexedDB.open("wjpdm"); r.onsuccess = () => ok(r.result); r.onerror = () => er(r.error); });
    const db = await abrir();
    const todos = (l) => new Promise((ok) => { const r = db.transaction(l).objectStore(l).getAll(); r.onsuccess = () => ok(r.result); });
    const pastas = await todos("pastas"), arqs = await todos("arquivos");
    const a = arqs.filter((x) => x.nome === "Biblioteca de custos.wjcus" && !x.lixeira);
    const pasta = a[0] && pastas.find((q) => q.id === a[0].pasta);
    return { n: a.length, pasta: pasta?.nome, publicado: a[0]?.versoes?.length > 0, semGoOut: !a[0]?.checkout };
  });
  ok("um arquivo só no cofre, em Impressão 3D, publicado", noCofre.n === 1 && noCofre.pasta === "Impressão 3D" && noCofre.publicado && noCofre.semGoOut, JSON.stringify(noCofre));
  await p.locator(".or-tela [data-fechar]").tap();

  // outro aparelho: sem a cópia local, a biblioteca vem do cofre
  await p.evaluate(() => localStorage.removeItem("wjslicer:biblioteca"));
  await p.reload();
  await p.waitForTimeout(1500);
  await p.locator("#sl-biblioteca").tap();
  await p.waitForFunction(() => document.querySelector(".or-tela [data-linhas]")?.textContent.includes("Parafuso M3"), null, { timeout: 15000 }).catch(() => {});
  ok("biblioteca lida do cofre (com o item novo)", (await p.locator(".or-tela [data-linhas]").textContent()).includes("Parafuso M3"));
  await p.locator(".or-tela [data-fechar]").tap();

  // ---- orçamento ----
  await p.locator("#sl-vazio-abrir").isVisible().catch(() => false);
  // depois do reload não há peça: põe de novo
  await p.locator("#sl-vazio-abrir").tap();
  const [fc2] = await Promise.all([p.waitForEvent("filechooser"), p.getByText("STL do aparelho…").tap()]);
  await fc2.setFiles(fT);
  await p.waitForFunction(() => document.getElementById("sl-ocupado").hidden && !document.getElementById("sl-resultado").hidden, null, { timeout: 60000 });
  await p.locator("#sl-orcamento").tap();
  await p.waitForSelector(".or-tela [data-l]");
  const linhas = await p.locator(".or-tela [data-l]").allTextContents();
  ok("linhas da impressão: filamento, energia e desgaste", linhas.length === 3 && linhas[0].includes("Filamento") && linhas[1].includes("energia") && linhas[2].includes("desgaste"), linhas.map((l) => l.slice(0, 25)).join(" | "));
  const precoFinal0 = num(await p.locator(".or-tela [data-v=precoFinal]").first().textContent());
  const custo0 = num(await p.locator(".or-tela [data-v=custo]").first().textContent());
  ok("custo e preço com lucro de 80 % (faixa Variável)", custo0 > 0 && Math.abs(precoFinal0 - custo0 * 1.8) < 0.011 + 0.01 * 0, `custo ${custo0}, preço ${precoFinal0}`);
  // item da biblioteca com quantidade
  await p.locator(".or-tela [data-add]").tap();
  await p.locator(".wj-janela [data-busca]").fill("ima");
  await p.locator(".wj-janela [data-lista] button").first().tap();
  await p.locator(".wj-janela [data-qtd]").fill("4");
  await p.getByRole("button", { name: "Adicionar", exact: true }).tap();
  const linhaIma = p.locator(".or-tela tr[data-l]", { hasText: "Ímã 10×4" });
  ok("Ímã 10×4 × 4: custo 20,00 e lucro padrão 30 %", num(await linhaIma.locator("[data-v^='custo:']").textContent()) === 20 && (await linhaIma.locator("[data-c=lucro]").inputValue()) === "30" && Math.abs(num(await linhaIma.locator("[data-v^='preco:']").textContent()) - 26) < 0.001);
  const precoComIma = num(await p.locator(".or-tela [data-v=precoFinal]").first().textContent());
  ok("preço final sobe com o item (≈ + R$ 26)", Math.abs(precoComIma - precoFinal0 - 26) < 0.03, `${precoFinal0} → ${precoComIma}`);
  // lucro editável na linha
  await linhaIma.locator("[data-c=lucro]").fill("100");
  await linhaIma.locator("[data-c=lucro]").dispatchEvent("change");
  ok("lucro da linha editado ali mesmo (100 % → preço 40)", Math.abs(num(await linhaIma.locator("[data-v^='preco:']").textContent()) - 40) < 0.001);
  const markup = num(await p.locator(".or-tela [data-v=markup]").first().textContent());
  ok("markup e margem mostrados", markup > 80 && (await p.locator(".or-tela [data-v=margem]").first().textContent()).includes("%"), `${markup} %`);
  // mudar a biblioteca não muda o orçamento
  const salvoAntes = num(await p.locator(".or-tela [data-v=precoFinal]").first().textContent());
  await p.locator(".or-tela [data-bib]").tap();
  await p.locator(".or-tela [data-linhas] tr", { hasText: "Ímã 10×4" }).locator("[data-a=editar]").tap();
  await p.locator(".wj-janela [data-f=custo]").fill("50");
  await p.getByRole("button", { name: "Salvar", exact: true }).tap();
  await p.locator(".or-tela [data-fechar]").last().tap();
  ok("mudar o custo na biblioteca não muda o orçamento já feito", Math.abs(num(await p.locator(".or-tela [data-v=precoFinal]").first().textContent()) - salvoAntes) < 0.001);
  // pedido: quantidade 2 e 2 unidades por mesa
  await p.locator("[data-p=quantidade]").fill("4");
  await p.locator("[data-p=quantidade]").dispatchEvent("change");
  await p.locator("[data-p=unidadesPorMesa]").fill("2");
  await p.locator("[data-p=unidadesPorMesa]").dispatchEvent("change");
  ok("mesas = quantidade ÷ unidades por mesa", (await p.locator(".or-tela [data-v=mesas]").first().textContent()) === "2");
  // faixa da matriz
  await p.locator(".or-tela details summary", { hasText: "Faixas de preço" }).tap();
  await p.locator("[data-faixa='2']").tap();
  ok("faixa 'Mínimo' (×3) aplica 200 % em todas as linhas", (await p.locator(".or-tela [data-c=lucro]").evaluateAll((e) => e.map((x) => x.value))).every((v) => v === "200"));
  // alvos de toque
  const pequenos = await p.evaluate(() => [...document.querySelectorAll(".or-tela button, .or-tela input, .or-tela select")].filter((e) => e.offsetParent && e.getBoundingClientRect().height < 43.5).map((e) => e.getAttribute("data-a") || e.getAttribute("data-c") || e.textContent || e.className));
  ok("alvos de toque ≥ 44 px", pequenos.length === 0, pequenos.join(", "));
  await p.screenshot({ path: path.join(SAIDA, "orcamento-tablet.png") });
  // reabrir: o orçamento ficou
  await p.locator(".or-tela [data-fechar]").tap();
  await p.reload();
  await p.waitForTimeout(1200);
  const guardado = await p.evaluate(() => JSON.parse(localStorage.getItem("wjslicer:orcamento")));
  ok("orçamento guardado no aparelho", guardado.quantidade === 4 && guardado.unidadesPorMesa === 2 && guardado.linhas.length === 4 && guardado.linhas.find((l) => l.rotulo === "Ímã 10×4").custoUnit === 5);

  // ---- vista do WJCAD guardada (como o menu do WJCAD faz) ----
  await p.evaluate(async () => {
    const png = document.createElement("canvas");
    png.width = 320; png.height = 200;
    const g = png.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, 320, 200); g.fillStyle = "#c33"; g.fillRect(40, 40, 240, 120);
    const url = png.toDataURL("image/jpeg", 0.8);
    await new Promise((ok, er) => {
      const r = indexedDB.open("wjcad-transferencia");
      r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains("arquivos")) r.result.createObjectStore("arquivos", { keyPath: "id" }); };
      r.onsuccess = () => { const t = r.result.transaction("arquivos", "readwrite"); t.objectStore("arquivos").put({ id: "valor:slicer:vistas", valor: [{ nome: "Vista 1 — Suporte T", peca: "Suporte T", url }] }); t.oncomplete = ok; };
      r.onerror = () => er(r.error);
    });
  });

  // ---- peça de novo e proposta ----
  await p.locator("#sl-vazio-abrir").tap();
  const [fc3] = await Promise.all([p.waitForEvent("filechooser"), p.getByText("STL do aparelho…").tap()]);
  await fc3.setFiles(fT);
  await p.waitForFunction(() => document.getElementById("sl-ocupado").hidden && !document.getElementById("sl-resultado").hidden, null, { timeout: 60000 });
  await p.locator("#sl-orcamento").tap();
  await p.waitForSelector(".or-tela [data-l]");
  await p.locator(".or-tela [data-proposta]").tap();
  await p.waitForSelector(".or-proposta [data-gerar]", { timeout: 30000 });
  ok("proposta: vista isométrica automática da peça", (await p.locator(".or-proposta img[alt^='Vista isométrica']").count()) === 1 && (await p.locator(".or-proposta img[alt^='Vista isométrica']").evaluate((i) => i.src.startsWith("data:image/jpeg") && i.src.length > 3000)));
  ok("proposta: vista do WJCAD para escolher (já marcada para a peça de mesmo nome)", (await p.locator(".or-proposta input[data-img^='cad:']").count()) === 1 && (await p.locator(".or-proposta input[data-img^='cad:']").isChecked()));
  const totalProp = num(await p.locator(".or-proposta [data-total]").textContent());
  const totalOrc = num(await p.locator(".or-tela [data-v=precoFinal]").first().textContent());
  ok("valor da proposta = preço final do orçamento", Math.abs(totalProp - totalOrc) < 0.02, `${totalProp} × ${totalOrc}`);
  await p.locator(".or-proposta [data-gerar]").tap();
  ok("exige o nome do cliente", await p.locator(".or-proposta [data-erro]").isVisible());
  await p.locator(".or-proposta [data-f=emissor]").fill("Johann L. Sicherl");
  await p.locator(".or-proposta [data-f=cNome]").fill("GRAFIX EXPRESS");
  await p.locator(".or-proposta [data-f=cCidade]").fill("Lagoa Santa");
  await p.locator(".or-proposta [data-f=descritivo]").fill("Suportes para o processo produtivo");
  await p.locator(".or-proposta [data-f=prazo]").fill("4 dias úteis");
  await p.locator(".or-proposta [data-gerar]").tap();
  await p.waitForFunction(() => /Proposta salva no cofre/.test(document.querySelector(".or-proposta [data-resultado]")?.textContent ?? ""), null, { timeout: 20000 });
  const prop = await p.evaluate(async () => {
    const abrir = () => new Promise((ok, er) => { const r = indexedDB.open("wjpdm"); r.onsuccess = () => ok(r.result); r.onerror = () => er(r.error); });
    const db = await abrir();
    const todos = (l) => new Promise((ok) => { const r = db.transaction(l).objectStore(l).getAll(); r.onsuccess = () => ok(r.result); });
    const pastas = await todos("pastas"), arqs = await todos("arquivos");
    const a = arqs.find((x) => /^Proposta comercial - GRAFIX EXPRESS\.wjdoc$/.test(x.nome) && !x.lixeira);
    if (!a) return null;
    const pasta = pastas.find((q) => q.id === a.pasta), pai = pastas.find((q) => q.id === pasta?.pai);
    const blob = await new Promise((ok) => { const r = db.transaction("blobs").objectStore("blobs").get(a.versoes[a.versoes.length - 1].blob); r.onsuccess = () => ok(r.result.dados); });
    return { pasta: pasta?.nome, pai: pai?.nome, texto: await blob.text() };
  });
  ok("proposta salva no cofre em Documentos › Propostas", prop && prop.pasta === "Propostas" && prop.pai === "Documentos");
  const doc = prop ? JSON.parse(prop.texto) : { html: "" };
  ok("documento no modelo: seções, cliente, valor e imagens", ["PROPOSTA COMERCIAL", "Dados do Cliente", "GRAFIX EXPRESS", "Informações do Produto / Serviço", "Custo de Investimento", "Valor Total:</b> R$", "Entrega do Pedido", "Imagens do Pedido"].every((t) => doc.html.includes(t)) && (doc.html.match(/<img /g) || []).length === 2, `${(doc.html.match(/<img /g) || []).length} imagens`);
  // abrir no WJWrite
  const [wj] = await Promise.all([ctx.waitForEvent("page"), p.locator(".or-proposta [data-abrir]").tap()]);
  await wj.waitForLoadState();
  await wj.waitForSelector("#dc-texto");
  await wj.waitForTimeout(800);
  const textoWJ = await wj.locator("#dc-texto").textContent();
  ok("WJWrite abre a proposta", textoWJ.includes("PROPOSTA COMERCIAL") && textoWJ.includes("GRAFIX EXPRESS") && (await wj.locator("#dc-texto img").count()) === 2);
  await wj.screenshot({ path: path.join(SAIDA, "proposta-wjwrite-tablet.png") });
  // exportar DOCX do WJWrite → No dispositivo
  await wj.evaluate(() => localStorage.setItem("jlscad:interface", JSON.stringify({ dispositivo: "tablet", caixaFlutuante: false })));
  await wj.getByRole("button", { name: "DOCX" }).first().tap();
  await wj.waitForSelector("[data-a=disp]", { timeout: 15000 });
  const [baixa] = await Promise.all([wj.waitForEvent("download"), wj.locator("[data-a=disp]").tap()]);
  const arq = path.join(dir, "proposta.docx");
  await baixa.saveAs(arq);
  let valido = false, listagem = "";
  try { listagem = execFileSync("unzip", ["-l", arq]).toString(); execFileSync("unzip", ["-tq", arq]); valido = true; } catch { /* inválido */ }
  ok("DOCX do WJWrite é um zip válido com texto e 2 imagens", valido && listagem.includes("word/document.xml") && (listagem.match(/word\/media\/image/g) || []).length === 2, baixa.suggestedFilename());
  const xml = execFileSync("unzip", ["-p", arq, "word/document.xml"]).toString();
  ok("DOCX tem o conteúdo da proposta", xml.includes("PROPOSTA COMERCIAL") && xml.includes("GRAFIX EXPRESS") && xml.includes("Heading2") && xml.includes('w:br w:type="page"'));
  try { execFileSync("soffice", ["--headless", "--convert-to", "pdf", "--outdir", dir, arq], { stdio: "ignore", timeout: 120000 }); ok("LibreOffice abre o DOCX (PDF gerado)", fs.existsSync(path.join(dir, "proposta.pdf"))); } catch { ok("LibreOffice abre o DOCX", false); }
  await wj.close();

  // DOCX direto da tela da proposta
  await p.locator(".or-proposta [data-docx]").tap();
  await p.waitForSelector("[data-a=disp]", { timeout: 15000 });
  const [baixa2] = await Promise.all([p.waitForEvent("download"), p.locator("[data-a=disp]").tap()]);
  await baixa2.saveAs(path.join(dir, "proposta2.docx"));
  let ok2 = false;
  try { execFileSync("unzip", ["-tq", path.join(dir, "proposta2.docx")]); ok2 = true; } catch { /* nada */ }
  ok("DOCX também sai da tela da proposta", ok2);
  await p.screenshot({ path: path.join(SAIDA, "proposta-tablet.png") });

  // ---- WJCAD: guardar a vista escolhida para a proposta (menu) ----
  const cad = await ctx.newPage();
  cad.on("pageerror", (e) => erros.push(`cad: ${e.message}`));
  await cad.addInitScript(() => {
    localStorage.setItem("jlscad:interface", JSON.stringify({ dispositivo: "tablet", caixaFlutuante: false }));
    localStorage.setItem("wjpdm:semAvisoConexoes", "1");
  });
  await cad.goto(`${RAIZ}cad/`);
  await cad.waitForTimeout(2500);
  await cad.evaluate(() => window.__cad.abrirExemplo());
  for (let i = 0; i < 120; i++) {
    await cad.waitForTimeout(150);
    if (!(await cad.evaluate(() => /Reconstruindo/i.test(document.body.innerText)))) break;
  }
  await cad.waitForTimeout(800);
  await cad.evaluate(() => indexedDB.deleteDatabase("wjcad-transferencia")).catch(() => {});
  await cad.locator("#btn-menu").tap();
  await cad.locator("[data-acao=vistaproposta]").tap();
  await cad.waitForTimeout(1200);
  const vistaCad = await cad.evaluate(async () => {
    const db = await new Promise((ok, er) => { const r = indexedDB.open("wjcad-transferencia"); r.onsuccess = () => ok(r.result); r.onerror = () => er(r.error); });
    const v = await new Promise((ok) => { const r = db.transaction("arquivos").objectStore("arquivos").get("valor:slicer:vistas"); r.onsuccess = () => ok(r.result); });
    return v ? v.valor.map((x) => ({ nome: x.nome, peca: x.peca, jpeg: x.url.startsWith("data:image/jpeg"), kb: Math.round(x.url.length / 1024) })) : null;
  });
  ok("WJCAD: menu guarda a vista para a proposta (JPEG com o nome da peça)", !!vistaCad && vistaCad.length === 1 && vistaCad[0].jpeg && vistaCad[0].kb > 5, JSON.stringify(vistaCad));
  await cad.locator("#btn-menu").tap();
  await cad.locator("[data-acao=vistaproposta]").tap();
  await cad.waitForTimeout(1000);
  const dois = await cad.evaluate(async () => {
    const db = await new Promise((ok, er) => { const r = indexedDB.open("wjcad-transferencia"); r.onsuccess = () => ok(r.result); r.onerror = () => er(r.error); });
    const v = await new Promise((ok) => { const r = db.transaction("arquivos").objectStore("arquivos").get("valor:slicer:vistas"); r.onsuccess = () => ok(r.result); });
    return v.valor.length;
  });
  ok("WJCAD: a segunda vista soma à lista", dois === 2);
  await cad.screenshot({ path: path.join(SAIDA, "cad-vista-proposta.png") });
  await cad.close();

  ok("sem erros na página", erros.length === 0, erros.join(" | "));
  await b.close();
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(falhas ? `\n${falhas} falha(s)` : "\nroteiro do orçamento: tudo certo");
  process.exit(falhas ? 1 : 0);
})();
