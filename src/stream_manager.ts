import { Stream } from "./model";


export type StreamListener = ((stream: Stream) => void);
export class StreamManager {
    listeners: StreamListener[] = new Array(); // 收取消息监听


    private static instance: StreamManager
    public static shared() {
        if (!this.instance) {
            this.instance = new StreamManager();
        }
        return this.instance;
    }

    // 添加流监听
    addStreamListener(listener: StreamListener) {
        this.listeners.push(listener);
    }

    // 移除流监听
    removeStreamListener(listener: StreamListener) {
        const len = this.listeners.length;
        for (let i = 0; i < len; i++) {
            if (listener === this.listeners[i]) {
                this.listeners.splice(i, 1)
                return
            }
        }
    }

    // 通知流监听者
    notifyStreamListeners(stream: Stream) {
        if (this.listeners) {
            this.listeners.forEach((listener: StreamListener) => {
                if (listener) {
                    listener(stream);
                }
            });
        }
    }


}