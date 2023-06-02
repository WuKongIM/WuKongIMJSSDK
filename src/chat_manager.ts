import { MessageContentType } from "./const";
import { Guid } from "./guid";
import WKSDK from "./index";
import { Channel, ChannelTypePerson, MediaMessageContent, Message, MessageContent, SyncOptions, MessageSignalContent } from "./model";
import { Packet, RecvackPacket, RecvPacket, SendackPacket, SendPacket, Setting } from "./proto";
import { Task, MessageTask, TaskStatus } from "./task";
import { Md5 } from "md5-typescript";
import { SecurityManager } from "./security";

export type MessageListener = ((message: Message) => void);
export type MessageStatusListener = ((p: SendackPacket) => void);

export class ChatManager {
    cmdListeners: ((message: Message) => void)[] = new Array(); // 命令类消息监听
    listeners: MessageListener[] = new Array(); // 收取消息监听
    sendingQueues: Map<number, SendPacket> = new Map(); // 发送中的消息
    sendStatusListeners: MessageStatusListener[] = new Array(); // 消息状态监听
    clientSeq: number = 0

    private static instance: ChatManager
    public static shared() {
        if (!this.instance) {
            this.instance = new ChatManager();
        }
        return this.instance;
    }


    private constructor() {
        if (WKSDK.shared().taskManager) {
            WKSDK.shared().taskManager.addListener((task: Task) => {
                if (task.status === TaskStatus.success) {
                    if (task instanceof MessageTask) {
                        const messageTask = task as MessageTask
                        const sendPacket = this.sendingQueues.get(messageTask.message.clientSeq)
                        if (sendPacket) {
                            sendPacket.payload = messageTask.message.content.encode() // content需要重新编码
                            WKSDK.shared().connectManager.sendPacket(sendPacket)
                        }
                    }
                }
            })
        }

    }

    async onPacket(packet: Packet) {
        if (packet instanceof RecvPacket) {
            const recvPacket = packet as RecvPacket


            const actMsgKey = SecurityManager.shared().encryption(recvPacket.veritifyString)
            const actMsgKeyMD5 = Md5.init(actMsgKey)
            if (actMsgKeyMD5 !== recvPacket.msgKey) {
                console.log(`非法的消息，期望msgKey:${recvPacket.msgKey} 实际msgKey:${actMsgKeyMD5} 忽略此消息！！`);
                return
            }
            recvPacket.payload = SecurityManager.shared().decryption(recvPacket.payload)

            // const setting = Setting.fromUint8(recvPacket.setting)
           
            const message = new Message(recvPacket)
            this.sendRecvackPacket(recvPacket);
            if (message.contentType === MessageContentType.cmd) { // 命令类消息分流处理
                this.notifyCMDListeners(message);
                return;
            }
            this.notifyMessageListeners(message);
        } else if (packet instanceof SendackPacket) {
            const sendack = packet as SendackPacket;
            this.sendingQueues.delete(sendack.clientSeq);
            // 发送消息回执
            this.notifyMessageStatusListeners(sendack);
        }

    }

    async syncMessages(channel: Channel, opts: SyncOptions): Promise<Message[]> {
        if (!WKSDK.shared().config.provider.syncMessagesCallback) {
            throw new Error("没有设置WKSDK.shared().config.provider.syncMessagesCallback")
        }
        return WKSDK.shared().config.provider.syncMessagesCallback!(channel, opts)
    }

    async syncMessageExtras(channel: Channel,extraVersion:number) {
        if (!WKSDK.shared().config.provider.syncMessageExtraCallback) {
            throw new Error("没有设置WKSDK.shared().config.provider.syncMessageExtraCallback")
        }
       return WKSDK.shared().config.provider.syncMessageExtraCallback!(channel,extraVersion,100)
    }

    sendRecvackPacket(recvPacket: RecvPacket) {
        const packet = new RecvackPacket();
        packet.noPersist = recvPacket.noPersist
        packet.syncOnce = recvPacket.syncOnce
        packet.reddot = recvPacket.reddot
        packet.messageID = recvPacket.messageID;
        packet.messageSeq = recvPacket.messageSeq;
        WKSDK.shared().connectManager.sendPacket(packet)
    }

    /**
     *  发送消息
     * @param content  消息内容
     * @param channel 频道对象
     * @param setting  发送设置
     * @returns 完整消息对象
     */
    async send(content: MessageContent, channel: Channel, setting?: Setting): Promise<Message> {

        const packet = this.getSendPacket(content, channel, setting)

        let opts = new Setting()
        if (setting) {
            opts = setting
        }

        this.sendingQueues.set(packet.clientSeq, packet);

        const message = Message.fromSendPacket(packet, content)
        if (content instanceof MediaMessageContent) {
            const task = WKSDK.shared().config.provider.messageUploadTask(message)
            if (task) {
                WKSDK.shared().taskManager.addTask(task)
            }
        } else {
            WKSDK.shared().connectManager.sendPacket(packet)
        }
        this.notifyMessageListeners(message)

        return message
    }
    getSendPacket(content: MessageContent, channel: Channel, setting: Setting = new Setting()): SendPacket {
        const packet = new SendPacket();
        packet.setting = setting.toUint8()
        packet.reddot = true;
        packet.clientMsgNo = `${Guid.create().toString().replace(/-/gi, "")}3`
        packet.clientSeq = this.getClientSeq()
        packet.fromUID = WKSDK.shared().config.uid || '';
        packet.channelID = channel.channelID;
        packet.channelType = channel.channelType
        packet.payload = content.encode()
        return packet
    }
    getClientSeq() {
        return ++this.clientSeq;
    }

    // 通知命令消息监听者
    notifyCMDListeners(message: Message) {
        if (this.cmdListeners) {
            this.cmdListeners.forEach((listener: (message:Message) => void) => {
                if (listener) {
                    listener(message);
                }
            });
        }
    }

    // 添加命令类消息监听
    addCMDListener(listener: MessageListener) {
        this.cmdListeners.push(listener);
    }
    removeCMDListener(listener: MessageListener) {
        const len = this.cmdListeners.length;
        for (let i = 0; i < len; i++) {
            if (listener === this.cmdListeners[i]) {
                this.cmdListeners.splice(i, 1)
                return
            }
        }
    }
    // 添加消息监听
    addMessageListener(listener: MessageListener) {
        this.listeners.push(listener);
    }
    // 移除消息监听
    removeMessageListener(listener: MessageListener) {
        const len = this.listeners.length;
        for (let i = 0; i < len; i++) {
            if (listener === this.listeners[i]) {
                this.listeners.splice(i, 1)
                return
            }
        }
    }
    // 通知消息监听者
    notifyMessageListeners(message: Message) {
        if (this.listeners) {
            this.listeners.forEach((listener: MessageListener) => {
                if (listener) {
                    listener(message);
                }
            });
        }
    }


    // 通知消息状态改变监听者
    notifyMessageStatusListeners(sendackPacket: SendackPacket) {
        if (this.sendStatusListeners) {
            this.sendStatusListeners.forEach((listener: (ack:SendackPacket) => void) => {
                if (listener) {
                    listener(sendackPacket);
                }
            });
        }
    }
    // 消息状态改变监听
    addMessageStatusListener(listener: MessageStatusListener) {
        this.sendStatusListeners.push(listener);
    }
    removeMessageStatusListener(listener: MessageStatusListener) {
        const len = this.sendStatusListeners.length;
        for (let i = 0; i < len; i++) {
            if (listener === this.sendStatusListeners[i]) {
                this.sendStatusListeners.splice(i, 1)
                return
            }
        }
    }

    // 将发送消息队列里的消息flush出去
    flushSendingQueue() {
        if (this.sendingQueues.size <= 0) {
            return;
        }
        console.log(`flush 发送队列内的消息。数量${this.sendingQueues.size}`);
        let clientSeqArray = new Array<number>();
        this.sendingQueues.forEach((value, key) => {
            clientSeqArray.push(key);
        })
        clientSeqArray = clientSeqArray.sort();

        for (const clientSeq of clientSeqArray) {
            const sendPacket = this.sendingQueues.get(clientSeq);
            if (sendPacket) {
                console.log("重试消息---->",sendPacket)
                WKSDK.shared().connectManager.sendPacket(sendPacket);
            }
        }

    }

    deleteMessageFromSendingQueue(clientSeq: number) {
        this.sendingQueues.delete(clientSeq)
    }

}