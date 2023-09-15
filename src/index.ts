import { MessageContentType } from "./const";
import { ConnectManager } from "./connect_manager";
import { ChatManager } from "./chat_manager";
import { ChannelManager } from "./channel_manager";
import { TaskManager } from "./task";
import { ConversationManager } from "./conversation_manager";
import { SecurityManager } from "./security";

import { Channel, ChannelInfo, MediaMessageContent, Message, MessageContent, MessageContentManager, CMDContent, MessageSignalContent, MessageText, SystemContent, SubscribeOption, SubscribeListener, UnsubscribeListener, MessageImage } from "./model";
import { ReminderManager } from "./reminder_manager";
import { WKConfig } from "./config";
import { ReceiptManager } from "./receipt_manager";




export default class WKSDK {
    config!: WKConfig
    messageContentManager!: MessageContentManager
    connectManager!: ConnectManager
    chatManager!: ChatManager
    channelManager!: ChannelManager
    taskManager!: TaskManager
    conversationManager!: ConversationManager
    reminderManager!: ReminderManager
    securityManager!: SecurityManager
    receiptManager!: ReceiptManager
    private static instance: WKSDK

    public static shared() {
        if (!this.instance) {
            this.instance = new WKSDK();
            this.instance.init()
        }
        return this.instance;
    }

    private init() {
        this.config = new WKConfig()
        this.taskManager = new TaskManager()
        this.messageContentManager = MessageContentManager.shared()
        this.connectManager = ConnectManager.shared()
        this.chatManager = ChatManager.shared()
        this.channelManager = ChannelManager.shared()
        this.conversationManager = ConversationManager.shared()
        this.securityManager = SecurityManager.shared()
        this.reminderManager = ReminderManager.shared()
        this.receiptManager = ReceiptManager.shared()


        this.registerFactor((contentType: number): MessageContent | undefined => {
            if (this.isSystemMessage(contentType)) {
                return new SystemContent()
            }
            if (contentType === MessageContentType.cmd) {
                return new CMDContent()
            }
            return
        })

        // 注册文本消息
        this.register(MessageContentType.text, () => new MessageText())
        // 注册图片消息
        this.register(MessageContentType.image, () => new MessageImage())
        this.register(MessageContentType.signalMessage, () => new MessageSignalContent())
    }
    // 注册消息正文
    register(contentType: number, handler: (contentType?: number) => MessageContent) {
        this.messageContentManager.register(contentType, handler)
    }
    registerFactor(factor: (contentType: number) => MessageContent | undefined) {
        this.messageContentManager.registerFactor(factor)
    }

    getMessageContent(contentType: number): MessageContent {
        return this.messageContentManager.getMessageContent(contentType)
    }


    // 是否是系统消息
    isSystemMessage(contentType: number) {
        return contentType >= 1000 && contentType <= 2000; // 大于等于1000 小于等于2000的为系统消息
    }

    // 连接IM
    connect() {
        this.connectManager.connect()
    }
    // 断开链接
    disconnect() {
        this.connectManager.disconnect()
    }
    // 订阅频道
    onSubscribe(channel: Channel|string, listener: SubscribeListener,...opts :SubscribeOption[]) {
        this.channelManager.onSubscribe(channel, listener,...opts)
    }
    // 取消订阅
    onUnsubscribe(channel: Channel|string, listener?: UnsubscribeListener) {
        this.channelManager.onUnsubscribe(channel, listener)
    }


    newMessageText(text: string) {
        return new MessageText(text)
    }
    newChannel(channelID: string, channelType: number) {
        return new Channel(channelID, channelType)
    }
    newMessage() {
        return new Message()
    }

    newChannelInfo() {
        return new ChannelInfo()
    }

    newMediaMessageContent() {
        return new MediaMessageContent()
    }

    newMessageContent() {
        return new MessageContent()
    }

}



export {default as WKSDK} from "./index"

export * from "./model";
export * from "./const";
export * from "./conversation_manager";
export * from "./connect_manager";
export * from "./index"
export * from "./proto"
export * from "./chat_manager"
export * from "./task"
export * from "./channel_manager"
export * from "./provider"

// const self = WKSDK.shared();
// window['wksdk'] = self;  /* tslint:disable-line */ // 这样普通的JS就可以通过window.wksdk获取到app对象
// export default self;