// Roteiro de interface: mudanças feitas FORA do app no Google Drive, aplicadas SOZINHAS no cofre
// (decisão do Johann, 12/11/2026: "o que eu fizer à mão no Drive é o modelo atual do cofre"). Drive
// simulado (API REST v3 com o escopo drive.file: o que o Johann cria à mão no Drive é invisível para o
// app). Ele renomeia a pasta CAD, move o Mancal, põe a Tampa numa pasta criada à mão, manda o Pino e a
// Bucha (Série em produção) para a lixeira do Drive, move a Arruela (GO-OUT da Ana) e edita o Eixo. Ao
// abrir o WJPDM: nada de janela de perguntas, só o aviso "Cofre atualizado pelo Drive: …" com "Ver
// detalhes"; o cofre e o Drive ficam certos. Depois: o aviso também em outro app (página inicial),
// mover pasta inteira e vários arquivos marcados. Tablet simulado (toque, 1280×800).
// Uso: pnpm dev --port 5199 e depois  node scripts/roteiro-mudancas-fora.cjs [pasta-das-capturas]
const { chromium } = require("playwright");
const BASE = process.env.URL_BASE ?? "http://localhost:5199/";
const CAPTURAS = process.argv[2];
const falhas = [];
const conferir = (ok, texto) => {
  console.log(`${ok ? "✓" : "✗"} ${texto}`);
  if (!ok) falhas.push(texto);
};

// ---------- Drive simulado ----------
const PASTA = "application/vnd.google-apps.folder";
const itens = new Map();
let n = 0;
const apagados = [];
const md5 = (d) => require("crypto").createHash("md5").update(d ?? "").digest("hex");
const lixoDe = (x) => {
  for (let p = x; p; p = itens.get(p.parents[0])) if (p.lixo) return p;
  return undefined;
};
// como na API: dentro de uma pasta na lixeira também está na lixeira; arquivos têm md5
const meta = (x) => {
  const l = lixoDe(x);
  return { id: x.id, name: x.name, parents: x.parents, mimeType: x.mimeType, modifiedTime: x.mod, trashed: !!l, ...(l ? { trashedTime: l.lixoEm } : {}), ...(x.mimeType !== PASTA ? { md5Checksum: md5(x.dados) } : {}) };
};
const visivel = (x) => !!x && !x.mao;
const naLixeira = (x) => {
  for (let p = x; p; p = itens.get(p.parents[0])) if (p.lixo) return true;
  return false;
};
const caminho = (x) => {
  const c = [x.name];
  for (let p = itens.get(x.parents[0]); p; p = itens.get(p.parents[0])) c.unshift(p.name);
  return c.join("/");
};
const arquivos = () => [...itens.values()].filter((x) => x.mimeType !== PASTA && !naLixeira(x)).map(caminho).filter((c) => !c.includes(".wjpdm") && !c.includes("versões")).sort();
const pastaEm = (c) => [...itens.values()].find((x) => x.mimeType === PASTA && !naLixeira(x) && caminho(x) === c);
const arquivoEm = (c) => [...itens.values()].find((x) => x.mimeType !== PASTA && !naLixeira(x) && caminho(x) === c);
const json = (r, corpo, status = 200) => r.fulfill({ status, contentType: "application/json", body: JSON.stringify(corpo) });

async function responder(r) {
  const req = r.request();
  const u = new URL(req.url());
  const m = req.method();
  if (!u.hostname.endsWith("googleapis.com")) return r.fulfill({ status: 404, body: "" });
  const id = u.pathname.match(/\/files\/([^/]+)$/)?.[1];
  const agora = new Date().toISOString();
  if (m === "GET" && !id) {
    const q = u.searchParams.get("q");
    const nome = /name='((?:[^'\\]|\\.)*)'/.exec(q)?.[1]?.replace(/\\'/g, "'");
    const pais = [...q.matchAll(/'([^']+)' in parents/g)].map((x) => x[1]).map((p) => (p === "root" ? "root" : p));
    const soPasta = q.includes(`mimeType='${PASTA}'`);
    const files = [...itens.values()].filter((x) => visivel(x) && !lixoDe(x) && (!pais.length || x.parents.some((p) => pais.includes(p))) && (nome === undefined || x.name === nome) && (!soPasta || x.mimeType === PASTA)).map(meta);
    return json(r, { files });
  }
  if (m === "GET" && id) {
    const x = itens.get(id);
    if (!visivel(x)) return r.fulfill({ status: 404, body: "nf" });
    return u.searchParams.get("alt") === "media" ? r.fulfill({ status: 200, body: x.dados }) : json(r, meta(x));
  }
  if (m === "POST" && u.pathname === "/drive/v3/files") {
    const b = JSON.parse(req.postData());
    if (b.parents.some((p) => itens.get(p)?.mao)) return r.fulfill({ status: 404, body: "nf" });
    const x = { id: `d${++n}`, name: b.name, parents: b.parents, mimeType: b.mimeType, dados: "", mod: agora };
    itens.set(x.id, x);
    return json(r, { id: x.id });
  }
  if (m === "POST" && u.pathname === "/upload/drive/v3/files") {
    const fronteira = /boundary=(\S+)/.exec(req.headers()["content-type"])[1];
    const corpo = req.postDataBuffer().toString("latin1");
    const partes = corpo.split(`--${fronteira}`).slice(1, -1).map((p) => p.slice(p.indexOf("\r\n\r\n") + 4).replace(/\r\n$/, ""));
    const b = JSON.parse(Buffer.from(partes[0], "latin1").toString("utf8"));
    const x = { id: `d${++n}`, name: b.name, parents: b.parents, mimeType: "file", dados: Buffer.from(partes[1], "latin1"), mod: agora };
    itens.set(x.id, x);
    return json(r, { id: x.id, md5Checksum: md5(x.dados) });
  }
  if (m === "PATCH" && id) {
    const x = itens.get(id);
    if (!visivel(x)) return r.fulfill({ status: 404, body: "nf" });
    if ((req.headers()["content-type"] ?? "").includes("application/json")) {
      const b = JSON.parse(req.postData());
      const add = u.searchParams.get("addParents"), rem = u.searchParams.get("removeParents");
      if (add && itens.get(add)?.mao) return r.fulfill({ status: 404, body: "sem acesso" });
      if (b.trashed) (x.lixo = true), (x.lixoEm = agora);
      if (b.name) x.name = b.name;
      if (rem) x.parents = x.parents.filter((p) => !rem.split(",").includes(p));
      if (add) x.parents = [...new Set([...x.parents, add])];
      return json(r, { id });
    }
    x.dados = req.postDataBuffer();
    x.mod = agora;
    return json(r, { id, md5Checksum: md5(x.dados) });
  }
  if (m === "DELETE" && id) {
    apagados.push(itens.get(id)?.name ?? id);
    itens.delete(id);
    return r.fulfill({ status: 204, body: "" });
  }
  return r.fulfill({ status: 400, body: "?" });
}

(async () => {
  const b = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, hasTouch: true, isMobile: true, deviceScaleFactor: CAPTURAS ? 2 : 1 });
  await ctx.addInitScript(() => {
    localStorage.setItem("jlscad:interface", JSON.stringify({ dispositivo: "tablet", caixaFlutuante: false }));
    localStorage.setItem("wjgoogle:autorizado", "1");
    localStorage.setItem("wjgoogle:acesso", JSON.stringify({ token: "ok", expira: Date.now() + 3600000 }));
  });
  await ctx.route(/googleapis\.com|accounts\.google\.com/, responder);
  const p = await ctx.newPage();
  p.on("pageerror", (e) => console.log("erro na página:", e.message));
  p.on("dialog", (d) => d.accept());

  // 1) cofre com CAD (Eixo, Mancal, Bucha protegida, Arruela em GO-OUT da Ana, Sub/Tampa) e Projetos
  //    (Pino); a sincronia ao abrir monta Meu Drive/WJPDM
  await p.goto(BASE + "pdm/");
  await p.waitForTimeout(800);
  await p.evaluate(async () => {
    const { Armazem } = await import("/src/comum/armazem.ts");
    const db = await Armazem.abrir();
    const t = new Date().toISOString();
    await db.por("meta", { id: "meta", nome: "Cofre", usuario: "Johann", mascara: "12-####", mod: t });
    for (const [id, nome, pai] of [["p1", "CAD", null], ["p2", "Projetos", null], ["p3", "Sub", "p1"]]) await db.por("pastas", { id, nome, pai, mod: t });
    const arqs = [["a1", "Eixo.wjcad", "p1"], ["a2", "Mancal.wjcad", "p1"], ["a3", "Tampa.wjcad", "p3"], ["a4", "Pino.wjcad", "p2"], ["a5", "Bucha.wjcad", "p1", { estado: "serie-prod" }], ["a6", "Arruela.wjcad", "p1", { checkout: { usuario: "Ana", data: t } }], ["a7", "Porca.wjcad", "p2"]];
    for (const [id, nome, pasta, extra] of arqs) {
      await db.porBlob(`b-${id}`, new Blob([`conteúdo de ${nome}`]));
      await db.por("arquivos", { id, nome, pasta, revisao: "", estado: "trabalho", cartao: {}, mod: t, historico: [], ...(extra ?? {}),
        versoes: [{ n: 1, blob: `b-${id}`, tamanho: 20, autor: "Johann", data: t, comentario: "", revisao: "", estado: "trabalho" }] });
    }
  });
  await p.reload();
  // espera a sincronia terminar (pastas.json é a última coisa gravada no espelho)
  for (let k = 0; k < 80 && !arquivoEm("WJPDM/.wjpdm/pastas.json"); k++) await p.waitForTimeout(250);
  await p.waitForTimeout(1500);
  conferir(!!arquivoEm("WJPDM/CAD/Mancal.wjcad") && !!arquivoEm("WJPDM/CAD/Sub/Tampa.wjcad"), "a sincronia ao abrir montou Meu Drive/WJPDM");

  // 2) o Johann mexe direto no Drive
  const agoraMao = new Date().toISOString();
  pastaEm("WJPDM/CAD").name = "CAD 2026";
  arquivoEm("WJPDM/CAD 2026/Mancal.wjcad").parents = [pastaEm("WJPDM/Projetos").id];
  const mao = { id: `m${++n}`, name: "Arquivo morto", parents: [pastaEm("WJPDM").id], mimeType: PASTA, mao: true, mod: agoraMao };
  itens.set(mao.id, mao);
  arquivoEm("WJPDM/CAD 2026/Sub/Tampa.wjcad").parents = [mao.id];
  Object.assign(arquivoEm("WJPDM/Projetos/Pino.wjcad"), { lixo: true, lixoEm: agoraMao });
  Object.assign(arquivoEm("WJPDM/CAD 2026/Bucha.wjcad"), { lixo: true, lixoEm: agoraMao });
  arquivoEm("WJPDM/CAD 2026/Arruela.wjcad").parents = [pastaEm("WJPDM/Projetos").id];
  Object.assign(arquivoEm("WJPDM/CAD 2026/Eixo.wjcad"), { dados: Buffer.from("mexido à mão"), mod: agoraMao });

  // 3) abrir o WJPDM de novo: sem janela de perguntas; aviso único com "Ver detalhes"
  await p.reload();
  const avisou = await p.waitForSelector(".wjc-aviso-fora", { timeout: 20000 }).then(() => true, () => false);
  const aviso = avisou ? (await p.locator(".wjc-aviso-fora span").innerText()).replace(/\s+/g, " ") : "";
  console.log("  aviso: " + aviso);
  if (process.env.DEPURAR) console.log("DRIVE", [...itens.values()].filter((x) => !naLixeira(x)).map((x) => `${x.id}:${caminho(x)}${x.mao ? "(mão)" : ""}`).join(" | "));
  conferir(avisou, "o aviso aparece sozinho ao abrir");
  conferir(/^Cofre atualizado pelo Drive: 1 movido, 1 renomeado, 1 para a lixeira/.test(aviso), "aviso: \"Cofre atualizado pelo Drive: 1 movido, 1 renomeado, 1 para a lixeira…\"");
  conferir(/2 desfeitos/.test(aviso) && /pasta criada à mão/.test(aviso) && /editado fora do app/.test(aviso), "aviso conta os desfeitos, a pasta criada à mão e o editado");
  conferir(await p.locator(".wjc-fora").count() === 0, "nenhuma janela de perguntas abriu");
  if (CAPTURAS) await p.screenshot({ path: `${CAPTURAS}/aviso-fora.png` });
  await p.locator(".wjc-aviso-fora [data-v]").tap();
  await p.waitForSelector(".wjc-fora li");
  const linhas = await p.$$eval(".wjc-fora li", (ls) => ls.map((l) => l.innerText.replace(/\s+/g, " ").trim()));
  console.log("  " + linhas.join("\n  "));
  conferir(linhas.length === 7, "Ver detalhes: sete mudanças");
  conferir(linhas.some((l) => /CAD .*Renomeada no Drive.*de CAD para CAD 2026/.test(l)), "pasta renomeada: de CAD para CAD 2026");
  conferir(linhas.some((l) => /Mancal.*Movido no Drive.*para Projetos\/Mancal\.wjcad/.test(l)), "arquivo movido: de → para");
  conferir(linhas.some((l) => /Pino.*lixeira do cofre/.test(l)), "excluído: lixeira do cofre");
  conferir(linhas.some((l) => /Bucha.*Desfeito.*Série em produção" não deixa excluir/.test(l)), "estado protegido: desfeito, com o motivo");
  conferir(linhas.some((l) => /Arruela.*Desfeito.*GO-OUT com Ana/.test(l)), "GO-OUT: desfeito, com o motivo");
  conferir(linhas.some((l) => /Tampa.*pasta criada à mão.*Crie a pasta pelo WJPDM/.test(l)), "pasta criada à mão: aviso \"crie a pasta pelo WJPDM\"");
  conferir(linhas.some((l) => /Eixo.*Editado fora do app.*vale a cópia do cofre/.test(l)), "editado fora do app: vale a cópia do cofre");
  if (CAPTURAS) await p.screenshot({ path: `${CAPTURAS}/ver-detalhes.png` });
  await p.locator(".wjc-fora [data-ok]").tap();
  await p.waitForTimeout(500);
  const drive = arquivos();
  console.log("  Drive: " + drive.join(", "));
  conferir(drive.includes("WJPDM/Projetos/Mancal.wjcad") && drive.includes("WJPDM/CAD 2026/Eixo.wjcad"), "Drive como ele deixou (Mancal em Projetos, CAD 2026)");
  conferir(drive.includes("WJPDM/CAD 2026/Bucha.wjcad") && drive.includes("WJPDM/CAD 2026/Arruela.wjcad"), "exceções de volta no Drive (Bucha recriada, Arruela de volta)");
  conferir(!drive.includes("WJPDM/Projetos/Pino.wjcad") && drive.filter((x) => x.endsWith("Tampa.wjcad")).length === 1, "Pino fora e Tampa sem cópia repetida");
  conferir(String(arquivoEm("WJPDM/CAD 2026/Eixo.wjcad")?.dados) === "conteúdo de Eixo.wjcad", "conteúdo editado à mão: vale o do cofre");
  conferir(!pastaEm("WJPDM/CAD") && [...itens.values()].filter((x) => x.mimeType === PASTA && !naLixeira(x) && x.name === "CAD 2026").length === 1, "sem pasta duplicada");
  conferir(apagados.length === 0, "nada apagado de vez no Drive (nenhum DELETE)");
  const est = await p.evaluate(() => window.__pdm.estado());
  const a = (id) => est.arquivos.find((x) => x.id === id);
  conferir(est.pastas.find((x) => x.id === "p1")?.nome === "CAD 2026", "cofre: pasta renomeada");
  conferir(a("a2").pasta === "p2" && /Movido no Drive de .*Mancal\.wjcad para Projetos\/Mancal\.wjcad/.test(a("a2").historico.at(-1)?.texto ?? ""), "cofre: Mancal movido, com histórico");
  conferir(a("a4").lixeira === true && a("a4").versoes.length === 1, "cofre: Pino na lixeira, versões preservadas");
  conferir(!a("a5").lixeira && a("a6").pasta === "p1" && a("a3").pasta === "p3", "cofre: exceções e Tampa no lugar do cofre");
  conferir(await p.locator(".pd-arvore", { hasText: "CAD 2026" }).count() === 1, "a árvore mostra CAD 2026");

  // 4) recarregar: nada novo, o aviso não volta; o botão "Mudanças no Drive" mostra o registro
  await p.reload();
  await p.waitForTimeout(6000);
  conferir(await p.locator(".wjc-aviso-fora").count() === 0, "sincronia seguinte: o aviso não se repete");
  await p.locator(".wj-aba", { hasText: "Ferramentas" }).tap();
  await p.locator('.wj-cmd[title^="O que foi movido"]').first().tap();
  await p.waitForSelector(".wjc-fora li");
  conferir(await p.locator(".wjc-fora li").count() === 7, "botão Mudanças no Drive: o registro das mudanças");
  await p.locator(".wjc-fora [data-ok]").tap();

  // 4b) em outro app (página inicial) o aviso também aparece: Porca excluída à mão
  Object.assign(arquivoEm("WJPDM/Projetos/Porca.wjcad"), { lixo: true, lixoEm: new Date().toISOString() });
  await p.goto(BASE);
  const avisoInicio = await p.waitForSelector(".wjc-aviso-fora", { timeout: 20000 }).then(async () => (await p.locator(".wjc-aviso-fora span").innerText()).replace(/\s+/g, " "), () => "");
  console.log("  início: " + avisoInicio);
  conferir(/^Cofre atualizado pelo Drive: 1 para a lixeira\.$/.test(avisoInicio), "página inicial: \"Cofre atualizado pelo Drive: 1 para a lixeira\"");
  await p.goto(BASE + "pdm/");
  await p.waitForTimeout(1500);
  await p.locator(".wj-aba", { hasText: "Arquivos" }).tap().catch(() => {});

  // 5) mover pasta inteira (pasta selecionada → Mover) — Sub para dentro de Projetos
  await p.locator(`.pd-no[data-pasta="p1"]`).tap();
  await p.waitForTimeout(300);
  await p.locator('tr[data-pasta="p3"]').tap();
  await p.locator('.wj-cmd[title^="Mover o arquivo"]').tap();
  await p.waitForSelector("#mv-p");
  const vMov = await p.locator('#mv-p option', { hasText: "Projetos" }).first().getAttribute("value");
  await p.locator("#mv-p").selectOption(vMov);
  await p.locator(".wj-janela footer button", { hasText: "Mover" }).tap();
  await p.waitForTimeout(500);
  const est2 = await p.evaluate(() => window.__pdm.estado());
  conferir(est2.pastas.find((x) => x.id === "p3")?.pai === "p2", "mover pasta: Sub foi para dentro de Projetos");

  // 6) marcar vários (toque nas caixinhas) e mover de uma vez para Projetos
  await p.locator(`.pd-no[data-pasta="p1"]`).tap();
  await p.waitForTimeout(300);
  for (const id of ["a1", "a5"]) await p.locator(`tr[data-arquivo="${id}"] .pd-marca`).tap();
  const barra = await p.locator("#pd-marcados").innerText().catch(() => "");
  conferir(/2 arquivo\(s\) marcado\(s\)/.test(barra), "barra dos marcados: 2 arquivos");
  if (CAPTURAS) await p.screenshot({ path: `${CAPTURAS}/marcados.png` });
  await p.locator('#pd-marcados [data-m="mover"]').tap();
  await p.waitForSelector("#mv-p");
  const vProj = await p.locator('#mv-p option', { hasText: "Projetos" }).first().getAttribute("value");
  await p.locator("#mv-p").selectOption(vProj);
  await p.locator(".wj-janela footer button", { hasText: "Mover" }).tap();
  await p.waitForTimeout(500);
  const est3 = await p.evaluate(() => window.__pdm.estado());
  conferir(["a1", "a5"].every((id) => est3.arquivos.find((a) => a.id === id)?.pasta === "p2"), "mover vários: Eixo e Bucha foram para Projetos");
  conferir(await p.locator("#pd-marcados").count() === 0, "a barra some depois de mover");

  await b.close();
  console.log(falhas.length ? `\n${falhas.length} falha(s)` : "\nroteiro: tudo certo");
  process.exit(falhas.length ? 1 : 0);
})();
