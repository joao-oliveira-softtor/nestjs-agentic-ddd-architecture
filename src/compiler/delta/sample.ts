import type { Delta } from './schema';

/** A small valid Delta shared by the delta tests. */
export function sampleDelta(): Delta {
  return {
    module: 'shop',
    entities: [
      {
        name: 'Product',
        description: 'A product of the catalog.',
        states: ['draft', 'published'],
        invariants: [
          { id: 'price-positive', text: 'The price is above zero.' },
        ],
        methods: [
          {
            name: 'create',
            description: 'Creates a draft product.',
            static: true,
            params: [
              { name: 'id', type: 'string' },
              { name: 'price', type: 'Money' },
              { name: 'tags?', type: 'string[]' },
            ],
            returns: 'Product',
            emits: ['ProductCreated'],
          },
          {
            name: 'publish',
            description: 'Publishes a draft product.',
            params: [],
            returns: 'void',
            transition: { from: ['draft'], to: 'published' },
            emits: ['ProductPublished'],
            invariants: [
              { id: 'publish-needs-stock', text: 'Needs stock to publish.' },
            ],
          },
        ],
      },
    ],
    valueObjects: [
      {
        name: 'Money',
        description: 'An amount of money.',
        fields: [
          { name: 'amount', type: 'number' },
          { name: 'currency?', type: 'string' },
        ],
      },
    ],
    ports: [
      {
        name: 'ProductRepository',
        description: 'Persistence of products.',
        root: 'Product',
        methods: [
          {
            name: 'save',
            description: 'Stores a product.',
            params: [{ name: 'product', type: 'Product' }],
            returns: 'void',
          },
          {
            name: 'findById',
            description: 'Finds a product.',
            params: [{ name: 'id', type: 'string' }],
            returns: 'Product',
          },
        ],
      },
    ],
    events: [
      {
        name: 'ProductCreated',
        entity: 'Product',
        description: 'A product was created.',
        payload: [{ name: 'productId', type: 'string' }],
      },
      {
        name: 'ProductPublished',
        entity: 'Product',
        description: 'A product was published.',
        payload: [
          { name: 'productId', type: 'string' },
          { name: 'at?', type: 'Date' },
        ],
      },
    ],
    useCases: [
      {
        name: 'publish_product',
        description: 'Publishes a product.',
        whenToUse: 'When a draft is ready.',
        whenNotToUse: 'For published products.',
        input: [{ name: 'product_id', type: 'string' }],
        output: [{ name: 'published', type: 'boolean' }],
        uses: ['method:Product.publish'],
        emits: ['ProductPublished'],
        ports: ['ProductRepository'],
      },
      {
        name: 'create_product',
        description: 'Creates a product.',
        whenToUse: 'When the catalog grows.',
        input: [{ name: 'product_id', type: 'string' }],
        output: [{ name: 'product_id', type: 'string' }],
        uses: ['method:Product.create'],
        emits: ['ProductCreated'],
      },
    ],
  };
}
