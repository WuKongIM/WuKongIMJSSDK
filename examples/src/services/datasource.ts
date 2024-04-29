import { Channel, ChannelInfo, ChannelTypeGroup, ChannelTypePerson, SyncOptions, WKSDK } from "../../../src/sdk"
import APIClient from "./APIClient"



export function initDataSource() {

    // 同步自己业务端的频道消息列表
    WKSDK.shared().config.provider.syncMessagesCallback = async (channel: Channel, opts: SyncOptions) => {
        const resultMessages = await APIClient.shared.syncMessages(channel, opts)
        return resultMessages
    }

    // 同步自己业务端的最近会话列表
    WKSDK.shared().config.provider.syncConversationsCallback = async () => {
        const resultConversations = await APIClient.shared.syncConversations()
        return resultConversations
    }

    // 获取频道信息
    // UI层可以通过const channelInfo = WKSDK.shared().channelManager.getChannelInfo(channel)获取缓存中的频道信息
    // 如果缓存中没有频道信息，调用 WKSDK.shared().channelManager.fetchChannelInfo(channel) 将会触发此回调，然后获取到channelInfo放入缓存
    WKSDK.shared().config.provider.channelInfoCallback = async (channel: Channel) => {
        // 这里仅做演示，实际应该是请求自己业务端的接口，然后返回自己业务端的频道信息，然后填充ChannelInfo,这样在UI的各处就可以很容易的获取到频道的业务信息
        if (channel.channelType === ChannelTypePerson) { // 这里调用你的业务接口获取个人信息
            const channelInfo = new ChannelInfo()
            channelInfo.title = channel.channelID // 个人名字
            channelInfo.logo = `https://api.multiavatar.com/${channel.channelID}.png` // 个人头像
            channelInfo.mute = false // 是否免打扰
            channelInfo.top = false // 是否置顶
            channelInfo.orgData = {} // 自己独有的业务数据可以放到这里
            channelInfo.online = false // 是否在线
            channelInfo.lastOffline = 0 // 最后离线时间
            channelInfo.channel = channel
            return channelInfo

        }

        // 群频道，这里调用你的业务接口获取群信息，然后填充ChannelInfo
        const channelInfo = new ChannelInfo()
        channelInfo.title = channel.channelID // 群名字
        channelInfo.logo = `https://api.multiavatar.com/${channel.channelID}.png` //群头像
        channelInfo.mute = false // 是否免打扰
        channelInfo.top = false // 是否置顶
        channelInfo.orgData = {} // 自己独有的业务数据可以放到这里
        channelInfo.channel = channel
        return channelInfo

    }
    // 如果是群频道，可以实现这个方法，调用 WKSDK.shared().channelManager.syncSubscribes(channel) 方法将会触发此回调
    //  WKSDK.shared().config.provider.syncSubscribersCallback

    // 如果涉及到消息包含附件（多媒体）可以实现这个方法，sdk将调用此方法进行附件上传
    //  WKSDK.shared().config.provider.messageUploadTask


}