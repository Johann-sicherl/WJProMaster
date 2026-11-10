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
| 10/11 | Esboço sobre a peça: cota até aresta sem criar linha, esboço com prioridade na seleção, caixa no Espelhar/Deslocar/Padrões | Esboço: cota, seleção e caixa (arquivada) | #113 | US$ 5,92 | 3/3 | pendente |
| 10/11 | Cota reabre para edição com a Cota ativa; ✓/✕ de cada ferramenta lado a lado no painel; sair/descartar lado a lado na vista | Cota reabre para edição e confirmação de ferramentas | #114 | US$ 5,93 | 2/2 | pendente |
| 10/11 | Mesclar: cola ruído ≤ 0,001 mm, aviso com a folga medida quando o corpo fica separado; planos novos com origem fixa; aviso de entidade < 0,5 mm | Mesclar/unir corpos em contato | #115 | ≈ US$ 3 | 1/1 (causa real ≠ diagnóstico da central) | pendente |
| 10/11 | Cofre: GO-IN não trava (janela do Google pedida 2×), comentário no GO-IN, GO-OUT/GO-IN/Desfazer por componente na Montagem, perguntar GO-OUT ou consulta ao abrir | Cofre GO-IN/GO-OUT e comentários | #116 | ≈ US$ 2,50 | 4/4 | pendente |

Referência do método antigo: conversa "Software CAD" (21/10 → 10/11), 68 PRs, ≈ US$ 688 ≈ US$ 10,10 por
entrega, contexto até 773 mil tokens. Método novo até aqui (7 entregas, 10/11): ≈ US$ 31 ≈ US$ 4,50 por entrega (amostra pequena).

## 5. Pendências e conversas em andamento

- **Nada em andamento** (10/11, depois do #116). Conversas a arquivar: as do #114, #115 e #116.
- **TAMPA_JANELA (ação do Johann):** a peça continua com 3 corpos de propósito (folga real de 0,0328 mm
  no gancho da Extrusão2; Extrusão3 apoiada só por aresta) — prender a base do gancho no piso no Esboço2,
  apoiar a nervura numa face, apagar os 2 arcos de 0,27 mm e trocar os "Fixo" por cotas.
- **Ideia anotada (não pedida):** recurso de gancho de encaixe (snap-fit) pronto.
- **Lição da central:** o diagnóstico "faces só encostam" estava errado (era folga real). Nos pedidos,
  dar a causa como *provável* e pedir para medir/reproduzir antes de corrigir — foi o que salvou.
- **Ideia em aberto:** jeito rápido de suprimir relações automáticas no tablet (hoje só Ctrl no teclado
  ou a chave em ⚙ Configurações) — o Johann ainda não pediu.
- **Pendências das entregas:** linhas de inferência pontilhadas e Tangente automática em arcos (F3,
  `docs/funcional/sketch.md`).
- Conversa antiga "Software CAD": mantida só para consulta; não usar para pedidos novos.
