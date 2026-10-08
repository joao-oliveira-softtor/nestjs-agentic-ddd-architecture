# Identificação

- ID: `entity:Task`
- Camada: domain
- Módulo: tasks
- source: `app/domain/task.ts:5`
- Estado: declared
- specHash: `e812964d310ea8fde3c4fa0dc8891177adc0150b7579cbea24c2fa8c61c8837c`
- Dependências: —

## Especificação

Declaração, regras de construção e contratos referenciados:

```json
{
  "contracts": [
    {
      "description": "Uma tarefa foi criada.",
      "id": "event:TaskCreated",
      "module": "tasks",
      "name": "TaskCreated",
      "payloadSchema": {
        "additionalProperties": false,
        "properties": {
          "taskId": {
            "type": "string"
          },
          "title": {
            "type": "string"
          }
        },
        "required": [
          "taskId",
          "title"
        ],
        "type": "object"
      }
    }
  ],
  "declaration": {
    "description": "Tarefa com título e ciclo de vida pendente ou concluído.",
    "id": "entity:Task",
    "invariants": [
      {
        "id": "invariant:Task/titulo-obrigatorio",
        "on": null,
        "text": "Toda tarefa precisa de título não vazio."
      }
    ],
    "methods": [
      {
        "description": "Cria uma tarefa pendente e remove espaços nas extremidades do título.",
        "emits": [
          "event:TaskCreated"
        ],
        "id": "method:Task.create",
        "name": "create",
        "static": true,
        "transition": null
      }
    ],
    "module": "tasks",
    "name": "Task",
    "states": [
      "pending",
      "completed"
    ]
  }
}
```

## Obrigações de teste

- `invariant:Task/titulo-obrigatorio` — teste com `covers`.
- `method:Task.create` — teste com `covers`.

## Regras do executor

- Altere só o corpo deste item e arquivos de teste.
- Não altere decorators, declarações, propostas nem arquivos gerados.
- Não implemente outros itens. Preserve os contratos e IDs de invariantes.

## Comando de verificação

```bash
bun run agentic verify --item entity:Task --spec-hash e812964d310ea8fde3c4fa0dc8891177adc0150b7579cbea24c2fa8c61c8837c --config agentic.config.ts --json
```
