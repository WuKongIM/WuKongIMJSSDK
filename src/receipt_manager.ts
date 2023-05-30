import WKSDK from ".";
import { Channel, Message } from "./model";

export type MessageReceiptListener = ((channel:Channel,message: Message[]) => void);

export class ReceiptManager {
    private static instance: ReceiptManager
    listeners: MessageReceiptListener[] = new Array(); // 回执监听
    private timer!:NodeJS.Timeout
    public static shared() {
        if (!this.instance) {
            this.instance = new ReceiptManager();
            this.instance.setup()
        }
        return this.instance;
    }

    private  channelMessagesMap = new Map<string,Message[]>();

   private setup() {
        this.timer = setInterval(this.flushLoop.bind(this),WKSDK.shared().config.receiptFlushInterval)
    }

    // 添加需要回执的消息
    public  addReceiptMessages(channel:Channel,messages:Message[]) {
        if(!messages || messages.length === 0) {
            return
        }
        let existMessages = this.channelMessagesMap.get(channel.getChannelKey())
        if(!existMessages) {
            existMessages = []
        }
        for (const message of messages) {
            if(!message.remoteExtra.readed) {
                existMessages.push(message)
            }
        }
        this.channelMessagesMap.set(channel.getChannelKey(),existMessages)
    }

    private flush(channelKey:string) {
        if(!WKSDK.shared().config.provider.messageReadedCallback) {
            throw new Error("没有设置WKSDK.shared().config.provider.messageReadedCallback")
        }
        const messages = this.channelMessagesMap.get(channelKey)

        const tmpMessages = new Array<Message>()
        let flushCachedLen = 0
        if(messages && messages.length>0) {
            flushCachedLen = messages.length
            for (const message of messages) {
                tmpMessages.push(message)
            }
        }
        if(tmpMessages.length === 0) {
            return
        }
        const channel = Channel.fromChannelKey(channelKey)!
        WKSDK.shared().config.provider.messageReadedCallback!(channel,tmpMessages).then(()=>{
            this.removeCacheWithLength(channelKey,flushCachedLen)
            this.notifyListeners(channel,tmpMessages)
        })
    }

    private removeCacheWithLength(channelKey:string,len:number) {
        const cacheMessages = this.channelMessagesMap.get(channelKey)
        const tmpArray = new Array<Message>()
        if(!cacheMessages) {
            return
        }
        for (const message of cacheMessages) {
            tmpArray.push(message)
        }
        let actLen = len
        if(tmpArray.length<len) {
            actLen = tmpArray.length
        }
        for (let index = 0; index < actLen; index++) {
            const message = tmpArray[index];
            for (let k = 0; k < cacheMessages.length; k++) {
                const element = cacheMessages[k];
                if(message.clientMsgNo === element.clientMsgNo) {
                    cacheMessages.splice(k,1)
                    break
                }
                
            }
            
        }
    }

    private flushLoop() {
        this.channelMessagesMap.forEach((value,channelKey)=>{
            this.flush(channelKey)
        })
        
    }

     // 添加命令类消息监听
     addListener(listener: MessageReceiptListener) {
        this.listeners.push(listener);
    }
    removeListener(listener: MessageReceiptListener) {
        const len = this.listeners.length;
        for (let i = 0; i < len; i++) {
            if (listener === this.listeners[i]) {
                this.listeners.splice(i, 1)
                return
            }
        }
    }
     // 通知监听者
     notifyListeners(channel:Channel,messages: Message[]) {
        if (this.listeners) {
            this.listeners.forEach((listener: MessageReceiptListener) => {
                if (listener) {
                    listener(channel,messages);
                }
            });
        }
    }

}