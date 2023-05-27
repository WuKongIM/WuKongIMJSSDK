import { Channel, ChannelInfo, Conversation, ConversationExtra, Message, MessageExtra, Reminder, SignalKey, Subscriber, SyncOptions } from "./model"
import { MessageTask } from './task'

export type ConnectAddrCallback = (addr: string) => void

export type ChannelInfoCallback = (channel: Channel) => Promise<ChannelInfo>
export type SyncSubscribersCallback = (channel: Channel, version: number) => Promise<Subscriber[]>
export type SyncConversationsCallback = (filter?:any) => Promise<Conversation[]>
export type SyncConversationExtrasCallback = (versation:number) => Promise<ConversationExtra[]|undefined>

export type SignalSessionKeyCallback = (channel: Channel) => Promise<SignalKey|null>

export type SyncRemindersCallback = (version: number) => Promise<Reminder[]>

export type ReminderDoneCallback = (ids: number[]) => Promise<void>


export type MessageUploadTaskCallback = (message: Message) => MessageTask

export type SyncMessageCallback = (channel:Channel,opts:SyncOptions) => Promise<Message[]> // 同步消息回调

export type SyncMessageExtraCallback =  (channel:Channel,extraVersion:number,limit:number) => Promise<MessageExtra[]> // 消息扩展同步

export type MessageReadedCallback = (channel:Channel,messages:Message[]) => Promise<void> // 消息已读回调

export class Provider {

    // 获取IM连接地址
    connectAddrCallback!: (callback: ConnectAddrCallback) => void  
     // 获取频道信息
    channelInfoCallback!: ChannelInfoCallback 
    // 获取频道订阅者
    syncSubscribersCallback!: SyncSubscribersCallback
    // 同步频道消息回调
    syncMessagesCallback?: SyncMessageCallback
    // 同步最近会话
    syncConversationsCallback!: SyncConversationsCallback
    // 同步最近会话扩展回掉
    syncConversationExtrasCallback?: SyncConversationExtrasCallback
    // 同步消息扩展
    syncMessageExtraCallback?:SyncMessageExtraCallback
    // 消息上传任务回调
    messageUploadTaskCallback?: MessageUploadTaskCallback
    // signal加解密session数据提供者
    signalSessionKeyCallback?:SignalSessionKeyCallback
    // 同步提醒项
    syncRemindersCallback?: SyncRemindersCallback
    // 同步完成回调
    reminderDoneCallback?: ReminderDoneCallback
    // 消息已读回掉
    messageReadedCallback?: MessageReadedCallback

    

    // // 获取IM连接地址
    // public set connectAddrCallback(callback: (callback: ConnectAddrCallback) => void) {
    //     this._connectAddrCallback = callback
    // }
    // public get connectAddrCallback(): (callback: ConnectAddrCallback) => void {
    //     return this._connectAddrCallback
    // }

    // 获取频道信息
    // public set channelInfoCallback(callback: ChannelInfoCallback) {
    //     this._channelInfoCallback = callback

    // }
    // public get channelInfoCallback(): ChannelInfoCallback {
    //     return this._channelInfoCallback
    // }

    // 获取频道订阅者
    // public set syncSubscribersCallback(callback: SyncSubscribersCallback) {
    //     this._syncSubscribersCallback = callback
    // }

    // public get syncSubscribersCallback(): SyncSubscribersCallback {
    //     return this._syncSubscribersCallback
    // }

    // 消息上传任务回调
    // public set messageUploadTaskCallback(callback: MessageUploadTaskCallback) {
    //     this._messageUploadTaskCallback = callback
    // }
    // 获取消息上传任务
    public  messageUploadTask(message:Message): MessageTask | undefined {
        if(this.messageUploadTaskCallback) {
            return this.messageUploadTaskCallback(message)
        }
    }

    // 同步最近会话
    // public set syncConversationsCallback(callback:SyncConversationsCallback) {
    //     this._syncConversationsCallback =  callback
    // }

    // public get syncConversationsCallback() {
    //     return this._syncConversationsCallback
    // }

    
}