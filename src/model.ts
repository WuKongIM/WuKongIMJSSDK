import { RecvPacket, SendPacket, Setting } from './proto';
import WKSDK from './index';
import { MessageContentType } from "./const"


// ---------- 频道类型 ----------
// 个人频道
export const ChannelTypePerson = 1;
// 群聊频道
export const ChannelTypeGroup = 2;

export class Channel {
    channelID!: string;
    channelType!: number;
    constructor(channelID: string, channelType: number) {
        this.channelID = channelID;
        this.channelType = channelType;
    }


    public getChannelKey() {
        return `${this.channelID}-${this.channelType}`;
    }
    public static fromChannelKey(channelKey: string): Channel | undefined {
        const channelProps = channelKey.split("-")
        if (channelProps.length >= 2) {
            const channelType = parseInt(channelProps[1], 0)
            return new Channel(channelProps[0], channelType)
        }
        return undefined
    }

    isEqual(c: Channel) {
        if (this.channelID === c.channelID && this.channelType === c.channelType) {
            return true;
        }
        return false;
    }
}

// 回应
export class Reaction {
    seq!: string // 序列号
    count!: number // 回应数量
    emoji!: string // 回应emoji
    users!: any[] // 回应用户
}

function decodePayload(payload: Uint8Array): MessageContent {
    let contentType = 0
    if (payload) {
        const encodedString = String.fromCharCode.apply(null, Array.from(payload));
        const decodedString = decodeURIComponent(escape(encodedString));
        const contentObj = JSON.parse(decodedString)
        if (contentObj) {
            contentType = contentObj.type
        }
    }
    const messageContent = MessageContentManager.shared().getMessageContent(contentType)
    messageContent.decode(payload)

    return messageContent
}

export class MessageHeader {
    reddot!: boolean; // 是否显示红点
    noPersist!: boolean; // 是否不存储
    syncOnce!: boolean; // 是否只同步一次
    dup!: boolean; // 是否是重发
}


export enum MessageStatus {
    Wait,
    Normal,
    Fail
}

export class Message {

    constructor(recvPacket?: RecvPacket) {

        if (recvPacket) {
            this.header.reddot = recvPacket.reddot
            this.header.dup = recvPacket.dup
            this.header.noPersist = recvPacket.noPersist
            this.header.syncOnce = recvPacket.syncOnce
            this.setting = Setting.fromUint8(recvPacket.setting)
            this.messageID = recvPacket.messageID
            this.messageSeq = recvPacket.messageSeq
            this.clientMsgNo = recvPacket.clientMsgNo
            this.fromUID = recvPacket.fromUID
            this.channel = new Channel(recvPacket.channelID, recvPacket.channelType)
            this.timestamp = recvPacket.timestamp
            this.content = decodePayload(recvPacket.payload)
            this.status = MessageStatus.Normal
        }
    }
    public static fromSendPacket(sendPacket: SendPacket, content?: MessageContent): Message {
        const m = new Message()
        m.header.reddot = true
        m.setting =Setting.fromUint8(sendPacket.setting)
        m.clientMsgNo = sendPacket.clientMsgNo
        m.clientSeq = sendPacket.clientSeq
        m.fromUID = sendPacket.fromUID
        m.channel = new Channel(sendPacket.channelID, sendPacket.channelType)
        if (content) {
            m.content = content
        } else {
            m.content = decodePayload(sendPacket.payload)
        }
        m.timestamp = parseInt((new Date().getTime() / 1000).toString()); /* tslint:disable-line */
        m.status = MessageStatus.Wait
        return m

    }

    header: MessageHeader = new MessageHeader()
    setting: Setting = new Setting(); // 设置
    /* tslint:disable-line */
    clientSeq!: number;  // 客户端序列号
    messageID!: string; // 消息唯一ID
    messageSeq!: number; // 消息序列号
    clientMsgNo!: string // 客户端消息唯一编号
    fromUID!: string; // 发送者uid
    channel!: Channel; // 频道
    timestamp!: number; // 消息发送时间
    content!: MessageContent; // 消息负载
    status!: MessageStatus; // 消息状态 1.成功 其他失败
    voicePlaying: boolean = false; // 语音是否在播放中 （语音消息特有）
    voiceReaded: boolean = false; // 语音消息是否已读
    reactions!: Reaction[]; // 回应数据
    isDeleted: boolean = false // 是否已删除

    remoteExtra: MessageExtra = new MessageExtra()

    // 是否是发送的消息
    public get send(): boolean {
        return this.fromUID === WKSDK.shared().config.uid
    }

    public get contentType(): number {
        return this.content.contentType
    }

}

export class MessageExtra {
    messageID!: string; // 消息唯一ID
    channel!: Channel; // 频道
    messageSeq!: number; // 消息序列号
    readed!: boolean // 消息是否已读
    readedAt!: Date // 已读时间
    readedCount: number = 0
    unreadCount: number = 0 // 未读数量
    revoke: boolean = false // 是否已撤回
    revoker?: string // 撤回者的uid
    contentEditData?: Uint8Array //  消息编辑后的正文data数据
    contentEdit?: MessageContent
    editedAt: number = 0 // 消息编辑时间 （0表示消息未被编辑）
    isEdit: boolean = false // 是否编辑
    extra: any = {} // 扩展数据
    extraVersion: number = 0 // 扩展数据版本 
}

export class Mention {
    all?: boolean // @所有人
    uids?: string[] // @指定的人

}


export class MessageContent {
    private _contentType!: number;
    public get contentType(): number {
        return this._contentType;
    }
    public set contentType(value: number) {
        this._contentType = value;
    }
    private _conversationDigest!: string;
    public get conversationDigest(): string {
        return this._conversationDigest;
    }
    public set conversationDigest(value: string) {
        this._conversationDigest = value;
    }
    private visibles?: string[] // 可见
    private invisibles?: string[] // 不可见

    public reply!: Reply // 回复

    mention?: Mention
    contentObj: any
    public encode(): Uint8Array {
        const contentObj = this.encodeJSON()
        contentObj.type = this.contentType
        if (this.mention) {
            const mentionObj:any = {}
            if (this.mention.all) {
                mentionObj["all"] = 1
            }
            if (this.mention.uids) {
                mentionObj["uids"] = this.mention.uids
            }
            contentObj["mention"] = mentionObj
        }
        if (this.reply) {
            contentObj["reply"] = this.reply.encode()
        }

        const contentStr = JSON.stringify(contentObj)
        return stringToUint8Array(contentStr)
    }

    public decode(data: Uint8Array) {
        const decodedString = uint8ArrayToString(data);
        const contentObj = JSON.parse(decodedString)
        this.contentObj = contentObj
        if (contentObj) {
            this._contentType = contentObj.type
        }
        const mentionObj = contentObj["mention"]
        if (mentionObj) {
            const mention = new Mention()
            mention.all = mentionObj["all"] === 1
            if (mentionObj["uids"]) {
                mention.uids = mentionObj["uids"]
            }
            this.mention = mention
        }
        const replyObj = contentObj["reply"]
        if (replyObj) {
            const reply = new Reply()
            reply.decode(replyObj)
            this.reply = reply
        }
        this.visibles = contentObj["visibles"]
        this.invisibles = contentObj["invisibles"]
        this.decodeJSON(contentObj)

    }
    // 是否可见
    public isVisiable(uid: string) {
        if (this.visibles && this.visibles.length > 0) {
            const v = this.visibles.includes(uid)
            if (!v) {
                return false
            }
        }
        if (this.invisibles && this.invisibles.length > 0) {
            const v = this.invisibles.includes(uid)
            if (v) {
                return false
            }
        }
        return true
    }



    // 子类重写
    // tslint:disable-next-line:no-empty
    public decodeJSON(content: any) { }
    // 子类重写
    // tslint:disable-next-line:no-empty
    public encodeJSON(): any {
        return {}
    }
}

function stringToUint8Array(str: string): Uint8Array {
    const newStr = unescape(encodeURIComponent(str))
    const arr = new Array<number>();
    for (let i = 0, j = newStr.length; i < j; ++i) {
        arr.push(newStr.charCodeAt(i));
    }
    const tmpUint8Array = new Uint8Array(arr);
    return tmpUint8Array
}

function uint8ArrayToString(fileData: Uint8Array) {
    const encodedString = String.fromCharCode.apply(null, Array.from(fileData));
    const decodedString = decodeURIComponent(escape(encodedString));
    return decodedString
}

export class MediaMessageContent extends MessageContent {
    file?: File
    extension!: string
    remoteUrl!: string
    // 处理data
    // tslint:disable-next-line:no-empty
    public dealFile(): void {
    }
}


// 订阅者
export class Subscriber {
    /* tslint:disable-line */
    uid!: string; // 订阅者uid
    name!: string; // 订阅者名称
    remark!: string; // 订阅者备注
    avatar!: string; // 订阅者头像
    role!: number; // 订阅者角色
    channel!: Channel; // 频道
    version!: number; // 数据版本
    isDeleted!: boolean; // 是否已删除
    status!: number; // 订阅者状态
    orgData: any; // 频道原生数据
}


export class ChannelInfo {
    /* tslint:disable-line */
    channel!: Channel; // 频道
    title!: string; // 频道标题
    logo!: string; // 频道logo
    mute!: boolean; // 是否免打扰
    top!: boolean; // 是否置顶
    orgData: any; // 频道原生数据
    online: boolean = false // 是否在线
    lastOffline: number = 0 // 最后一次离线时间
}
export class Conversation {
    channel!: Channel; // 频道
    private _channelInfo: ChannelInfo | undefined;
    unread!: number; // 未读消息
    _logicUnread: number = 0 // 逻辑未读
    timestamp: number = 0
    lastMessage?: Message; // 最后一条消息
    extra?: any // 扩展数据（用户自定义的数据）
    _remoteExtra!: ConversationExtra // 远程扩展数据
    private _isMentionMe?: boolean; // 是否有人@我
    private _reminders = new Array<Reminder>() // 提醒项
    simpleReminders = new Array<Reminder>()// 除去重复的type了的reminder

    public get channelInfo() {
        return WKSDK.shared().channelManager.getChannelInfo(this.channel);
    }

    public isEqual(c: Conversation) {
        if (!c) {
            return false;
        }
        return c.channel.getChannelKey() === this.channel.getChannelKey();
    }
    public get isMentionMe(): boolean | undefined {
        if (this._isMentionMe === undefined) {
            this.reloadIsMentionMe()
        }
        return this._isMentionMe
    }
    public set isMentionMe(isMentionMe: boolean | undefined) {
        this._isMentionMe = isMentionMe
    }
    public get remoteExtra(): ConversationExtra {
        if (this._remoteExtra) {
            return this._remoteExtra
        }
        this._remoteExtra = new ConversationExtra()
        this._remoteExtra.channel = this.channel
        return this._remoteExtra
    }
    public set remoteExtra(remoteExtra: ConversationExtra) {
        this._remoteExtra = remoteExtra
    }

    public get logicUnread(): number {
        if (this.remoteExtra.browseTo > 0 && this.lastMessage && this.remoteExtra.browseTo <= this.lastMessage.messageSeq) {
            return this.lastMessage.messageSeq - this.remoteExtra.browseTo
        }
        return this.unread
    }

    public set reminders(reminders: Reminder[]) {
        this._reminders = reminders

        const simpleReminders = new Array<Reminder>()
        if (reminders && reminders.length > 0) {
            for (const reminder of reminders) {
                if (reminder.done) {
                    continue
                }
                let exist = false
                let i = 0
                for (const simpleReminder of simpleReminders) {
                    if (reminder.reminderType === simpleReminder.reminderType) {
                        exist = true;
                        break;
                    }
                    i++;
                }
                if (!exist) {
                    simpleReminders.push(reminder)
                } else {
                    simpleReminders[i] = reminder;
                }
            }
        }
        this.simpleReminders = simpleReminders
    }

    public get reminders() {
        return this._reminders
    }

    // 重新计算 isMentionMe
    public reloadIsMentionMe() {
        if (this.lastMessage && this.lastMessage.content) {
            const mention = this.lastMessage.content.mention
            if (mention) {
                if (mention.all) {
                    this._isMentionMe = true
                }
                if (mention.uids && mention.uids.includes(WKSDK.shared().config.uid || "")) {
                    this._isMentionMe = true
                }
            }
        }
        if (!this._isMentionMe) {
            this._isMentionMe = false
        }
    }
}

export class ConversationExtra {
    channel!: Channel
    browseTo!: number
    keepMessageSeq!: number
    keepOffsetY!: number
    draft?: string
    version!: number
}

// export class ConversationHistory {
//     conversation!:Conversation
//     recents:Array<Message> = new Array() // 会话的最新消息集合
//     version!:number // 数据版本
// }

export class SignalKey {
    identityKey!: ArrayBuffer
    signedKeyID!: number
    signedPubKey!: ArrayBuffer
    signedSignature!: ArrayBuffer
    preKeyID?: number
    preKeyPublicKey?: ArrayBuffer
    registrationId!: number
}

export class Reply {
    messageID?: string
    messageSeq!: number
    fromUID!: string
    fromName!: string
    rootMessageID?: string
    content!: MessageContent

    public encode() {
        const rep:any = {
            "message_id": this.messageID,
            "message_seq": this.messageSeq,
            "from_uid": this.fromUID,
            "from_name": this.fromName
        }
        if (this.rootMessageID) {
            rep["root_message_id"] = this.rootMessageID
        }
        if (this.content) {
            rep["payload"] = JSON.parse(uint8ArrayToString(this.content.encode()))
        }
        return rep
    }

    public decode(data: any) {
        this.messageID = data["message_id"]
        this.messageSeq = data["message_seq"]
        this.fromUID = data["from_uid"]
        this.fromName = data["from_name"]
        this.rootMessageID = data["root_message_id"]
        if (data["payload"]) {
            const contentType = data["payload"]["type"]
            const messageContent = WKSDK.shared().getMessageContent(contentType)
            const payload = stringToUint8Array(JSON.stringify(data["payload"]))
            messageContent.decode(payload)
            this.content = messageContent
        }
    }
}

export enum ReminderType {
    ReminderTypeMentionMe = 1, // 有人@我
    ReminderTypeApplyJoinGroup = 2 // 申请加群
}
export class Reminder {
    channel!: Channel
    reminderID!: number
    messageID!: string
    messageSeq!: number
    reminderType!: ReminderType //  提醒类型
    text?: string // 文本提示
    data?: any // 提醒包含的自定义数据
    isLocate: boolean = false // 是否需要进行消息定位
    version: number = 0
    done: boolean = false // 用户是否完成提醒

    isEqual(c: Reminder) {
        if (this.reminderID === c.reminderID) {
            return true;
        }
        return false;
    }
}

export enum PullMode {
    Down = 0, // 向下拉取
    Up = 1 // 向上拉取
}

// 详细参考文档说明：https://githubim.com/api/message#%E8%8E%B7%E5%8F%96%E6%9F%90%E9%A2%91%E9%81%93%E6%B6%88%E6%81%AF
export class SyncOptions {
    startMessageSeq: number = 0 // 开始消息列号（结果包含start_message_seq的消息）
    endMessageSeq: number = 0 //  结束消息列号（结果不包含end_message_seq的消息）0表示不限制
    limit: number = 30 // 每次限制数量
    pullMode: PullMode = PullMode.Down // 拉取模式 0:向下拉取 1:向上拉取
}


export class MessageContentManager {
    contentMap: Map<number, (contentType: number) => MessageContent> = new Map()
    private factor!: (contentType: number) => MessageContent | undefined

    private static instance: MessageContentManager
    public static shared() {
        if (!this.instance) {
            this.instance = new MessageContentManager();
        }
        return this.instance;
    }
    private constructor() { }

    register(contentType: number, handler: (contentType?: number) => MessageContent) {
        this.contentMap.set(contentType, handler)
    }
    registerFactor(factor: (contentType: number) => MessageContent | undefined) {
        this.factor = factor
    }

    getMessageContent(contentType: number): MessageContent {
        const handler = this.contentMap.get(contentType)
        if (handler) {

            // tslint:disable-next-line:no-shadowed-variable
            const content = handler(contentType)
            if (content) {
                return content
            }
        }
        const content = this.factor(contentType)
        if (content) {
            return content
        }
        return new UnknownContent()
    }
}




/**
 * 文本
 */
export class MessageText extends MessageContent {
    text?: string

    constructor(text?: string) {
        super()
        this.text = text
    }

    public get conversationDigest(): string {
        return this.text || ""
    }

    public get contentType(): number {
        return MessageContentType.text
    }
    public decodeJSON(content: any) {
        this.text = content["content"]
    }
    public encodeJSON(): any {
        return { content: this.text || '' }
    }

}

export class MessageSignalContent extends MessageContent {
    public get contentType(): number {
        return MessageContentType.signalMessage
    }
}

/**
 * 未知
 */
export class UnknownContent extends MessageContent {
    realContentType!: number
    public get contentType(): number {
        return MessageContentType.unknown
    }
    public get conversationDigest(): string {
        return "[未知消息]"
    }
    public decodeJSON(content: any) {
        this.realContentType = content["type"]
    }
}

/**
 * 系统消息
 */
export class SystemContent extends MessageContent {
    content: any;
    private _displayText!: string
    public decodeJSON(content: any) {
        this.content = content
    }

    public get conversationDigest(): string {
        return this.displayText
    }

    public get displayText() {
        const extra = this.content["extra"]
        let content = this.content["content"] as string
        if (extra) {
            const extraArray = extra as any[]
            if (extraArray && extraArray.length > 0) {
                for (let i = 0; i <= extraArray.length - 1; i++) {
                    const extrMap = extraArray[i]
                    const name = extrMap["name"] || ""
                    // if(WKSDK.shared().config.uid === extrMap["uid"] ) {
                    //     name = "你"
                    // }
                    content = content.replace(`{${i}}`, name)
                }
            }
        }
        return content
    }
}

export class CMDContent extends MessageContent {
    cmd!: string
    param: any
    public decodeJSON(content: any) {
        this.cmd = content["cmd"]
        this.param = content["param"]
    }
    public get contentType(): number {
        return MessageContentType.cmd
    }
}