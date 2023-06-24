import WKSDK from "./index"
import { ConnackPacket, ConnectPacket, DisconnectPacket, IProto, Packet, PacketType, PingPacket, RecvackPacket, RecvPacket, SendPacket, SubackPacket } from "./proto";
import { generateKeyPair, sharedKey } from 'curve25519-js';
import { Md5 } from "md5-typescript";
import { SecurityManager } from "./security";
import { Guid } from "./guid";

import * as buffer from "buffer"
import { WKWebsocket } from "./websocket";

// import * as SignalClient from '@signalapp/signal-client';
export enum ConnectStatus {
    Disconnect, // 断开连接
    Connected, // 连接成功
    Connecting, // 连接中
    ConnectFail, // 连接错误
    ConnectKick, // 连接被踢，服务器要求客户端断开（一般是账号在其他地方登录，被踢）
}

export type ConnectStatusListener = (status: ConnectStatus, reasonCode?: number) => void;

export class ConnectManager {
    ws?: WKWebsocket;
    status: ConnectStatus = ConnectStatus.Disconnect;  // 连接状态
    connectStatusListeners: ConnectStatusListener[] = new Array(); // 连接状态监听

    // reConnect 重连标记
    lockReconnect = false;
    pongRespTimeoutInterval = 3000; // pong返回超时间隔 单位毫秒
    pongRespTimer: any;
    needReconnect = true; // 是否需要重连
    pingRetryCount = 0; // ping重试次数
    pingMaxRetryCount = 3; // 最大重试三次ping
    reConnectTimeout!: any;
    heartTimer!: any;
    dhPrivateKey!: Uint8Array // dh 私钥

    tempBufferData: number[] = new Array() // 接受数据临时缓存

    private constructor() {

    }

    private static instance: ConnectManager
    public static shared() {
        if (!this.instance) {
            this.instance = new ConnectManager();
        }
        return this.instance;
    }

    stopHeart() {
        if (this.heartTimer) {
            clearInterval(this.heartTimer);
            this.heartTimer = null;
        }
    }
    stopReconnectTimer() {
        if (this.reConnectTimeout) {
            clearTimeout(this.reConnectTimeout);
            this.reConnectTimeout = null;
        }
    }
    // 重置心跳
    restHeart() {
        const self = this;
        if (this.heartTimer) {
            clearInterval(this.heartTimer);
        }
        if (this.pongRespTimer) {
            clearTimeout(this.pongRespTimer);
        }
        this.heartTimer = setInterval(() => {
            self.sendPing(); // 发送心跳包
            if (self.pingRetryCount > self.pingMaxRetryCount) {
                console.log('ping没有响应，断开连接。');
                self.onlyDisconnect();
                if (this.status === ConnectStatus.Disconnect) {
                    self.connect()
                }
            } else if (self.pingRetryCount > 1) {
                console.log(`第${self.pingRetryCount}次，尝试ping。`);
            }

        }, WKSDK.shared().config.heartbeatInterval);
    }

    connect() {
        this.needReconnect = true
        this.onlyConnect()
    }

    onlyConnect() {

        if (this.status === ConnectStatus.Connecting) {
            console.log('已在连接中，不再进行连接.');
            return;
        }
        if (WKSDK.shared().config.provider.connectAddrCallback != null) {
            const connectAddrCallback = WKSDK.shared().config.provider.connectAddrCallback
            connectAddrCallback((addr: string) => {
                this.connectWithAddr(addr)
            })
        } else {
            this.connectWithAddr(WKSDK.shared().config.addr)
        }

    }

    connectWithAddr(addr: string) {
        console.log("connectWithAddr--->")
        this.status = ConnectStatus.Connecting;
        this.ws = new WKWebsocket(addr);
        const self = this;
        this.ws.onopen(() => {
            console.log('onopen...');
            self.tempBufferData = new Array<number>() // 重置缓存

            const seed = Uint8Array.from(self.stringToUint(Guid.create().toString().replace(/-/g, "")))
            const keyPair = generateKeyPair(seed)
            const pubKey = buffer.Buffer.from(keyPair.public).toString("base64")
            self.dhPrivateKey = keyPair.private

            const connectPacket = new ConnectPacket();
            connectPacket.clientKey = pubKey;
            connectPacket.version = 0x1;
            connectPacket.deviceFlag = 0x1; // 0: app 1. web
            const deviceID = Guid.create().toString().replace(/-/g, "")
            connectPacket.deviceID = deviceID + "W";
            connectPacket.clientTimestamp = new Date().getTime();
            connectPacket.uid = WKSDK.shared().config.uid || '';
            connectPacket.token = WKSDK.shared().config.token || '';
            const data = self.getProto().encode(connectPacket);
            self.ws?.send(data);
        })

        this.ws.onmessage((data: any) => {
            self.unpacket(new Uint8Array(data), (packets) => {
                if (packets.length > 0) {
                    for (const packetData of packets) {
                        self.onPacket(new Uint8Array(packetData));
                    }
                }
            })
        });
        this.ws.onclose((e)=>{
            console.log('连接关闭！', e);
            if (this.status !== ConnectStatus.Disconnect) {
                this.status = ConnectStatus.Disconnect;
                this.notifyConnectStatusListeners(0);
            }

            if (self.needReconnect) {
                this.reConnect();
            }
        })
        this.ws.onerror((e)=>{
            console.log('连接出错！', e);
            if (this.status !== ConnectStatus.Disconnect) {
                this.status = ConnectStatus.Disconnect;
                this.notifyConnectStatusListeners(0);
            }
            if (self.needReconnect) {
                this.reConnect();
            }
        });
    }

    /* tslint:disable */
    stringToUint(str: string) {
        const string = unescape(encodeURIComponent(str));
        const charList = string.split('');
        const uintArray = new Array();
        for (let i = 0; i < charList.length; i++) {
            uintArray.push(charList[i].charCodeAt(0));
        }
        return uintArray;
    }

    connected() {
        return this.status == ConnectStatus.Connected
    }

    disconnect() {
        this.needReconnect = false
        console.log("断开不再重连")
        this.onlyDisconnect()
    }
    onlyDisconnect() {
        this.stopHeart();
        this.stopReconnectTimer();
        if (this.ws) {
            this.ws.close();
        }
        this.status = ConnectStatus.Disconnect;

    }

    // 重连
    reConnect() {
        if (this.lockReconnect) {
            return;
        }
        console.log('开始重连');
        this.lockReconnect = true;
        if (this.reConnectTimeout) {
            clearTimeout(this.reConnectTimeout);
        }
        const self = this;
        this.reConnectTimeout = setTimeout(() => {
            if (this.ws) {
                this.ws.close();
                this.ws = undefined;
            }
            self.onlyConnect();
            this.lockReconnect = false;
        }, 3000);
    }

    wssend(message: SendPacket) {
        this.ws?.send(this.getProto().encode(message));
    }

    unpacket(data: Uint8Array, callback: (data: Array<Array<number>>) => void) {
        try {
            this.tempBufferData.push(...Array.from(data))

            let lenBefore, lenAfter
            const dataList = new Array<Array<number>>()
            do {
                lenBefore = this.tempBufferData.length
                this.tempBufferData = this.unpackOne(this.tempBufferData, (packetData) => {
                    dataList.push(packetData)
                })
                lenAfter = this.tempBufferData.length;
                if (lenAfter > 0) {
                    console.log("有粘包！-->", this.tempBufferData)
                }

                if (dataList.length > 0) {
                    callback(dataList);
                }
            } while (lenBefore != lenAfter && lenAfter >= 1)
        } catch (error) {
            console.log("解码数据异常---->", error)
            this.reConnect()
        }
    }

    unpackOne(data: Array<number>, dataCallback: (data: Array<number>) => void) {
        const header = data[0]
        const packetType = header >> 4
        if (packetType == PacketType.PONG) {
            dataCallback([header])
            return data.slice(1)
        }

        const length = data.length;
        const fixedHeaderLength = 1
        let pos = fixedHeaderLength
        let digit = 0
        let remLength = 0
        let multiplier = 1
        let hasLength = false //  是否还有长度数据没读完
        let remLengthFull = true // 剩余长度的字节是否完整

        do {
            if (pos > length - 1) {
                // 这种情况出现了分包，并且分包的位置是长度部分的某个位置。这种情况不处理
                remLengthFull = false;
                break
            }
            digit = data[pos++]
            remLength += ((digit & 127) * multiplier);
            multiplier *= 128;
            hasLength = (digit & 0x80) != 0;
        } while (hasLength)

        if (!remLengthFull) {
            return data;
        }

        let remLengthLength = pos - fixedHeaderLength; // 剩余长度的长度
        if (fixedHeaderLength + remLengthLength + remLength > length) {
            // 固定头的长度 + 剩余长度的长度 + 剩余长度 如果大于 总长度说明分包了
            console.log("还有包未到，存入缓存！！！")
            return data;
        } else {
            if (fixedHeaderLength + remLengthLength + remLength == length) {
                // 刚好一个包
                dataCallback(data)
                return [];
            } else {
                // 粘包  大于1个包
                const packetLength = fixedHeaderLength + remLengthLength + remLength;
                dataCallback(data.slice(0, packetLength))
                return data.slice(packetLength, length - packetLength)
            }
        }
    }

    onPacket(data: Uint8Array) {
        const p = this.getProto().decode(data);
        if (p.packetType === PacketType.CONNACK) {
            const connackPacket = p as ConnackPacket;
            if (connackPacket.reasonCode === 1) {
                console.log('连接成功！');

                WKSDK.shared().channelManager.reSubscribe() // 重置订阅状态
                this.status = ConnectStatus.Connected;
                this.pingRetryCount = 0;
                // 连接成功
                this.restHeart(); // 开启心跳

                const serverPubKey = Uint8Array.from(buffer.Buffer.from(connackPacket.serverKey, "base64"))

                const secret = sharedKey(this.dhPrivateKey, serverPubKey)

                const secretBase64 = buffer.Buffer.from(secret).toString("base64")

                const aesKeyFull = Md5.init(secretBase64)
                SecurityManager.shared().aesKey = aesKeyFull.substring(0, 16)
                if (connackPacket.salt && connackPacket.salt.length > 16) {
                    SecurityManager.shared().aesIV = connackPacket.salt.substring(0, 16)
                } else {
                    SecurityManager.shared().aesIV = connackPacket.salt;
                }
                WKSDK.shared().chatManager.flushSendingQueue() // 将发送队列里的消息flush出去
            } else {
                console.log('连接失败！错误->', connackPacket.reasonCode);
                this.status = ConnectStatus.ConnectFail;
                this.needReconnect = false; // IM端返回连接失败就不再进行重连。
            }
            this.notifyConnectStatusListeners(connackPacket.reasonCode);
        } else if (p.packetType === PacketType.PONG) {
            this.pingRetryCount = 0;
        } else if (p.packetType === PacketType.DISCONNECT) { // 服务器要求客户端断开（一般是账号在其他地方登录，被踢）

            const disconnectPacket = (p as DisconnectPacket)
            console.log('连接被踢->', disconnectPacket);
            this.status = ConnectStatus.ConnectKick;
            this.needReconnect = false; // IM端返回连接失败就不再进行重连。
            this.notifyConnectStatusListeners(disconnectPacket.reasonCode);

        } else if (p.packetType === PacketType.SUBACK) { // 订阅回执
            const subackPacket = (p as SubackPacket)
            console.log("订阅回执-->",subackPacket.action)
            WKSDK.shared().channelManager.handleSuback(subackPacket)
        }

        WKSDK.shared().chatManager.onPacket(p)

    }

    sendPing() {
        this.pingRetryCount++;
        this.sendPacket(new PingPacket())
    }

    sendPacket(p: Packet) {
        // if (this.connected()) {
        //     this.ws?.send(this.getProto().encode(p))
        // } else {
        //     console.log("发送消息失败，连接已断开！")
        //     this.reConnect()
        // }
        this.ws?.send(this.getProto().encode(p))

    }

    getProto(): IProto {
        return WKSDK.shared().config.proto
    }

    // 添加连接状态监听
    addConnectStatusListener(listener: ConnectStatusListener) {
        this.connectStatusListeners.push(listener);
    }
    removeConnectStatusListener(listener: ConnectStatusListener) {
        const len = this.connectStatusListeners.length;
        for (let i = 0; i < len; i++) {
            if (listener === this.connectStatusListeners[i]) {
                this.connectStatusListeners.splice(i, 1)
                return
            }
        }
    }


    notifyConnectStatusListeners(reasonCode: number) {
        if (this.connectStatusListeners) {
            this.connectStatusListeners.forEach((listener: ConnectStatusListener) => {
                if (listener) {
                    listener(this.status, reasonCode);
                }
            });
        }
    }
    sendRecvackPacket(recvPacket: RecvPacket) {
        const packet = new RecvackPacket();
        packet.messageID = recvPacket.messageID;
        packet.messageSeq = recvPacket.messageSeq;
        this.ws?.send(this.getProto().encode(packet));
    }
    close() {
        this.ws?.close();
    }
}

