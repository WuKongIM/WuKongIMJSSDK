import Proto, { IProto } from "./proto"
import { Provider } from "./provider"

export class WKConfig {
    constructor() {
        this.provider = new Provider()
    }
    debug: boolean = false  // 是否开启debug模式
    addr!: string // 连接地址
    uid?: string  // 用户uid
    token?: string // 认证token
    proto: IProto = new Proto();
    heartbeatInterval: number = 60000; // 心跳频率 单位毫秒
    provider!: Provider
    receiptFlushInterval:number = 2000 // 回执flush间隔 单位为毫秒ms
    sdkVersion = "1.0.0" // SDK版本号

}