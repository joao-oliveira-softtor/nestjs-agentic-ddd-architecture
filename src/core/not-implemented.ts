export class NotImplementedError extends Error {
  constructor() {
    super('Corpo declarado e ainda não implementado (notImplemented)');
    this.name = 'NotImplementedError';
  }
}

export function notImplemented(): never {
  throw new NotImplementedError();
}
