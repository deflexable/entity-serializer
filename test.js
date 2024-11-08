
const { deserialize, serialize } = require('./index');

const data = {
    field_1: new ArrayBuffer(3),
    field_2: {
        deep: [{ nested: 'test' }, { nested_2: /test2/g }]
    },
    buffer_test: Buffer.from('Donald Trump', 'utf8'),
    field_3: { g: { path: { url: 'example.com' } } },
    mappers: new Map([[{ accessor: 'testing' }, true]]),
    sets: new Set([1, 2, 3])
};

data.field_3.circular_test = new Map([[data.field_3, 'circular_mapper']]);

const serialized = serialize(data);
const deserialized = deserialize(serialized);

console.log('serialized:', serialized);

console.log('deserialized:', deserialized);