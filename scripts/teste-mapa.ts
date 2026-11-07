// Confere se a skill de mapa do código (.claude/skills/wjpromaster-mapa/SKILL.md) está em dia:
// todo arquivo de src/ e todo scripts/teste-*.ts aparece no mapa, e todo caminho citado no mapa existe.
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

if (falhas.length) {
  console.error(`Mapa do código desatualizado (${MAPA}):\n  ` + falhas.join("\n  "));
  process.exit(1);
}
console.log("mapa do código: ok");
