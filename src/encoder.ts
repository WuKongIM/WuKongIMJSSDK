import BigNumber from "bignumber.js";

export default class Encoder {
  w: number[] = new Array();
  d32: BigNumber = new BigNumber(4294967296);

  writeByte(b: number) {
    this.w.push(b);
  }
  writeBytes(b: number[]) {
    this.w.push(...b);
  }
  /* tslint:disable */
  writeInt64(b: BigNumber) {
    const b1 = b.div(this.d32).toNumber();
    const b2 = b.mod(this.d32).toNumber();
    this.w.push((b1 >> 24) & 0xff);
    this.w.push((b1 >> 16) & 0xff);
    this.w.push((b1 >> 8) & 0xff);
    this.w.push(b1 & 0xff);

    this.w.push((b2 >> 24) & 0xff);
    this.w.push((b2 >> 16) & 0xff);
    this.w.push((b2 >> 8) & 0xff);
    this.w.push(b2 & 0xff);
  }

  writeInt32(b: number) {
    this.w.push(b >> 24);
    this.w.push(b >> 16);
    this.w.push(b >> 8);
    this.w.push(b & 0xff);
  }

  writeUint8(b: number) {
    this.w.push(b);
  }

  writeInt16(b: number) {
    this.w.push(b >> 8);
    this.w.push(b & 0xff);
  }
  writeString(s: string) {
    if (s && s.length>0) {
      let strArray = this.stringToUint(s);
      this.writeInt16(strArray.length);
      this.w.push(...strArray);
    } else {
      this.writeInt16(0x00);
    }
  }

  stringToUint(str: string) {
    let string = unescape(encodeURIComponent(str));
    let charList = string.split('');
    let uintArray = new Array();
    for (let i = 0; i < charList.length; i++) {
      uintArray.push(charList[i].charCodeAt(0));
    }
    return uintArray;
  }

  toUint8Array() {
    return new Uint8Array(this.w);
  }
}
