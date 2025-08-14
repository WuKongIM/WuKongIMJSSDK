import { EventPacket } from "./proto";
import { uint8ArrayToString } from "./security";



export type WKEventListener = ((event: WKEvent) => void);

export class WKEventManager {
    eventListeners: WKEventListener[] = new Array(); //事件监听
    private static instance: WKEventManager
    public static shared() {
        if (!this.instance) {
            this.instance = new WKEventManager();
        }
        return this.instance;
    }

    // 添加事件监听
    addEventListener(listener: WKEventListener) {
        this.eventListeners.push(listener);
    }

    // 移除事件监听
    removeEventListener(listener: WKEventListener) {
        const len = this.eventListeners.length;
        for (let i = 0; i < len; i++) {
            if (listener === this.eventListeners[i]) {
                this.eventListeners.splice(i, 1)
                return
            }
        }
    }

    // 通知event监听者
    notifyEventListeners(event: WKEvent) {
        if (this.eventListeners) {
            this.eventListeners.forEach((listener: WKEventListener) => {
                if (listener) {
                    listener(event);
                }
            });
        }
    }
}

export class WKEvent extends EventPacket {
    public dataText?: string // 文本数据

    constructor(packet: EventPacket) {
        super()
        this.id = packet.id
        this.type = packet.type
        this.timestamp = packet.timestamp
        this.data = packet.data

        const text = String.fromCharCode.apply(null, Array.from(packet.data))
        this.dataText = decodeURIComponent(escape(text))
    }
}