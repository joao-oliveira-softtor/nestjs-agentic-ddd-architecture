import 'reflect-metadata';
import { describe, expect, test } from 'bun:test';
import { AppModule } from '../src/app.module.js';

describe('AppModule', () => {
  test('não registra nenhum controller', () => {
    expect(Reflect.getMetadata('controllers', AppModule) ?? []).toEqual([]);
  });
});
