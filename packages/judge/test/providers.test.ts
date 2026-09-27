// Any provider's key works for the judge: detected from its prefix, schema converted for structured outputs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectProvider } from '@nocap/shared';
import { toJsonSchema } from '../src/providers';
import { SPEND_EXTRACTION_SCHEMA } from '../src/prompts/spend';

test('detects the provider from the key prefix', () => {
  const cases: [string, string | undefined][] = [
    ['AIzaSyExampleExampleExampleExample1234', 'gemini'],
    ['AQ.Ab8RN6exampleexampleexampleexample', 'gemini'],
    ['sk-ant-api03-exampleexampleexample', 'anthropic'],
    ['sk-proj-exampleexampleexampleexample', 'openai'],
    ['sk-exampleexampleexampleexample', 'openai'],
    ['sk-or-v1-exampleexampleexample', 'openrouter'],
    ['gsk_exampleexampleexampleexample', 'groq'],
    ['xai-exampleexampleexampleexample', 'xai'],
    ['not-a-known-key-format-at-all', undefined],
  ];
  for (const [key, id] of cases) assert.equal(detectProvider(key, '')?.id, id, key);
});

test('NOCAP_PROVIDER overrides detection', () => {
  assert.equal(detectProvider('some-local-server-key', 'openai')?.id, 'openai');
});

test('Gemini schema converts to strict JSON Schema', () => {
  const json = toJsonSchema(SPEND_EXTRACTION_SCHEMA) as any;
  assert.equal(json.type, 'object');
  assert.equal(json.additionalProperties, false);
  assert.deepEqual(json.required, Object.keys(json.properties));
  assert.deepEqual(json.properties.model, { anyOf: [{ type: 'string' }, { type: 'null' }] });
  assert.deepEqual(json.properties.provider.enum, ['openai', 'anthropic', 'gemini', 'cohere', 'voyage', 'unknown']);
  const item = json.properties.per_item_calls.items;
  assert.equal(item.additionalProperties, false);
  assert.equal(item.properties.kind.type, 'string');
});
