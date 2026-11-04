// Várias janelas ao mesmo tempo (montagem, peça e desenho abertos juntos): cada janela/aba guarda
// o próprio salvamento automático e o vínculo com o arquivo do cofre numa chave dela ("…@<id>"),
// além da chave comum de sempre (que continua servindo para passar um documento de um app a outro e
// para reabrir o último trabalho numa janela nova). O id fica em `window.name`: sobrevive a recarregar
// a aba e não é copiado para as janelas que ela abre.

const REGISTRO = "wj:janelas";
const VALIDADE = 3 * 24 * 3600 * 1000; // chaves de janelas fechadas há mais de 3 dias saem

export function idJanela(): string {
  if (!window.name.startsWith("wj:")) window.name = `wj:${Math.random().toString(36).slice(2, 10)}`;
  return window.name.slice(3);
}

const daJanela = (base: string) => `${base}@${idJanela()}`;

function marcar() {
  try {
    const r = JSON.parse(localStorage.getItem(REGISTRO) ?? "{}") as Record<string, number>;
    r[idJanela()] = Date.now();
    localStorage.setItem(REGISTRO, JSON.stringify(r));
  } catch {
    /* sem armazenamento */
  }
}

/**
 * Fixa nesta janela o valor comum de agora (vazio = nenhum), se ela ainda não tem o seu: assim o
 * que outra janela gravar depois na chave comum não muda esta (ex.: vínculo com o cofre).
 */
export function fixarNaJanela(base: string) {
  try {
    if (localStorage.getItem(daJanela(base)) === null) localStorage.setItem(daJanela(base), localStorage.getItem(base) ?? "");
  } catch {
    /* sem armazenamento */
  }
}

/** Valor desta janela; se ela ainda não gravou nada, o comum (último gravado por qualquer janela). */
export function lerDaJanela(base: string): string | null {
  try {
    const proprio = localStorage.getItem(daJanela(base));
    return proprio !== null ? proprio || null : localStorage.getItem(base);
  } catch {
    return null;
  }
}

/** Grava nesta janela e na chave comum. Lança o erro se nem a desta janela couber. */
export function gravarNaJanela(base: string, valor: string) {
  localStorage.setItem(daJanela(base), valor);
  marcar();
  try {
    localStorage.setItem(base, valor);
  } catch {
    /* a comum pode não caber junto (documento grande): a desta janela já está gravada */
  }
}

/** Tira o valor desta janela e o comum (ex.: desligar o vínculo com o cofre). */
export function removerDaJanela(base: string) {
  try {
    localStorage.removeItem(daJanela(base));
    localStorage.removeItem(base);
  } catch {
    /* sem armazenamento */
  }
}

/** Apaga as chaves de janelas que não gravam nada há dias (chamado ao abrir cada app). */
export function podarJanelas() {
  try {
    const r = JSON.parse(localStorage.getItem(REGISTRO) ?? "{}") as Record<string, number>;
    const velhas = Object.keys(r).filter((id) => Date.now() - r[id] > VALIDADE && id !== idJanela());
    if (!velhas.length) return;
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && velhas.some((id) => k.endsWith(`@${id}`))) localStorage.removeItem(k);
    }
    for (const id of velhas) delete r[id];
    localStorage.setItem(REGISTRO, JSON.stringify(r));
  } catch {
    /* sem armazenamento */
  }
}

/**
 * Abre um endereço do WJProMaster numa janela nova (a atual continua aberta). Se o navegador
 * bloquear, abre na própria janela e devolve false.
 */
export function abrirEmNovaJanela(url: string): boolean {
  const w = window.open(url, "_blank");
  if (w) return true;
  location.href = url;
  return false;
}
