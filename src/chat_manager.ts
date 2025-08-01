import { MessageContentType } from "./const";
import { Guid } from "./guid";
import WKSDK, { Stream } from "./index";
import { Channel, ChannelTypePerson, MediaMessageContent, Message, MessageContent, SyncOptions, MessageSignalContent } from "./model";
import { ChunkPacket, Packet, RecvackPacket, RecvPacket, SendackPacket, SendPacket, Setting, StreamFlag } from "./proto";
import { Task, MessageTask, TaskStatus } from "./task";
import { Md5 } from "md5-typescript";
import { SecurityManager } from "./security";
import { StreamManager } from "./stream_manager";

export type MessageListener = ((message: Message) => void);
export type MessageStatusListener = ((p: SendackPacket) => void);

export class ChatManager {
    cmdListeners: ((message: Message) => void)[] = new Array(); // 命令类消息监听
    listeners: MessageListener[] = new Array(); // 收取消息监听
    chunkListeners: ((chunk: ChunkPacket) => void)[] = new Array(); // 分片消息监听
    sendingQueues: Map<number, SendPacket> = new Map(); // 发送中的消息
    sendPacketQueue: Packet[] = [] // 发送队列
    sendTimer: any // 发送定时器
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

            if (message.setting.streamOn) {
                const stream = StreamManager.shared().openStream(message)
                if (stream) {
                    StreamManager.shared().notifyStreamChangeListeners(stream)
                }
                return
            }

             // 通知消息监听者
            this.notifyMessageListeners(message);
            
            WKSDK.shared().channelManager.notifySubscribeIfNeed(message); // 通知指定的订阅者
        } else if (packet instanceof SendackPacket) {
            const sendack = packet as SendackPacket;
            this.sendingQueues.delete(sendack.clientSeq);
            // 发送消息回执
            this.notifyMessageStatusListeners(sendack);
        } else if (packet instanceof ChunkPacket) {
            // 消息分片
            const stream = StreamManager.shared().getStream(packet.messageID)
            if(!stream) {
                console.log("没有找到对应的流，忽略分片消息","消息ID:",packet.messageID,"分片ID:",packet.chunkID)
                return
            }
            if (stream.isEnd) {
                console.log("warn:流已经结束，但是仍然收到分片消息","消息ID:",packet.messageID,"分片ID:",packet.chunkID,"分片内容:",packet.payload)
            }
            stream.addChunk(packet)
            StreamManager.shared().notifyStreamChangeListeners(stream);
        }

    }

    async syncMessages(channel: Channel, opts: SyncOptions): Promise<Message[]> {
        if (!WKSDK.shared().config.provider.syncMessagesCallback) {
            throw new Error("没有设置WKSDK.shared().config.provider.syncMessagesCallback")
        }
        return WKSDK.shared().config.provider.syncMessagesCallback!(channel, opts)
    }

    async syncMessageExtras(channel: Channel, extraVersion: number) {
        if (!WKSDK.shared().config.provider.syncMessageExtraCallback) {
            throw new Error("没有设置WKSDK.shared().config.provider.syncMessageExtraCallback")
        }
        return WKSDK.shared().config.provider.syncMessageExtraCallback!(channel, extraVersion, 100)
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
        const opts = new SendOptions()
        opts.setting = setting || new Setting()
        return this.sendWithOptions(content, channel, opts)
    }

    async sendWithOptions(content: MessageContent, channel: Channel, opts: SendOptions) {
        const packet = this.getSendPacketWithOptions(content, channel, opts)

        this.sendingQueues.set(packet.clientSeq, packet);

        const message = Message.fromSendPacket(packet, content)
        if (content instanceof MediaMessageContent) {
            if(!content.file) { // 没有文件，直接上传
                console.log("不需要上传",content.remoteUrl)
                this.sendSendPacket(packet)
            }else {
                console.log("开始上传")
                const task = WKSDK.shared().config.provider.messageUploadTask(message)
                if (task) {
                    console.log("上传任务添加成功")
                    WKSDK.shared().taskManager.addTask(task)
                }else {
                    console.log("没有实现上传数据源")
                }
            }
           
        } else {
            this.sendSendPacket(packet)
        }
        this.notifyMessageListeners(message)

        return message
    }

    sendSendPacket(p: SendPacket) {
        this.sendPacketQueue.push(p)
        if(!this.sendTimer) {
            this.sendTimer = setInterval(() => {
                const sendData = new Array<number>()
                let sendCount  = 0
                while (this.sendPacketQueue.length > 0) {
                    const packet = this.sendPacketQueue.shift()
                    if(packet) {
                        const packetData = Array.from(WKSDK.shared().config.proto.encode(packet))
                        sendData.push(...packetData)
                    }
                    sendCount++
                    if(sendCount >= WKSDK.shared().config.sendCountOfEach) {
                        break
                    }
                }
                if(sendData.length > 0) {
                    WKSDK.shared().connectManager.send(new Uint8Array(sendData))
                } 
            }, WKSDK.shared().config.sendFrequency)
        }
    }
    getSendPacket(content: MessageContent, channel: Channel, setting: Setting = new Setting()): SendPacket {
        const packet = new SendPacket();
        packet.setting = setting
        packet.reddot = true;
        packet.clientMsgNo = `${Guid.create().toString().replace(/-/gi, "")}3`
        packet.streamNo = setting.streamNo
        packet.clientSeq = this.getClientSeq()
        packet.fromUID = WKSDK.shared().config.uid || '';
        packet.channelID = channel.channelID;
        packet.channelType = channel.channelType
        packet.payload = content.encode()
        return packet
    }
    getSendPacketWithOptions(content: MessageContent, channel: Channel, opts: SendOptions = new SendOptions()): SendPacket {
        const setting =  opts.setting || new Setting()
        const packet = new SendPacket();
        packet.reddot = opts.reddot;
        packet.noPersist = opts.noPersist;
        packet.setting = setting
        packet.reddot = true;
        packet.clientMsgNo = `${Guid.create().toString().replace(/-/gi, "")}_${WKSDK.shared().config.clientMsgDeviceId}_3`
        packet.streamNo = setting.streamNo
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
            this.cmdListeners.forEach((listener: (message: Message) => void) => {
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
            this.sendStatusListeners.forEach((listener: (ack: SendackPacket) => void) => {
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
                console.log("重试消息---->", sendPacket)
                WKSDK.shared().connectManager.sendPacket(sendPacket);
            }
        }

    }

    deleteMessageFromSendingQueue(clientSeq: number) {
        this.sendingQueues.delete(clientSeq)
    }

}

export class SendOptions {
    setting: Setting = new Setting() // setting
    noPersist: boolean = false // 是否不存储
    reddot: boolean = true // 是否显示红点

}