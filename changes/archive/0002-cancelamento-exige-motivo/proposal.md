---
id: "0002"
title: Cancelamento exige motivo
status: applied
origin: proposal-first
delta:
  added:
    - "invariant:Order/cancelamento-exige-motivo"
  modified:
    - "usecase:cancel_order"
  removed: []
acceptance:
  - id: rejeita-cancelamento-sem-motivo
    covers: ["invariant:Order/cancelamento-exige-motivo"]
    given: pedido pendente
    when: cancelar sem informar motivo ou com motivo em branco
    then: falha com CANCELLATION_REASON_REQUIRED, o pedido continua pendente e nenhum OrderCancelled é emitido
  - id: cancela-com-motivo
    covers: ["usecase:cancel_order"]
    given: pedido pendente
    when: cancel_order é chamado com reason
    then: o pedido fica cancelado e OrderCancelled é publicado
  - id: revisao-de-copy
    manual: true
    then: a mensagem de erro do cancelamento sem motivo foi revisada pelo time de produto
---

## Motivo

O atendimento precisa saber por que cada pedido foi cancelado para tratar reclamações e medir desistências. Hoje `cancel_order` aceita cancelar sem nenhuma justificativa.
