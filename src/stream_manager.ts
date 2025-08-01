import { Message, Stream } from "./model";
import { ChunkPacket } from "./proto";



export type StreamChangeListener = ((message: Stream) => void);

export class StreamManager {
    streamChangeListeners: StreamChangeListener[] = new Array(); // 流变化监听

    private _streamMap: Map<string, Stream> = new Map(); // 流消息map，key为messageID，value为stream
    private static instance: StreamManager
    public static shared() {
        if (!this.instance) {
            this.instance = new StreamManager();
        }
        return this.instance;
    }

    openStream(message: Message) :Stream | undefined  {
        if (this._streamMap.has(message.messageID)) {
            console.log("stream already exist, messageID:", message.messageID);
            return;
        }
        const stream = Stream.fromMessage(message);
        this._streamMap.set(message.messageID, stream);
        return stream;
    }

    closeStream(messageID: string) {
        this._streamMap.delete(messageID);
    }

    getStream(messageID: string) :Stream | undefined {
        return this._streamMap.get(messageID);
    }

    getAllStream() :Stream[] {
        return Array.from(this._streamMap.values());
    }

    // 添加流监听
    addStreamChangeListener(listener: StreamChangeListener) {
        this.streamChangeListeners.push(listener);
    }

    // 移除流监听
    removeStreamChangeListener(listener: StreamChangeListener) {
        const len = this.streamChangeListeners.length;
        for (let i = 0; i < len; i++) {
            if (listener === this.streamChangeListeners[i]) {
                this.streamChangeListeners.splice(i, 1)
                return
            }
        }
    }

    // 通知流监听者
    notifyStreamChangeListeners(stream: Stream) {
        if (this.streamChangeListeners) {
            this.streamChangeListeners.forEach((listener: StreamChangeListener) => {
                if (listener) {
                    listener(stream);
                }
            });
        }
    }


}