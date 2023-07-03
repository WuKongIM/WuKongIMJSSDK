import { Channel, ChannelInfo, ChannelTypeData, ListenerState, Message, SubscribeAction, SubscribeContext, SubscribeListener, SubscribeOption, SubscribeOptions, Subscriber, UnsubscribeListener } from "./model";
import WKSDK from "./index";
import { SubPacket, SubackPacket } from "./proto";


// 成员数据改变回调
export type SubscriberChangeListener = (channel: Channel) => void;
export type ChannelInfoListener = (channelInfo: ChannelInfo) => void;




export class ChannelManager {
    // 频道基础信息map
    channelInfocacheMap: any = {};
    // 请求队列
    requestQueueMap: Map<string, boolean> = new Map();
    listeners: ((channelInfo: ChannelInfo) => void)[] = new Array(); // 监听改变
    // 频道成员缓存信息map
    subscribeCacheMap: Map<string, Subscriber[]> = new Map();
    // 成员请求队列
    requestSubscribeQueueMap: Map<string, boolean> = new Map();
    // 成员改变监听
    subscriberChangeListeners: SubscriberChangeListener[] = new Array();
    // 频道删除监听
    deleteChannelInfoListeners: ((channelInfo: ChannelInfo) => void)[] = new Array();

    subscriberContexts: SubscribeContext[] = new Array(); // 订阅者上下文集合

    subscriberContextTick: number = 0; // 订阅者上下文tick


    private constructor() {

    }

    private static instance: ChannelManager
    public static shared() {
        if (!this.instance) {
            this.instance = new ChannelManager();
            // this.instance.subscriberContextTick = window.setInterval(() => {
            //     this.instance.executeSubscribeContext();
            // }, 2000)
        }

        return this.instance;
    }

    // 提取频道信息
    async fetchChannelInfo(channel: Channel) {
        const channelKey = channel.getChannelKey();
        const has = this.requestQueueMap.get(channelKey); // 查看请求队列里是否有对应的请求，如果有则直接中断
        if (has) {
            return;
        }
        try {
            this.requestQueueMap.set(channelKey, true);
            if (WKSDK.shared().config.provider.channelInfoCallback != null) {

                const channelInfoModel = await WKSDK.shared().config.provider.channelInfoCallback(channel);
                this.channelInfocacheMap[channelKey] = channelInfoModel;
                if (channelInfoModel) {
                    this.notifyListeners(channelInfoModel);
                }
            }
        } finally {
            // 移除请求任务
            this.requestQueueMap.delete(channelKey);
        }
    }
    // 同步订阅者
    async syncSubscribes(channel: Channel) {
        const channelKey = channel.getChannelKey();
        const has = this.requestSubscribeQueueMap.get(channelKey); // 查看请求队列里是否有对应的请求，如果有则直接中断
        if (has) {
            return;
        }

        try {
            this.requestSubscribeQueueMap.set(channelKey, true);
            let cacheSubscribers = this.subscribeCacheMap.get(channelKey);
            let version: number = 0;
            if (cacheSubscribers && cacheSubscribers.length > 0) {
                const lastMember = cacheSubscribers[cacheSubscribers.length - 1];
                version = lastMember.version;
            } else {
                cacheSubscribers = new Array();
            }
            const subscribers = await WKSDK.shared().config.provider.syncSubscribersCallback(channel, version || 0);
            if (subscribers && subscribers.length > 0) {
                for (const subscriber of subscribers) {
                    let update = false;
                    for (let j = 0; j < cacheSubscribers.length; j++) {
                        const cacheSubscriber = cacheSubscribers[j];
                        if (subscriber.uid === cacheSubscriber.uid) {
                            update = true;
                            cacheSubscribers[j] = subscriber;
                            break;
                        }
                    }
                    if (!update) {
                        cacheSubscribers.push(subscriber);
                    }
                }
            }
            this.subscribeCacheMap.set(channelKey, cacheSubscribers);
            // 通知监听器
            this.notifySubscribeChangeListeners(channel);
        } finally {
            this.requestSubscribeQueueMap.delete(channelKey)
        }

    }
    getChannelInfo(channel: Channel): ChannelInfo | undefined {
        return this.channelInfocacheMap[channel.getChannelKey()];
    }
    // 设置频道缓存
    setChannleInfoForCache(channelInfo: ChannelInfo) {
        this.channelInfocacheMap[channelInfo.channel.getChannelKey()] = channelInfo;
    }
    // 删除频道信息
    deleteChannelInfo(channel: Channel) {
        const channelInfo = this.channelInfocacheMap[channel.getChannelKey()]
        delete this.channelInfocacheMap[channel.getChannelKey()]
        return channelInfo;
    }
    getSubscribes(channel: Channel): Subscriber[] {
        const subscribers = this.subscribeCacheMap.get(channel.getChannelKey());
        const newSubscribers = new Array();
        if (subscribers) {
            for (const subscriber of subscribers) {
                if (!subscriber.isDeleted) {
                    newSubscribers.push(subscriber);
                }
            }
        }
        return newSubscribers;
    }
    // 获取我在频道内的信息
    getSubscribeOfMe(channel: Channel) {
        const subscribers = this.subscribeCacheMap.get(channel.getChannelKey());
        if (subscribers) {
            for (const subscriber of subscribers) {
                if (!subscriber.isDeleted && subscriber.uid === WKSDK.shared().config.uid) {
                    return subscriber;
                }
            }
        }
        return null;
    }

    addSubscriberChangeListener(listener: SubscriberChangeListener) {
        this.subscriberChangeListeners.push(listener);
    }
    removeSubscriberChangeListener(listener: SubscriberChangeListener) {
        const len = this.subscriberChangeListeners.length;
        for (let i = 0; i < len; i++) {
            if (listener === this.subscriberChangeListeners[i]) {
                this.subscriberChangeListeners.splice(i, 1)
                return;
            }
        }
    }

    // 添加删除频道信息监听
    addDeleteChannelInfoListener(listener: (channel: ChannelInfo) => void) {
        this.deleteChannelInfoListeners.push(listener);
    }
    // 移除删除频道信息监听
    removeDeleteChannelInfoListener(listener: (channel: ChannelInfo) => void) {
        const len = this.deleteChannelInfoListeners.length;
        for (let i = 0; i < len; i++) {
            if (listener === this.deleteChannelInfoListeners[i]) {
                this.deleteChannelInfoListeners.splice(i, 1)
                return;
            }
        }
    }
    addListener(listener: ChannelInfoListener) {
        this.listeners.push(listener);
    }
    removeListener(listener: ChannelInfoListener) {
        const len = this.listeners.length;
        for (let i = 0; i < len; i++) {
            if (listener === this.listeners[i]) {
                this.listeners.splice(i, 1)
                return;
            }
        }
    }

    // 通知成员监听变化
    notifySubscribeChangeListeners(channel: Channel) {
        if (this.subscriberChangeListeners) {
            this.subscriberChangeListeners.forEach((callback) => {
                callback(channel);
            });
        }
    }

    notifyListeners(channelInfoModel: ChannelInfo) {
        if (this.listeners) {
            this.listeners.forEach((callback) => {
                callback(channelInfoModel);
            });
        }
    }

    notifySubscribeIfNeed(msg: Message) {
        const subscribeContext = this.getSubscribeContext(msg.channel)
        if (subscribeContext && subscribeContext.listenerStates) {
            for (const listenerState of subscribeContext.listenerStates) {
                if (listenerState.listener && listenerState.action === SubscribeAction.subscribe) {
                    (listenerState.listener as SubscribeListener)(msg)
                }
            }
        }
    }

    onSubscribe(ch: Channel | string, listener: SubscribeListener, ...opts: SubscribeOption[]) {

        // 参数设置
        const subscribeOpts = new SubscribeOptions()
        if (opts && opts.length > 0) {
            for (const opt of opts) {
                opt(subscribeOpts)
            }
        }
        // 频道
        let channel: Channel
        let channelData: any
        let channelType = ChannelTypeData
        if (ch instanceof Channel) {
            channelType = ch.channelType
            channelData = this.parseChannelURL(ch.channelID)
        } else {
            channelData = this.parseChannelURL(ch)
        }
        channel = new Channel(channelData.channelID, channelType)

        subscribeOpts.param = channelData.paramMap

        // 设置上下文
        let subscriberContext = this.getSubscribeContext(channel)
        if (!subscriberContext) {
            subscriberContext = new SubscribeContext(channel)
            this.subscriberContexts.push(subscriberContext)
        }
        let exist = false
        if (subscriberContext.listenerStates.length > 0) {
            for (const listenerState of subscriberContext.listenerStates) {
                if (listenerState.action === SubscribeAction.subscribe) {
                    listenerState.handleOk = false
                    listenerState.listener = listener
                    listenerState.options = subscribeOpts
                    exist = true
                    break
                }
            }
        }
        if (!exist) {
            subscriberContext.listenerStates.push(new ListenerState(SubscribeAction.subscribe, listener, subscribeOpts))
        }
        console.log("onSubscribe-->", subscriberContext.listenerStates.length)
        this.executeSubscribeContext()
    }

    parseChannelURL(channelUrl: string) {
        const data = channelUrl.split("?")
        if (data.length > 1) {
            const query = data[1]
            const paramMap = new Map<string, any>()
            const querys = query.split("&")
            for (const q of querys) {
                const queryData = q.split("=")
                if (queryData.length > 1) {
                    paramMap.set(queryData[0], queryData[1])
                }
            }
            return { channelID: data[0], paramMap }
        } else {
            return { channelID: channelUrl, paramMap: new Map() }
        }
    }

    onUnsubscribe(ch: Channel | string, listener?: UnsubscribeListener) {
        // 频道
        let channel: Channel
        let channelData: any
        let channelType = ChannelTypeData
        if (ch instanceof Channel) {
            channelType = ch.channelType
            channelData = this.parseChannelURL(ch.channelID)
        } else {
            channelData = this.parseChannelURL(ch)
        }
        channel = new Channel(channelData.channelID, channelType)

        let subscriberContext = this.getSubscribeContext(channel)
        if (!subscriberContext) {
            subscriberContext = new SubscribeContext(channel)
            this.subscriberContexts.push(subscriberContext)
        }

        let exist = false
        if (subscriberContext.listenerStates.length > 0) {
            for (const listenerState of subscriberContext.listenerStates) {
                if (listenerState.action === SubscribeAction.unsubscribe) {
                    listenerState.handleOk = false
                    listenerState.listener = listener
                    exist = true
                    break
                }
            }
        }
        if (!exist) {
            subscriberContext.listenerStates.push(new ListenerState(SubscribeAction.unsubscribe, listener))
        }
        this.executeSubscribeContext()
    }

    // 重新订阅
    reSubscribe() {
        for (const subscriberContext of this.subscriberContexts) {
            for (const listenerState of subscriberContext.listenerStates) {
                listenerState.handleOk = false;
                listenerState.sending = false
            }
        }
        this.executeSubscribeContext()
    }

    handleSuback(ack: SubackPacket) {
        for (const subscriberContext of this.subscriberContexts) {
            if (ack.channelID === subscriberContext.channel.channelID && ack.channelType === subscriberContext.channel.channelType) {
                if (ack.action === SubscribeAction.subscribe) {
                    if (subscriberContext.listenerStates && subscriberContext.listenerStates.length > 0) {
                        for (const listenerState of subscriberContext.listenerStates) {
                            if (listenerState.handleOk) {
                                continue;
                            }
                            listenerState.handleOk = true;
                            if (listenerState.listener && listenerState.action === SubscribeAction.subscribe) {
                                const subscribeListener = listenerState.listener as SubscribeListener
                                subscribeListener(undefined, ack.reasonCode)
                            }
                        }
                    }
                } else {
                    if (subscriberContext.listenerStates && subscriberContext.listenerStates.length > 0) {
                        for (const listenerState of subscriberContext.listenerStates) {
                            if (listenerState.handleOk) {
                                continue;
                            }
                            listenerState.handleOk = true;
                            if (listenerState.listener && listenerState.action === SubscribeAction.unsubscribe) {
                                const unsubscribeListener = listenerState.listener as UnsubscribeListener
                                unsubscribeListener(ack.reasonCode)
                            }
                        }
                    }
                }
            }
        }

        if (ack.action === SubscribeAction.unsubscribe) {
            for (let i = 0; i < this.subscriberContexts.length; i++) {
                const subscriberContext = this.subscriberContexts[i]
                if (subscriberContext.channel.channelID === ack.channelID && subscriberContext.channel.channelType === ack.channelType) {
                    this.subscriberContexts.splice(i, 1)
                    continue
                }
            }
        }
    }

    private getSubscribeContext(channel: Channel): SubscribeContext | undefined {
        for (const subscriberContext of this.subscriberContexts) {
            if (subscriberContext.channel.channelID === channel.channelID && subscriberContext.channel.channelType === channel.channelType) {
                return subscriberContext;
            }
        }
        return undefined;
    }

    private executeSubscribeContext() {
        for (const subscriberContext of this.subscriberContexts) {
            if (subscriberContext && subscriberContext.listenerStates.length > 0) {
                for (const listenerState of subscriberContext.listenerStates) {
                    if (listenerState.handleOk || listenerState.sending) {
                        continue;
                    }
                    listenerState.sending = true
                    this.sendSubscribe(subscriberContext.channel, listenerState.action, listenerState.options)
                }

            }
        }
    }

    private sendSubscribe(channel: Channel, action: SubscribeAction, opts?: SubscribeOptions) {

        console.log("sendSubscribe---->", action)
        const s = new SubPacket()
        s.channelID = channel.channelID
        s.channelType = channel.channelType
        s.action = action
        if (opts?.param) {
            s.param = JSON.stringify(Object.fromEntries(opts?.param))
        }

        WKSDK.shared().connectManager.sendPacket(s)
    }
}