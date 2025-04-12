const { desegmentBinary, segmentBinary } = require('segment-binary');
const { Buffer } = require('buffer');

const niceReturn = (func) => {
    try {
        return func();
    } catch (_) { }
}

const isPrimitive = (item) => {
    return ['number', 'string', 'boolean', 'symbol'].includes(typeof item) || item === null;
};

function isObject(o) {
    if (typeof o !== 'object' || o === null) return false;
    return Object.prototype.toString.call(o) === '[object Object]'
        && Object.getPrototypeOf(o) === Object.prototype;
}

function regexFromString(str) {
    const parts = str.match(/^\/(.*)\/([a-z]*)$/);
    return new RegExp(parts[1], parts[2]);
}

const DataTypesAccessor = [
    ...[
        ['NaN', NaN],
        ['undefined', undefined],
        ['Infinity', Infinity]
    ].map(([name, v]) => ({
        name,
        isInstance: o => o === v,
        encode: _ => Buffer.alloc(0),
        decode: _ => v
    })),
    {
        name: 'BIGINT',
        isInstance: o => o instanceof BigInt,
        encode: o => Buffer.from(o.toString(), 'utf8'),
        decode: o => BigInt(o.toString('utf8'))
    },
    {
        name: 'JSON',
        isInstance: isPrimitive,
        encode: o => Buffer.from(JSON.stringify(o), 'utf8'),
        decode: o => JSON.parse(o.toString('utf8'))
    },
    {
        name: 'ARRAY',
        isInstance: o => Array.isArray(o),
        encode: o => Buffer.concat(o.map(v => segmentBinary(serializeCore(v)))),
        decode: o => o.length ? desegmentBinary(o).blocks.map(v => deserializeCore(v)) : []
    },
    {
        name: 'OBJECT',
        isInstance: isObject,
        encode: o => Buffer.concat(Object.entries(o).map(([k, v]) =>
            segmentBinary(
                Buffer.concat([
                    segmentBinary(Buffer.from(k, 'utf8')),
                    segmentBinary(serializeCore(v))
                ])
            )
        )),
        decode: o => o.length ? Object.fromEntries(
            desegmentBinary(o).blocks.map(v =>
                desegmentBinary(v).blocks.map((v, i) => i ? deserializeCore(v) : v.toString('utf8'))
            )
        ) : {}
    },
    {
        name: 'DATE',
        isInstance: o => o instanceof Date,
        encode: o => Buffer.from(o.toString(), 'utf8'),
        decode: o => new Date(o.toString('utf8'))
    },
    {
        name: 'REGEX',
        isInstance: o => o instanceof RegExp,
        encode: o => Buffer.from(o.toString(), 'utf8'),
        decode: o => regexFromString(o.toString('utf8'))
    },
    {
        name: 'ArrayBuffer',
        isInstance: o => o instanceof ArrayBuffer,
        encode: o => Buffer.from(o),
        decode: o => {
            const arrayBuffer = new ArrayBuffer(o.length);
            const uint8Array = new Uint8Array(arrayBuffer);
            uint8Array.set(o);
            return arrayBuffer;
        }
    },
    {
        name: 'Buffer',
        isInstance: o => o instanceof Buffer,
        encode: o => o,
        decode: o => o
    },
    {
        name: 'CircularRef',
        isInstance: o => o instanceof CircularReference,
        encode: o => Buffer.from(JSON.stringify(o.locator), 'utf8'),
        decode: o => new CircularReference(JSON.parse(o.toString('utf8')))
    },
    ...[
        niceReturn(() => ReferenceError),
        niceReturn(() => SyntaxError),
        niceReturn(() => RangeError),
        niceReturn(() => TypeError),
        Error
    ].filter(v => v).map(instance => ({
        name: instance.name,
        isInstance: o => o instanceof instance,
        encode: o => Buffer.from(JSON.stringify({ n: o.name, m: o.message, s: o.stack }), 'utf8'),
        decode: o => {
            const { n: name, m: message, s: stack } = JSON.parse(o.toString('utf8'));
            const res = new instance(message);
            res.name = name;
            res.stack = stack;
            return res;
        }
    })),
    ...[
        niceReturn(() => WeakMap),
        niceReturn(() => WeakSet)
    ].filter(v => v).map(instance => ({
        name: instance.name,
        isInstance: o => o instanceof instance,
        encode: () => {
            throw new Error(`#<${instance.name}> could not be cloned`);
        }
    })),
    {
        name: 'Map',
        isInstance: o => o instanceof Map,
        encode: o => Buffer.concat([...o.entries()].map(([k, v]) =>
            segmentBinary(
                Buffer.concat([
                    segmentBinary(serializeCore(k)),
                    segmentBinary(serializeCore(v))
                ])
            )
        )),
        decode: o => {
            const map = new Map();

            if (o = desegmentBinary(o))
                o.blocks.forEach(v => {
                    map.set(...desegmentBinary(v).blocks.map(v => deserializeCore(v)));
                });
            return map;
        }
    },
    {
        name: 'Set',
        isInstance: o => o instanceof Set,
        encode: o => Buffer.concat([...o.values()].map(v =>
            segmentBinary(
                serializeCore(v)
            )
        )),
        decode: o => {
            const map = new Set();

            if (o = desegmentBinary(o))
                o.blocks.forEach(v => {
                    map.add(deserializeCore(v));
                });
            return map;
        }
    },
    ...[
        Int8Array,
        Uint8Array,
        Uint8ClampedArray,
        Int16Array,
        Uint16Array,
        Int32Array,
        Uint32Array,
        Float32Array,
        Float64Array,
        BigInt64Array,
        BigUint64Array
    ].map(v => ({
        name: v.name,
        isInstance: o => o instanceof v,
        encode: o => Buffer.from(o),
        decode: o => new v(o)
    })),
    {
        name: 'function',
        isInstance: o => typeof o === 'function',
        encode: o => {
            throw new Error(`${o} could not be cloned.`);
        }
    },
    {
        name: 'JSONable',
        isInstance: o => {
            try {
                o.toJSON();
                return true
            } catch (_) {
                return false;
            }
        },
        encode: o => Buffer.from(JSON.stringify(o.toJSON()), 'utf8'),
        decode: o => JSON.parse(o.toString('utf8'))
    },
    {
        name: 'ForeignArray',
        isInstance: o => o instanceof Array && o?.constructor?.name !== 'Array',
        encode: o => Buffer.from(JSON.stringify({ value: Array.from(o), name: o.constructor.name }), 'utf8'),
        decode: (o) => {
            const { name, value } = JSON.parse(o.toString('utf8'));
            const constructor = globalInstance(name);
            let array;
            if (constructor) {
                array = new constructor();
            }
            if (!array) throw new Error(`unable to deserialize array, ${name} is undefined`);
            return array.concat(value);
        }
    },
    {
        name: 'ForeignObject',
        isInstance: o => o instanceof Object && o?.constructor?.name !== 'Object',
        encode: o => Buffer.from(JSON.stringify({ value: Object.assign({}, o), name: o.constructor.name }), 'utf8'),
        decode: (o) => {
            const { name, value } = JSON.parse(o.toString('utf8'));
            const constructor = globalInstance(name);
            let object;
            if (constructor) {
                object = new constructor();
            }
            if (!object) throw new Error(`unable to deserialize object, ${name} is undefined`);
            Object.assign(object, value);
            return object;
        }
    }
].map(v => ({
    ...v,
    isInstance: o => {
        try {
            return v.isInstance(o);
        } catch (_) { }
    }
}));

class CircularReference {
    constructor(locator) {
        this.locator = locator;
    }
}

function globalInstance(name) {
    let constructor = (typeof global !== 'undefined' && global[name])
        || (typeof window !== 'undefined' && window[name])
        || (typeof WorkerGlobalScope !== 'undefined' && WorkerGlobalScope[name]);
    if (typeof constructor !== 'function') { constructor = null; }
    return constructor;
}

/**
 * @param {any} obj 
 * @param {WeakMap} topRefs 
 * @param {any[]} locator 
 * @returns {any}
 */
const bringCircularReference = (obj, topRefs, locator) => {
    if (topRefs.has(obj)) {
        return new CircularReference(topRefs.get(obj));
    }
    const thisMap = new Map(topRefs);
    thisMap.set(obj, locator);

    if (isObject(obj)) {
        return Object.fromEntries(
            Object.entries(obj).map(([k, v]) =>
                [k, bringCircularReference(v, thisMap, [...locator, k])]
            )
        );
    }

    if (Array.isArray(obj)) {
        return obj.map((v, i) => bringCircularReference(v, thisMap, [...locator, i]));
    }

    if (obj instanceof Map) {
        let ite = 0;
        const freshMap = new Map();
        obj.forEach((value, key) => {
            freshMap.set(
                bringCircularReference(key, thisMap, [...locator, { _map_key: true, index: ite }]),
                bringCircularReference(value, thisMap, [...locator, { _map_value: true, index: ite }])
            );
            ++ite;
        });
        return freshMap;
    }

    if (obj instanceof Set) {
        let ite = 0;
        const freshSet = new Set();
        obj.forEach(value => {
            freshSet.add(bringCircularReference(value, thisMap, [...locator, { _map_set: true, index: ite++ }]));
        });
        return freshSet;
    }
    return obj;
}

const leaveCircularReference = (obj, locator, parentObj) => {
    if (obj instanceof CircularReference) {
        // return;
        let ref = parentObj;

        obj.locator.forEach(e => {
            const { _map_set, _map_key, _map_value, index } = isObject(e) ? e : {};

            if (_map_set) {
                let ite = 0;
                ref.forEach((value) => {
                    if (ite++ === index) {
                        ref = value;
                    }
                });
            } else if (_map_key || _map_value) {
                let ite = 0;
                ref.forEach((value, key) => {
                    if (ite++ === index) {
                        ref = _map_key ? key : value;
                    }
                });
            } else ref = ref[e];
        });
        let data = parentObj;

        locator.forEach((e, i) => {
            const { _map_set, _map_key, _map_value, index } = isObject(e) ? e : {};
            const tail = i === locator.length - 1;

            if (_map_set) {
                const entriesData = [...data.values()];
                data.clear();
                const thisData = data;

                entriesData.forEach((value, i) => {
                    if (i === index) {
                        if (tail) {
                            thisData.add(ref);
                        } else {
                            thisData.add(value);
                            data = value;
                        }
                    } else thisData.add(value);
                });

            } else if (_map_key || _map_value) {
                const entriesData = [...data.entries()];
                data.clear();
                const thisData = data;

                entriesData.forEach(([key, value], i) => {
                    if (i === index) {
                        if (tail) {
                            thisData.set(
                                _map_key ? ref : key,
                                _map_value ? ref : value
                            );
                        } else {
                            thisData.set(key, value);
                            data = _map_key ? key : value;
                        }
                    } else thisData.set(key, value);
                });
            } else if (tail) {
                data[e] = ref;
            } else data = data[e];
        });
    } else if (isObject(obj)) {
        Object.entries(obj).forEach(([k, v]) => {
            leaveCircularReference(v, [...locator, k], parentObj);
        });
    } else if (Array.isArray(obj)) {
        obj.slice(0).forEach((v, i) => {
            leaveCircularReference(v, [...locator, i], parentObj);
        });
    } else if (obj instanceof Map) {
        let ite = 0;
        new Map(obj).forEach((value, key) => {
            leaveCircularReference(key, [...locator, { _map_key: true, index: ite }], parentObj);
            leaveCircularReference(value, [...locator, { _map_value: true, index: ite }], parentObj);
            ++ite;
        });
    } else if (obj instanceof Set) {
        let ite = 0;
        new Set(obj).forEach(value => {
            leaveCircularReference(value, [...locator, { _map_set: true, index: ite++ }], parentObj);
        });
    }
}

const serialize = (obj) => {
    const circularClone = bringCircularReference(obj, new Map(), []);
    return serializeCore(circularClone);
}

const deserialize = (buf) => {
    if ([Uint8Array, ArrayBuffer].some(v => buf instanceof v)) buf = Buffer.from(buf);

    const obj = deserializeCore(buf);
    leaveCircularReference(obj, [], obj);
    return obj;
}

const serializeCore = (obj) => {
    const { name, encode } = DataTypesAccessor.find(v => v.isInstance(obj));
    const encodedBuf = encode(obj);

    if (!Buffer.isBuffer(encodedBuf)) throw 'expected a buffer for serializeCore() first argument';

    return Buffer.concat([
        segmentBinary(Buffer.from(name, 'utf8')),
        segmentBinary(encodedBuf)
    ]);
}

const deserializeCore = (buf) => {
    const [name, data] = desegmentBinary(buf).blocks.map((v, i) => i ? v : v.toString('utf8'));
    const { decode } = DataTypesAccessor.find(v => v.name === name);
    return decode(data);
}

module.exports.serialize = serialize;
module.exports.deserialize = deserialize;