import { AggregateRoot } from '@agentic-ddd/core';
import {
  AgentEntity,
  AgentPort,
  createRegistry,
  withRegistry,
  type Registry,
} from '@agentic-ddd/decorators';

export const PORTS_MODULE = {
  name: 'ports',
  path: 'src/compiler/__fixtures__',
} as const;

// Decorator de classe trivial, empilhado acima de @AgentPort em um dos casos.
function Outro(): ClassDecorator {
  return () => {};
}

function build(define: () => void): Registry {
  const registry = createRegistry();
  withRegistry(registry, define);
  return registry;
}

export function definePortOk(): Registry {
  return build(() => {
    @AgentEntity({ description: 'Conta.' })
    class Conta extends AggregateRoot<string> {}

    @AgentPort({
      description: 'Persistência de contas.',
      root: () => Conta,
      methods: { salvar: 'Grava a conta.', buscar: 'Busca a conta.' },
    })
    abstract class ContaRepository {
      abstract salvar(c: Conta): Promise<void>;
      abstract buscar(id: string): Promise<Conta>;
      auxiliar(): void {}
    }
    void ContaRepository;
  });
}

export function definePortDivergente(): Registry {
  return build(() => {
    @AgentEntity({ description: 'Conta.' })
    class Conta extends AggregateRoot<string> {}

    @AgentPort({
      description: 'Falta declarar buscar.',
      root: () => Conta,
      methods: { salvar: 'Grava.' },
    })
    abstract class Faltando {
      abstract salvar(): void;
      abstract buscar(): void;
    }

    @AgentPort({
      description: 'Sobra apagar.',
      root: () => Conta,
      methods: { salvar: 'Grava.', apagar: 'Apaga.' },
    })
    abstract class Sobrando {
      abstract salvar(): void;
    }
    void Faltando;
    void Sobrando;
  });
}

export function definePortEmpilhado(): Registry {
  return build(() => {
    @AgentEntity({ description: 'Conta.' })
    class Conta extends AggregateRoot<string> {}

    @Outro()
    @AgentPort({
      description: 'Com decorator empilhado.',
      root: () => Conta,
      methods: { salvar: 'Grava.' },
    })
    abstract class Empilhado {
      abstract salvar(): void;
    }
    void Empilhado;
  });
}

export function definePortNomeLiteral(): Registry {
  return build(() => {
    @AgentEntity({ description: 'Turma.' })
    class Turma extends AggregateRoot<string> {}

    @AgentPort({
      description: 'Contagem por turma.',
      root: () => Turma,
      methods: { 'contar-por-turma': 'Conta alunos por turma.' },
    })
    abstract class Contagem {
      abstract 'contar-por-turma'(): number;
    }
    void Contagem;
  });
}

export function definePortsHomonimos(): Registry {
  const registry = createRegistry();
  withRegistry(registry, () => {
    @AgentEntity({ description: 'Conta.' })
    class Conta extends AggregateRoot<string> {}

    @AgentPort({
      description: 'Primeiro Repo.',
      root: () => Conta,
      methods: { salvar: 'Grava.' },
    })
    abstract class Repo {
      abstract salvar(): void;
    }
    void Repo;
  });
  withRegistry(registry, () => {
    @AgentEntity({ description: 'Outra.' })
    class Outra extends AggregateRoot<string> {}

    @AgentPort({
      description: 'Segundo Repo, que diverge.',
      root: () => Outra,
      methods: { listar: 'Lista.' },
    })
    abstract class Repo {
      abstract buscar(): void;
    }
    void Repo;
  });
  return registry;
}

export function definePortSobrecarga(): Registry {
  return build(() => {
    @AgentEntity({ description: 'Conta.' })
    class Conta extends AggregateRoot<string> {}

    @AgentPort({
      description: 'Método sobrecarregado.',
      root: () => Conta,
      methods: { achar: 'Acha.' },
    })
    abstract class Sobrecarga {
      abstract achar(id: string): void;
      abstract achar(id: number): void;
    }
    void Sobrecarga;
  });
}

export function definePortConcreto(): Registry {
  return build(() => {
    @AgentEntity({ description: 'Conta.' })
    class Conta extends AggregateRoot<string> {}

    @AgentPort({
      description: 'Classe não abstrata.',
      root: () => Conta,
      methods: {},
    })
    class Concreto {}
    void Concreto;
  });
}
