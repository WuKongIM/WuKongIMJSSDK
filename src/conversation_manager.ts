import { ChatManager } from "./chat_manager";
import WKSDK from "./index";
import { Channel, Conversation, ConversationExtra, Message } from "./model";


export enum ConversationAction {
    add,
    update,
    remove,
}

export type ConversationListener = ((conversation: Conversation, action: ConversationAction) => void);

export class ConversationManager {
    listeners: ConversationListener[] = new Array(); // 最近会话通知
    conversations: Conversation[] = new Array() // 最近会话列表
    openConversation?: Conversation // 当前打开的最近会话
    maxExtraVersion: number = 0// 最大扩展的版本号
    private static instance: ConversationManager
    public static shared() {
        if (!this.instance) {
            this.instance = new ConversationManager();
        }
        return this.instance;
    }

    private constructor() {
        ChatManager.shared().addMessageListener((message: Message) => {
            this.updateOrAddConversation(message)
        })
    }

    // 同步最近会话
    sync(filter?: any): Promise<Conversation[]> {
        const syncProvide = WKSDK.shared().config.provider.syncConversationsCallback(filter)
        if (syncProvide) {
            syncProvide.then((conversations) => {
                this.conversations = conversations
                if (conversations.length > 0) {
                    for (const conversation of conversations) {
                        if (conversation.remoteExtra.version > this.maxExtraVersion) {
                            this.maxExtraVersion = conversation.remoteExtra.version
                        }
                    }
                }
                WKSDK.shared().reminderManager.sync()
            }).catch((err) => {
                console.log('同步最近会话失败！', err)
            })
        }
        return syncProvide
    }

    async syncExtra(): Promise<ConversationExtra[] | undefined> {
        if (!WKSDK.shared().config.provider.syncConversationExtrasCallback) {
            console.log('syncConversationExtrasCallback没有提供')
            return
        }
        const conversationExtras = await WKSDK.shared().config.provider.syncConversationExtrasCallback!(this.maxExtraVersion)
        if (conversationExtras) {
            for (const conversationExtra of conversationExtras) {
                if (conversationExtra.version > this.maxExtraVersion) {
                    this.maxExtraVersion = conversationExtra.version
                }
                for (const conversation of this.conversations) {
                    if (conversation.channel.isEqual(conversationExtra.channel)) {
                        conversation.remoteExtra = conversationExtra
                        this.notifyConversationListeners(conversation, ConversationAction.update)
                    }
                }
            }
        }
        return conversationExtras
    }

    findConversation(channel: Channel) {
        if (this.conversations) {
            for (const conversation of this.conversations) {
                if (conversation.channel.isEqual(channel)) {
                    return conversation
                }
            }
        }
    }
    findConversations(channels: Channel[]) {
        if (this.conversations && this.conversations.length > 0) {
            const conversations = new Array<Conversation>()
            for (const conversation of this.conversations) {
                for (const channel of channels) {
                    if (conversation.channel.isEqual(channel)) {
                        conversations.push(conversation)
                        break
                    }
                }
            }
            return conversations
        }
    }

    // 创建一个空会话
    createEmptyConversation(channel: Channel): Conversation {
        const conversation = this.findConversation(channel)
        if (conversation) {
            conversation.timestamp = new Date().getTime() / 1000
            this.notifyConversationListeners(conversation, ConversationAction.update)
            return conversation
        } else {
            const newConversation = new Conversation()
            newConversation.channel = channel
            newConversation.timestamp = new Date().getTime() / 1000
            this.notifyConversationListeners(newConversation, ConversationAction.add)
            return newConversation
        }
    }

    updateOrAddConversation(message: Message) {
        const conversation = this.findConversation(message.channel)
        let add = false
        let newConversation: Conversation
        if (!conversation) {
            add = true
            newConversation = new Conversation()
            newConversation.unread = 0
            newConversation.channel = message.channel
            newConversation.timestamp = message.timestamp
            if (!message.send && message.header.reddot && (!this.openConversation || !this.openConversation.channel.isEqual(message.channel))) {
                newConversation.unread++
            }
            newConversation.lastMessage = message
            this.conversations = [newConversation, ...this.conversations]
            this.notifyConversationListeners(newConversation, ConversationAction.add)
        } else {
            if (!message.send && message.header.reddot && (!this.openConversation || !this.openConversation.channel.isEqual(message.channel))) {
                conversation.unread++
            }
            conversation.timestamp = message.timestamp
            conversation.lastMessage = message

            newConversation = conversation
            this.notifyConversationListeners(newConversation, ConversationAction.update)
        }


    }

    removeConversation(channel: Channel) {
        if (!this.conversations || this.conversations.length === 0) {
            return
        }
        let oldConversation: Conversation | undefined
        for (let index = 0; index < this.conversations.length; index++) {
            const conversation = this.conversations[index];
            if (conversation.channel.isEqual(channel)) {
                this.conversations.splice(index, 1)
                oldConversation = conversation
            }
        }
        if (oldConversation) {
            this.notifyConversationListeners(oldConversation, ConversationAction.remove)
        }
    }

    getAllUnreadCount() {
        let unreadCount = 0
        if (this.conversations) {
            for (const conversation of this.conversations) {
                unreadCount += conversation.unread
            }
        }
        return unreadCount
    }

    // 添加最近会话监听
    addConversationListener(listener: ConversationListener) {
        this.listeners.push(listener);
    }
    // 移除最近监听
    removeConversationListener(listener: ConversationListener) {
        const len = this.listeners.length;
        for (let i = 0; i < len; i++) {
            if (listener === this.listeners[i]) {
                this.listeners.splice(i, 1)
                return
            }
        }
    }
    // 通知最近会话监听者
    notifyConversationListeners(conversation: Conversation, action: ConversationAction) {
        if (this.listeners) {
            this.listeners.forEach((listener: ConversationListener) => {
                if (listener) {
                    listener(conversation, action);
                }
            });
        }
    }
}