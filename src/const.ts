
export class MessageContentType {
    static unknown:number = 0 // 未知消息
    static text:number = 1 // 文本消息
    static image:number = 2 // 图片
    static stream:number = 98 // 流式消息
    static cmd:number = 99 // cmd

     // 20000 - 30000 为本地自定义消息

    static signalMessage:number = 21000 // signal
}


export class EventType {
    static TextMessageStart = "___TextMessageStart" // 文本消息开始
    static TextMessageContent = "___TextMessageContent" // 追加文本消息
    static TextMessageEnd = "___TextMessageEnd" // 文本消息结束
}