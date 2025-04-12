import { Buffer } from "buffer";

export function serialize(object: any): Buffer;
export function deserialize(data: Buffer): any;