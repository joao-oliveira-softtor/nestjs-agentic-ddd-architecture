import { baseDelta } from '../../delta/additions-fixture';
import type { Delta } from '../../delta/schema';

const ex = [
  // eslint-disable-next-line unicorn/no-thenable
  { given: 'a paid order', when: 'it is refunded', then: 'it is open' },
];

/** Brand-new elements of every kind, with a transition, optional and list-typed parameters. */
export function richDelta(): Delta {
  return {
    ...baseDelta(),
    module: 'shop',
    entities: [
      {
        name: 'Cart',
        description: 'A cart.',
        states: ['open', 'closed'],
        invariants: [
          { id: 'cart-not-empty', text: 'A cart needs items.', examples: ex },
        ],
        methods: [
          {
            name: 'close',
            description: 'Closes the cart.',
            params: [
              { name: 'note?', type: 'string' },
              { name: 'tags', type: 'string[]' },
              { name: 'at', type: 'Date' },
            ],
            returns: 'void',
            transition: { from: ['open'], to: 'closed' },
            emits: ['CartClosed'],
            invariants: [
              {
                id: 'close-needs-open',
                text: 'Only open carts close.',
                examples: ex,
              },
            ],
          },
        ],
      },
    ],
    valueObjects: [
      {
        name: 'Money',
        description: 'An amount.',
        fields: [{ name: 'amount', type: 'number' }],
      },
    ],
    ports: [
      {
        name: 'CartRepository',
        description: 'Stores carts.',
        root: 'Cart',
        methods: [
          {
            name: 'save',
            description: 'Saves.',
            params: [{ name: 'cart', type: 'Cart' }],
            returns: 'void',
          },
        ],
      },
    ],
    events: [
      {
        name: 'CartClosed',
        entity: 'Cart',
        description: 'Closed.',
        payload: [{ name: 'cartId', type: 'string' }],
      },
    ],
    useCases: [
      {
        name: 'close_cart',
        description: 'Closes a cart.',
        whenToUse: 'At checkout.',
        input: [{ name: 'cartId', type: 'string' }],
        output: [{ name: 'ok', type: 'boolean' }],
        uses: ['method:Cart.close'],
        emits: ['CartClosed'],
        ports: ['CartRepository'],
      },
    ],
  };
}

/** Patterns that would mean TypeScript leaked into a language-neutral text. */
const TS_LEAKS: readonly [string, RegExp][] = [
  ['ts path', /\.tsx?\b/],
  ['src path', /\bsrc\//],
  ['decorator', /@[A-Za-z]/],
  ['import', /\bimport\s/],
  ['export', /\bexport\s/],
  ['notImplemented', /notImplemented/],
  ['arrow', /=>/],
  [
    'type annotation',
    /\w\??:\s*(string|number|boolean|void|Date|unknown|any)\b/,
  ],
  ['bun', /\bbun\b/],
  ['class keyword', /\b(class|const|interface|async|await)\s/],
  ['generics', /\w<\w+>/],
  ['braces', /[{}]/],
];

const leaks = (text: string): string[] =>
  TS_LEAKS.filter(([, re]) => re.test(text)).map(([name]) => name);

/** model.json is data, so braces are structure: scan its keys and strings, not its syntax. */
function strings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value && typeof value === 'object')
    return Object.entries(value).flatMap(([k, v]) => [k, ...strings(v)]);
  return [];
}

export const neutralLeaks = (
  files: readonly { path: string; content: string }[],
): string[] =>
  files.flatMap((f) => {
    const texts = f.path.endsWith('.json')
      ? strings(JSON.parse(f.content))
      : [f.content];
    return texts.flatMap((t) =>
      leaks(t).map((l) => `${f.path}: ${l}: ${t.slice(0, 40)}`),
    );
  });
