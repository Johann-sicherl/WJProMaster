# Central de eficiência e orquestração do WJProMaster

> Estado da "central": a conversa em que o Johann aprende a pedir melhor e o Claude aprimora pedidos,
> confere entregas e acompanha as conversas de código. **A central não altera código do app.**
> Ao trocar de central (contexto acima de ~350 mil tokens ou aviso de conversa resumida), abrir conversa
> nova e colar:
>
> ```
> Você é a central de eficiência e orquestração do WJProMaster.
> Leia docs/global/central.md e continue de onde a anterior parou.
> ```
>
> Manter este arquivo atualizado a cada entrega conferida (regra: o que não está escrito aqui se perde
> na troca). Criado em 10/11/2026.

## 1. Papel da central

1. **Aprimorar pedidos** antes de o Johann colar numa conversa de código: levantar no código o estado
   atual e a causa provável (com `arquivo:linha`), fechar decisões com perguntas de múltipla escolha,
   dividir por assunto e indicar a ordem das conversas.
2. **Conferir entregas**: ler o PR/branch, juntar com o `main` e rodar `pnpm check && pnpm teste &&
   pnpm build`, conferir item por item contra o pedido, o CI e a publicação. Relatar em tabela.
3. **Acompanhar conversas** (`list_sessions`, `list_events`, `get_session`): situação, custo, contexto
   usado; dizer quando arquivar ou abrir conversa nova. Não fazer merge por elas.
4. **Medir** custo por entrega e acerto (tabela da §4).
5. Avisar quando a própria central passar de ~350 mil tokens.

## 2. Combinados com o Johann (10/11/2026)

- **Uma conversa por assunto**; entregou e publicou → **arquivar** (não apagar: arquivar é reversível
  e custa o mesmo). Ajuste posterior no mesmo assunto → conversa nova, não reabrir a arquivada.
- Assuntos que mexem nos mesmos arquivos (ex.: `src/main.ts`) **não rodam em paralelo**: um publica,
  depois o outro começa.
- Pedidos não repetem regras (testes, tablet, PR, publicação, português): já estão no `CLAUDE.md`.
- Resposta das conversas: resumo + link do PR; código só quando ele pedir.

## 3. Modelo de pedido

```
Face/lugar: WJCAD › Peça › …
Hoje: … (erro: passos para reproduzir; causa provável com arquivo:linha, se a central achou)
Quero: … (padrões, tolerâncias, chave liga/desliga, desfazer, o que fica de fora)
Aparelho: tablet com caneta (principal) e dedo; também mouse no computador.
Atualizar o status em docs/funcional/<arquivo>.md.
```

## 4. Registro de entregas (custo e acerto)

"Aceita" = o Johann testou e disse ok sem retrabalho. Acerto = aceitas sem retrabalho ÷ testadas.

| Data | Entrega | Conversa | PR | Custo | Itens pedidos/entregues | Testada pelo Johann |
|---|---|---|---|---|---|---|
| 10/11 | Tela ⚙ Configurações do WJCAD + sentido e passo do zoom da roda | WJCAD settings screen with mouse zoom (arquivada) | #110 | US$ 5,94 | 3/3 | pendente |
| 10/11 | Filete/chanfro em canto unido por Coincidente (inclusive com a origem) | Filete/Chanfro e relações automáticas (arquivada) | #111 | US$ 7,98 (as duas) | 1/1 | pendente |
| 10/11 | Relações automáticas no esboço (H/V, colinear, paralela, perpendicular, coincidente ao soltar; chave e Ctrl) | idem | #111 | (acima) | 7/7 | pendente |

Referência do método antigo: conversa "Software CAD" (21/10 → 10/11), 68 PRs, ≈ US$ 688 ≈ US$ 10,10 por
entrega, contexto até 773 mil tokens. Método novo até aqui: ≈ US$ 4,60 por entrega (amostra pequena).

## 5. Pendências e conversas em andamento

- **Em andamento:** "Esboço: cota, seleção e caixa" (aberta 10/11) — cota até aresta da peça sem criar
  linha no esboço; entidades do esboço com prioridade sobre arestas da peça; seleção por caixa dentro
  do Espelhar, Deslocar e Padrões. Conferir quando terminar.
- **Ideia em aberto:** jeito rápido de suprimir relações automáticas no tablet (hoje só Ctrl no teclado
  ou a chave em ⚙ Configurações) — o Johann ainda não pediu.
- **Pendências das entregas:** linhas de inferência pontilhadas e Tangente automática em arcos (F3,
  `docs/funcional/sketch.md`).
- Conversa antiga "Software CAD": mantida só para consulta; não usar para pedidos novos.
