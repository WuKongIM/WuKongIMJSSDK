import Proto, { IProto } from "./proto"
import { Provider } from "./provider"
import { SDK_VERSION } from "./version"

export class WKConfig {
    constructor() {
        this.provider = new Provider()
    }
    debug: boolean = false  // 是否开启debug模式
    addr!: string // 连接地址
    uid?: string  // 用户uid
    token?: string // 认证token
    protoVersion = 5 // 协议版本号
    deviceFlag = 1 // 设备标识  0: app 1. web 2. pc
    proto: IProto = new Proto();
    heartbeatInterval: number = 60000; // 心跳频率 单位毫秒
    provider!: Provider
    receiptFlushInterval:number = 2000 // 回执flush间隔 单位为毫秒ms
    sdkVersion = SDK_VERSION // SDK版本号
    platform?:any // 运行平台的全局对象，比如unapp的是 uni ， 微信的是 wx
    sendFrequency = 100 // 发送频率 单位为毫秒ms
    sendCountOfEach = 5  // 每次同时发送消息数量
    clientMsgDeviceId = 0 // 客户端消息设备id, 如果设置了每条消息的clientMsgNo里将带这个标记

}