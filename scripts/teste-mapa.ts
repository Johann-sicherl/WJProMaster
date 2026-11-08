// Confere se a skill de mapa do código (.claude/skills/wjpromaster-mapa/SKILL.md) está em dia:
// todo arquivo de src/ e todo scripts/teste-*.ts aparece no mapa, e todo caminho citado no mapa existe.
// Também confere as listas que várias sessões editam juntas (páginas no Vite e no sw.js, testes no pnpm teste).
// Um arquivo conta como citado quando alguma linha tem o caminho completo, ou o nome do arquivo junto
// com a pasta dele (ex.: "`src/montagem/main.ts`, `solver.ts`").
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";

const MAPA = ".claude/skills/wjpromaster-mapa/SKILL.md";
const texto = readFileSync(MAPA, "utf8");
const linhas = texto.split("\n");
const falhas: string[] = [];

const listar = (pasta: string): string[] =>
  readdirSync(pasta).flatMap((n) => {
    const c = join(pasta, n);
    return statSync(c).isDirectory() ? listar(c) : [c];
  });

const citado = (arq: string): boolean => {
  const nome = basename(arq);
  const pasta = dirname(arq) + "/";
  return linhas.some((l) => l.includes(arq) || (l.includes(nome) && l.includes(pasta) && pasta !== "src/"));
};

for (const arq of listar("src").filter((a) => /\.(ts|css)$/.test(a) && !a.endsWith(".css"))) {
  if (!citado(arq)) falhas.push(`fora do mapa: ${arq}`);
}
for (const n of readdirSync("scripts").filter((n) => /^teste-.*\.ts$/.test(n))) {
  if (!texto.includes(n)) falhas.push(`teste fora do mapa: scripts/${n}`);
}

// Caminhos citados no mapa precisam existir (arquivos sem curinga).
for (const m of texto.matchAll(/`((?:src|docs|scripts|public)\/[^`*<\s]+?\.(?:ts|cjs|md|js))`/g)) {
  if (!existsSync(m[1])) falhas.push(`mapa cita arquivo inexistente: ${m[1]}`);
}

// Listas que várias sessões editam ao mesmo tempo (uma linha cada): ao juntar trabalhos, nenhuma
// entrada pode sumir. Toda página (pasta com index.html) precisa estar no Vite e no service worker,
// e todo scripts/teste-*.ts precisa rodar no "pnpm teste".
const FORA = new Set(["node_modules", "dist", "public", ".git", ".github", ".claude", "docs", "scripts", "src"]);
const paginas: string[] = [];
const procurarPaginas = (pasta: string, nivel: number) => {
  for (const n of readdirSync(pasta || ".")) {
    const c = pasta ? `${pasta}/${n}` : n;
    if (n === "index.html") paginas.push(pasta ? `${pasta}/` : "./");
    else if (nivel < 3 && !FORA.has(n) && !n.startsWith(".") && statSync(c).isDirectory()) procurarPaginas(c, nivel + 1);
  }
};
procurarPaginas("", 0);
const vite = readFileSync("vite.config.ts", "utf8");
const sw = readFileSync("public/sw.js", "utf8").match(/const PAGINAS = \[([^\]]*)\]/)?.[1] ?? "";
for (const p of paginas) {
  const html = p === "./" ? "index.html" : `${p}index.html`;
  if (!vite.includes(`"${html}"`)) falhas.push(`página fora do vite.config.ts (rollupOptions.input): ${html}`);
  if (!sw.includes(`"${p}"`)) falhas.push(`página fora de PAGINAS em public/sw.js: ${p}`);
}
const scriptTeste = (JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> }).scripts.teste;
for (const n of readdirSync("scripts").filter((n) => /^teste-.*\.ts$/.test(n))) {
  if (!scriptTeste.includes(`scripts/${n}`)) falhas.push(`teste fora do "pnpm teste" (package.json): scripts/${n}`);
}

if (falhas.length) {
  console.error(`Mapa do código ou listas do projeto desatualizados (${MAPA}, vite.config.ts, public/sw.js, package.json):\n  ` + falhas.join("\n  "));
  process.exit(1);
}
console.log("mapa do código: ok");
