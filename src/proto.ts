import Encoder from './encoder';
import Decoder from './decoder';
import BigNumber from 'bignumber.js';
import { SecurityManager } from './security';
import { Md5 } from 'md5-typescript';

let serverVersion = 0 // 服务端返回的协议版本
/* tslint:disable */
export enum PacketType {
  Reserved = 0, // 保留位
  CONNECT = 1, // 客户端请求连接到服务器(c2s)
  CONNACK = 2, // 服务端收到连接请求后确认的报文(s2c)
  SEND = 3, // 发送消息(c2s)
  SENDACK = 4, // 收到消息确认的报文(s2c)
  RECV = 5, // 收取消息(s2c)
  RECVACK = 6, // 收取消息确认(c2s)
  PING = 7, // ping请求
  PONG = 8, // 对ping请求的相应
  DISCONNECT = 9, // 请求断开连接
  SUB = 10, // 订阅
  SUBACK = 11, // 订阅确认
  Event = 12, // 分片数据包
}

export class Setting {
  receiptEnabled: boolean = false // 消息回执是否开启
  topic: boolean = false // 是否存在话题
  private _streamOn: boolean = false


  public get streamOn(): boolean {
    return this._streamOn
  }

  public toUint8(): number {
    return this.boolToInt(this.receiptEnabled) << 7 | this.boolToInt(this.topic) << 3 | this.boolToInt(this.streamOn) << 1
  }

  public static fromUint8(v: number): Setting {
    let setting = new Setting()
    setting.receiptEnabled = (v >> 7 & 0x01) > 0
    setting.topic = (v >> 3 & 0x01) > 0
    setting._streamOn = (v >> 1 & 0x01) > 0
    return setting
  }

  private boolToInt(v: boolean): number {
    return v ? 1 : 0
  }
}

export class Packet {
  /* tslint:disable-line */

  from(f: Packet) {
    this.noPersist = f.noPersist;
    this.reddot = f.reddot;
    this.syncOnce = f.syncOnce;
    this.dup = f.dup;
    this.remainingLength = f.remainingLength;
    this.hasServerVersion = f.hasServerVersion;
    this.end = f.end;
    this._packetType = f._packetType;
  }

  private _packetType: PacketType = PacketType.Reserved; // 包类型
  remainingLength!: number; // 剩余长度
  noPersist!: boolean; // 是否不存储
  reddot!: boolean; // 是否显示红点
  syncOnce!: boolean; // 是否只同步一次
  dup!: boolean; // 是否是重发
  hasServerVersion!: boolean; // connack包是否返回了服务器版本号
  end: boolean = false; // 是否是最后一个分片
  public set packetType(packetType: PacketType) {
    this._packetType = packetType;
  }
  public get packetType() {
    return this._packetType;
  }
}

// 连接包
export class ConnectPacket extends Packet {
  /* tslint:disable-line */
  version!: number; // 版本
  clientKey!: string; // 客户端key
  deviceID!: string; // 设备ID
  deviceFlag!: number; // 设备标示
  clientTimestamp!: number; // 客户端时间戳
  uid!: string; // 用户UID
  token!: string; // 用户token

  public get packetType() {
    return PacketType.CONNECT;
  }
}

// 连接回执包
export class ConnackPacket extends Packet {
  /* tslint:disable-line */
  serverVersion!: number; // 服务端版本
  serverKey!: string;     // 通过客户端的RSA公钥加密的服务端DH公钥
  salt!: string;    // salt
  timeDiff!: BigNumber; // 客户端时间与服务器的差值，单位毫秒。
  reasonCode: number = 0; // 原因码
  nodeId!: BigNumber; // 节点ID
  public get packetType() {
    return PacketType.CONNACK;
  }
}

// 断开包
export class DisconnectPacket extends Packet {
  /* tslint:disable-line */
  reasonCode: number = 0; // 原因码
  reason!: string; // 具体断开原因
  public get packetType() {
    return PacketType.DISCONNECT;
  }
}

// 发送包
export class SendPacket extends Packet {
  /* tslint:disable-line */
  setting!: Setting // 设置
  clientSeq!: number;
  clientMsgNo!: string; // 客户端唯一消息编号（用于消息去重）
  channelID!: string; // 频道ID
  channelType!: number; // 频道类型
  expire?: number // 消息过期时间
  fromUID!: string; // 发送UID
  topic?: string
  payload!: Uint8Array; // 负荷数据
  public get packetType() {
    return PacketType.SEND;
  }
  public veritifyString(payload: Uint8Array) {
    const payloadStr = this.uint8ArrayToString(payload)
    return `${this.clientSeq}${this.clientMsgNo}${this.channelID ?? ""}${this.channelType}${payloadStr}`
  }
  private uint8ArrayToString(data: Uint8Array) {
    const encodedString = String.fromCharCode.apply(null, Array.from(data));
    const decodedString = decodeURIComponent(escape(encodedString));
    return decodedString
  }
}

export enum StreamFlag {
  START = 0,
  ING = 1,
  END = 2,
}
// 收消息包
export class RecvPacket extends Packet {
  /* tslint:disable-line */
  setting!: Setting // 设置
  msgKey!: string // 用于验证此消息是否合法（仿中间人篡改）
  messageID!: string; // 消息ID
  messageSeq!: number; // 消息序列号
  clientMsgNo!: string // 客户端唯一消息编号
  timestamp!: number; // 消息时间戳
  channelID!: string; // 频道ID
  channelType!: number; // 频道类型
  expire?: number // 消息过期时间
  topic?: string // topic
  fromUID!: string; // 发送者UID
  payload!: Uint8Array; // 负荷数据
  public get packetType() {
    return PacketType.RECV;
  }

  public get veritifyString() {
    const payloadStr = this.uint8ArrayToString(this.payload)
    return `${this.messageID}${this.messageSeq}${this.clientMsgNo}${this.timestamp}${this.fromUID ?? ""}${this.channelID ?? ""}${this.channelType}${payloadStr}`
  }
  private uint8ArrayToString(data: Uint8Array) {
    const encodedString = String.fromCharCode.apply(null, Array.from(data));
    const decodedString = decodeURIComponent(escape(encodedString));
    return decodedString
  }
}
// ping
export class PingPacket extends Packet {
  /* tslint:disable-line */
  public get packetType() {
    return PacketType.PING;
  }
}
// pong
export class PongPacket extends Packet {
  /* tslint:disable-line */
  public get packetType() {
    return PacketType.PONG;
  }
}
// 消息发送回执
export class SendackPacket extends Packet {
  /* tslint:disable-line */
  clientSeq!: number;
  messageID!: BigNumber;
  messageSeq!: number;
  reasonCode!: number;
  public get packetType() {
    return PacketType.SENDACK;
  }
}
// 收到消息回执给服务端的包
export class RecvackPacket extends Packet {
  /* tslint:disable-line */
  messageID!: string;
  messageSeq!: number;
  public get packetType() {
    return PacketType.RECVACK;
  }
}

export class SubPacket extends Packet {
  setting!: number // 设置
  clientMsgNo!: string // 客户端唯一消息编号
  channelID!: string; // 频道ID
  channelType!: number; // 频道类型
  action = 0; // 0:订阅 1:取消订阅
  param?: string // 参数
  public get packetType() {
    return PacketType.SUB;
  }
}

export class SubackPacket extends Packet {
  clientMsgNo!: string // 客户端唯一消息编号
  channelID!: string; // 频道ID
  channelType!: number; // 频道类型
  action = 0; // 0:订阅 1:取消订阅
  reasonCode!: number;
  public get packetType() {
    return PacketType.SUBACK;
  }
}

export class EventPacket extends Packet {
  /* tslint:disable-line */
  id: string = "";
  type!: string;
  timestamp: number = 0;
  data: Uint8Array = new Uint8Array(0);
  public get packetType() {
    return PacketType.Event;
  }
}

export interface IProto {
  encode(f: Packet): Uint8Array
  decode(data: Uint8Array): Packet
}

export default class Proto implements IProto {
  /* tslint:disable-line */
  packetEncodeMap: any = {};
  packetDecodeMap: any = {};
  constructor() {
    // 编码
    this.packetEncodeMap[PacketType.CONNECT] = this.encodeConnect;
    this.packetEncodeMap[PacketType.SEND] = this.encodeSend;
    this.packetEncodeMap[PacketType.RECVACK] = this.encodeRecvack;
    this.packetEncodeMap[PacketType.SUB] = this.encodeSub;
    // 解码
    this.packetDecodeMap[PacketType.CONNACK] = this.decodeConnect;
    this.packetDecodeMap[PacketType.RECV] = this.decodeRecvPacket;
    this.packetDecodeMap[PacketType.SENDACK] = this.decodeSendackPacket;
    this.packetDecodeMap[PacketType.DISCONNECT] = this.decodeDisconnect;
    this.packetDecodeMap[PacketType.SUBACK] = this.decodeSuback;
    this.packetDecodeMap[PacketType.Event] = this.decodeEvent;
  }
  encode(f: Packet) {
    const enc = new Encoder();
    let body;
    if (f.packetType !== PacketType.PING && f.packetType !== PacketType.PONG) {
      let packetEncodeFunc = this.packetEncodeMap[f.packetType];
      body = packetEncodeFunc(f);
      let header = this.encodeFramer(f, body.length);

      enc.writeBytes(header);
      enc.writeBytes(body);
    } else {
      let header = this.encodeFramer(f, 0);
      enc.writeBytes(header);
    }
    return enc.toUint8Array();
  }
  decode(data: Uint8Array): Packet {
    const decode = new Decoder(data);
    const f = this.decodeFramer(decode);
    if (f.packetType === PacketType.PING) {
      return new PingPacket();
    }
    if (f.packetType === PacketType.PONG) {
      return new PongPacket();
    }
    const packetDecodeFunc = this.packetDecodeMap[f.packetType];
    if (packetDecodeFunc == null) {
      console.log('不支持的协议包->', f.packetType);
    }
    return packetDecodeFunc(f, decode);
  }

  // 编码连接
  encodeConnect(packet: ConnectPacket) {
    const enc = new Encoder();
    enc.writeUint8(packet.version);
    enc.writeUint8(packet.deviceFlag); // deviceFlag 0x01表示web
    enc.writeString(packet.deviceID);
    enc.writeString(packet.uid);
    enc.writeString(packet.token);
    enc.writeInt64(new BigNumber(packet.clientTimestamp));
    enc.writeString(packet.clientKey);

    return enc.w;
  }

  encodeSend(packet: SendPacket) {
    const enc = new Encoder();
    // setting
    enc.writeByte(packet.setting.toUint8())

    // messageID
    enc.writeInt32(packet.clientSeq);

    // clientMsgNo
    if (!packet.clientMsgNo || packet.clientMsgNo === '') {
      packet.clientMsgNo = getUUID();
    }
    enc.writeString(packet.clientMsgNo);

    // channel
    enc.writeString(packet.channelID);
    enc.writeByte(packet.channelType);
    if(serverVersion>=3) {
      enc.writeInt32(packet.expire || 0)
    }
    // msg key
    const payload = Uint8Array.from(enc.stringToUint(SecurityManager.shared().encryption2(packet.payload)))
    const msgKey = SecurityManager.shared().encryption(packet.veritifyString(payload))
    enc.writeString(Md5.init(msgKey))

    // topic
    const setting = packet.setting
    if (setting.topic) {
      enc.writeString(packet.topic || "")
    }

    // payload
    if (payload) {
      enc.writeBytes(Array.from(payload))
    }
    return enc.w;
  }

  encodeSub(packet: SubPacket) {
    const enc = new Encoder();
    enc.writeByte(packet.setting)
    enc.writeString(packet.clientMsgNo)
    enc.writeString(packet.channelID)
    enc.writeByte(packet.channelType)
    enc.writeByte(packet.action)
    enc.writeString(packet.param || '')
    return enc.w
  }

  decodeSuback(f: Packet, decode: Decoder) {
    const p = new SubackPacket();
    p.from(f);
    p.clientMsgNo = decode.readString()
    p.channelID = decode.readString();
    p.channelType = decode.readByte();
    p.action = decode.readByte();
    p.reasonCode = decode.readByte();
    return p;
  }

  encodeRecvack(packet: RecvackPacket) {
    const enc = new Encoder();
    enc.writeInt64(new BigNumber(packet.messageID));
    enc.writeInt32(packet.messageSeq);
    return enc.w;
  }
  decodeConnect(f: Packet, decode: Decoder) {
    const p = new ConnackPacket();
    p.from(f);

    if (f.hasServerVersion) {
      p.serverVersion = decode.readByte()
      serverVersion = p.serverVersion
      console.log("服务器协议版本:",serverVersion)
    }

    p.timeDiff = decode.readInt64();
    p.reasonCode = decode.readByte();
    p.serverKey = decode.readString()
    p.salt = decode.readString()
    if (p.serverVersion >= 4) {
      p.nodeId = decode.readInt64()
    }

    return p;
  }
  decodeDisconnect(f: Packet, decode: Decoder) {
    const p = new DisconnectPacket();
    p.from(f);
    p.reasonCode = decode.readByte();
    p.reason = decode.readString();
    return p;
  }
  decodeRecvPacket(f: Packet, decode: Decoder) {
    const p = new RecvPacket();
    p.from(f);
    p.setting = Setting.fromUint8(decode.readByte())
    p.msgKey = decode.readString()
    p.fromUID = decode.readString();
    p.channelID = decode.readString();
    p.channelType = decode.readByte();
    if(serverVersion>=3) {
      p.expire = decode.readInt32()
    }
    p.clientMsgNo = decode.readString();
    p.messageID = decode.readInt64().toString();
    p.messageSeq = decode.readInt32();
    p.timestamp = decode.readInt32();
    const setting = p.setting
    if (setting.topic) {
      p.topic = decode.readString()
    }
    p.payload = decode.readRemaining()
    return p;
  }
  decodeSendackPacket(f: Packet, decode: Decoder) {
    const p = new SendackPacket();
    p.from(f);
    p.messageID = decode.readInt64();
    p.clientSeq = decode.readInt32();
    p.messageSeq = decode.readInt32();
    p.reasonCode = decode.readByte();
    return p;
  }

  decodeEvent(f: Packet, decode: Decoder) {
    const p = new EventPacket();
    p.from(f);
    p.id = decode.readString();
    p.type = decode.readString();
    p.timestamp = decode.readInt32();
    p.data = decode.readRemaining();
    return p;
  }

  // 编码头部
  encodeFramer(f: Packet, remainingLength: number) {
    if (f.packetType === PacketType.PING || f.packetType === PacketType.PONG) {
      return [(f.packetType << 4) | 0];
    }
    const headers = new Array();
    const typeAndFlags =
      (this.encodeBool(f.dup) << 3) |
      (this.encodeBool(f.syncOnce) << 2) |
      (this.encodeBool(f.reddot) << 1) |
      this.encodeBool(f.noPersist);
    headers.push((f.packetType << 4) | typeAndFlags);
    const vLen = this.encodeVariableLength(remainingLength);
    headers.push(...vLen);
    return headers;
  }
  decodeFramer(decode: Decoder): Packet {
    const b = decode.readByte();
    const f = new Packet();
    f.noPersist = (b & 0x01) > 0;
    f.reddot = ((b >> 1) & 0x01) > 0;
    f.syncOnce = ((b >> 2) & 0x01) > 0;
    f.dup = ((b >> 3) & 0x01) > 0;
    f.packetType = b >> 4;
    if (f.packetType != PacketType.PING && f.packetType != PacketType.PONG) {
      f.remainingLength = decode.readVariableLength();
    }
    if (f.packetType === PacketType.CONNACK) {
      f.hasServerVersion = (b & 0x01) > 0;
    }
    return f;
  }
  encodeBool(b: boolean) {
    return b ? 1 : 0;
  }
  encodeVariableLength(len: number) {
    const ret = new Array();
    while (len > 0) {
      let digit = len % 0x80;
      len = Math.floor(len / 0x80);
      if (len > 0) {
        digit |= 0x80;
      }
      ret.push(digit);
    }
    return ret;
  }

}

// 获取uuid
function getUUID() {
  return 'xxxxxxxxxxxx4xxxyxxxxxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    var r = Math.random() * 16 | 0,
      v = c == 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}
