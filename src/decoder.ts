import BigNumber from "bignumber.js";

export default class Decoder {
  data!: Uint8Array;
  offset: number = 0;
  constructor(data: Uint8Array) {
    this.data = data;
  }

  readByte(): number {
    const d = this.data[this.offset];
    this.offset++;
    return d;
  }
  readNum(b: number): BigNumber {
    const data = this.data.slice(this.offset, this.offset + b);
    this.offset += b;
    let n = new BigNumber(0);
    for (let i = 0; i < data.length; i++) {
      const d = new BigNumber(2).pow(new BigNumber((data.length - i - 1) * 8));
      n = n.plus(new BigNumber(data[i]).multipliedBy(d));
    }
    return n;
  }
  // 读取64bit的int数据（js没有int64的类型，所以这里只能用字符串接受）
  readInt64(): BigNumber {
    return this.readNum(8);
  }
  readInt16(): number {
    return Number(this.readNum(2));
  }
  readInt32(): number {
    return Number(this.readNum(4));
  }
  readString(): string {
    const len = this.readInt16();
    if(len<=0) {
      return "";
    }
    const strUint8Array = this.data.slice(this.offset, this.offset + len);
    this.offset += len;
    return this.uintToString(Array.from(strUint8Array));
  }
  // 读取剩余的字节
  readRemaining(): Uint8Array {
    const data = this.data.slice(this.offset);
    this.offset = this.data.length;
    return data;
  }
  uintToString(array: any[]) {
    const encodedString = String.fromCharCode.apply(null, array);
    const decodedString = decodeURIComponent(escape(encodedString));
    return decodedString;
  }
  readVariableLength(): number {
    let multiplier = 0;
    let rLength = Number(0);
    while (multiplier < 27) {
      const b = this.readByte();
      /* tslint:disable */
      rLength = rLength | ((b & 127) << multiplier);
      if ((b & 128) == 0) {
        break;
      }
      multiplier += 7;
    }
    return rLength;
  }
}
