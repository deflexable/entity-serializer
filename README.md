# entity-serializer

Serialize and deserialize all javascript data types in the browser and node.js

This library exports `serialize` and `deserialize` method that are similar to that of [node.js v8](https://github.com/nodejs/node/blob/v22.x/lib/v8.js)

## Installation

```sh
npm install entity-serializer
```

or using yarn

```sh
yarn add entity-serializer
```

## Examples

```js
const { deserialize, serialize } = require("entity-serializer");

// complex data
const data = {
  field_1: new ArrayBuffer(3),
  field_2: {
    deep: [{ nested: "test" }, { nested_2: /test2/g }],
  },
  buffer_test: Buffer.from("Donald Trump", "utf8"),
  field_3: { g: { path: { url: "example.com" } } },
  mappers: new Map([[{ accessor: "testing" }, true]]),
  sets: new Set([1, 2, 3]),
};

data.field_3.circular_test = new Map([[data.field_3, "circular_mapper"]]);

// encode the data
const serialized = serialize(data);
// decode the data
const deserialized = deserialize(serialized);

// output: <Buffer 01 06 4f 42 4a 45 ... 456 more bytes>
console.log("serialized:", serialized);

// original data
console.log("deserialized:", deserialized);
```
