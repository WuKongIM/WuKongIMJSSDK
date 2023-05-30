
<script setup lang="ts">
import { ref } from 'vue';
import APIClient from '../services/APIClient'
import { useRouter } from "vue-router";
import { WKSDK, Message, MessageText, Channel, ChannelTypePerson, ChannelTypeGroup, MessageStatus, SyncOptions, PullMode } from "../../../src/sdk";
import { ConnectStatus } from '../../../src/connect_manager';
import { SendackPacket } from '../../../src/proto';
import { Convert } from './convert';
import { nextTick } from 'process';
const router = useRouter();
const chatRef = ref<HTMLElement | null>(null)
const p2p = ref(true)
const showSettingPanel = ref(false)
const title = ref("")
const text = ref("")
const channelID = ref("")
const to = ref(new Channel("", 0))
const placeholder = ref("请输入对方登录名")
const pulluping = ref(false) // 上拉中
const pullupFinished = ref(false) // 上拉完成
const pulldowning = ref(false) // 下拉中
const pulldownFinished = ref(false) // 下拉完成

const messages = ref(new Array<Message>())

const uid = router.currentRoute.value.query.uid as string || undefined;
const token = router.currentRoute.value.query.token as string || "token111";

title.value = `${uid || ""}(未连接)`

// 获取IM的长连接地址
APIClient.shared.get('/route', {
    param: { uid: router.currentRoute.value.query.uid }
}).then((res) => {
    console.log(res)
    connectIM(res.ws_addr)

}).catch((err) => {
    console.log(err)
    alert(err.msg)
})

// 连接IM
const connectIM = (addr: string) => {
    const config = WKSDK.shared().config
    if (uid && token) {
        config.uid = uid;
        config.token = token
    }
    config.addr = addr
    WKSDK.shared().config = config

    // 同步消息的数据源
    WKSDK.shared().config.provider.syncMessagesCallback = async (channel: Channel, opts: SyncOptions) => {
        let resultMessages = new Array<Message>()
        const limit = 30;
        const resp = await APIClient.shared.post('/channel/messagesync', {
            login_uid: WKSDK.shared().config.uid,
            channel_id: channel.channelID,
            channel_type: channel.channelType,
            start_message_seq: opts.startMessageSeq,
            end_message_seq: opts.endMessageSeq,
            pull_mode: opts.pullMode,
            limit: limit
        })
        const messageList = resp && resp["messages"]
        if (messageList) {
            messageList.forEach((msg: any) => {
                const message = Convert.toMessage(msg);
                resultMessages.push(message);
            });
        }

        return resultMessages
    }

    // 监听连接状态
    WKSDK.shared().connectManager.addConnectStatusListener((status) => {
        if (status == ConnectStatus.Connected) {
            title.value = `${uid || ""}(连接成功)`
        } else {
            title.value = `${uid || ""}(断开)`
        }
    })

    // 监听消息
    WKSDK.shared().chatManager.addMessageListener((msg) => {
        if(to.value.channelID != msg.channel.channelID || to.value.channelType != msg.channel.channelType) {
            return
        }
        messages.value.push(msg)
        scrollBottom()
    })

    WKSDK.shared().chatManager.addMessageStatusListener((ack: SendackPacket) => {
        console.log(ack)
        messages.value.forEach((m) => {
            if (m.clientSeq == ack.clientSeq) {
                m.status = ack.reasonCode == 1 ? MessageStatus.Normal : MessageStatus.Fail
                return
            }
        })
    })

    WKSDK.shared().connect()
}

const onSend = () => {
    if (to.value && to.value.channelID != "") {
        let t = new MessageText(text.value)
        WKSDK.shared().chatManager.send(t, to.value)
        text.value = ""
    } else {
        showSettingPanel.value = true
    }

}

const chatP2pClick = (v: any) => {
    p2p.value = v.target.checked
    if (p2p.value) {
        placeholder.value = "请输入对方登录名"
    } else {
        placeholder.value = "请输入群组ID"
    }
}
const chatGroupClick = (v: any) => {
    p2p.value = !v.target.checked
    if (p2p.value) {
        placeholder.value = "请输入对方登录名"
    } else {
        placeholder.value = "请输入群组ID"
    }
}
const scrollBottom =  () => {
    const chat = chatRef.value
    if (chat) {
        nextTick(function () {
            chat.scrollTop = chat.scrollHeight
        })
    }
}
// 拉取当前会话最新消息
const pullLast = async () => {
    pulldowning.value = true
    const msgs = await WKSDK.shared().chatManager.syncMessages(to.value, {
        limit: 15, startMessageSeq: 0, endMessageSeq: 0,
        pullMode: PullMode.PullModeUp
    })
    pulldowning.value = false
    if (msgs && msgs.length > 0) {
        msgs.forEach((m) => {
            messages.value.push(m)
        })
    }
    scrollBottom()
    
}

const pullup = async () => {

    if(messages.value.length == 0) {
        return
    }
    const lastMsg = messages.value[messages.value.length-1]
    const msgs = await WKSDK.shared().chatManager.syncMessages(to.value, {
        limit: 15, startMessageSeq: lastMsg.messageSeq, endMessageSeq: 0,
        pullMode: PullMode.PullModeUp
    })
    if (msgs && msgs.length > 0) {
        msgs.forEach((m) => {
            messages.value.push(m)
        })
    }
}

const pullDown = async () => {
    if(messages.value.length == 0) {
        return
    }
    const firstMsg = messages.value[0]
    if(firstMsg.messageSeq == 1) {
        pulldownFinished.value = true
        return
    }
    const limit = 15
    const msgs = await WKSDK.shared().chatManager.syncMessages(to.value, {
        limit: limit, startMessageSeq: firstMsg.messageSeq-1, endMessageSeq: 0,
        pullMode: PullMode.PullModeDown
    })
    if(msgs.length < limit) {
        pulldownFinished.value = true
    }
    if (msgs && msgs.length > 0) {
        msgs.reverse().forEach((m) => {
            messages.value.unshift(m)
        })
    }
    nextTick(function () {
        const chat = chatRef.value
        const firstMsgEl = document.getElementById(firstMsg.clientMsgNo)
        if (firstMsgEl) {
            chat!.scrollTop = firstMsgEl.offsetTop
        }
    })
}


const settingClick = () => {
    showSettingPanel.value = !showSettingPanel.value
}

const settingOKClick = () => {
    if (p2p.value) {
        to.value = new Channel(channelID.value, ChannelTypePerson)
    } else {
        to.value = new Channel(channelID.value, ChannelTypeGroup)
    }
    if (!p2p.value) {
        joinChannel()
    }
    showSettingPanel.value = false

    pullLast() // 拉取最新消息
}

const joinChannel = () => {
    APIClient.shared.post('/channel', {
        channel_id: to.value.channelID,
        channel_type: to.value.channelType,
        subscribers: [WKSDK.shared().config.uid]
    }).then((res) => {
        console.log(res)
    }).catch((err) => {
        console.log(err)
        alert(err.msg)
    })
}

const logout = () => {
    WKSDK.shared().connectManager.disconnect()
    router.push({ path: '/' })
}

const getMessageText = (m: any) => {
    if (m.content instanceof MessageText) {
        const messageText = m.content as MessageText
        return messageText.text
    }
    return "未知消息"

}

const handleScroll = (e: any) => {
    const targetScrollTop = e.target.scrollTop;
    const scrollOffsetTop = e.target.scrollHeight - (targetScrollTop + e.target.clientHeight);
    if (targetScrollTop <= 250) { // 下拉
        if(pulldowning.value || pulldownFinished.value) {
            return
        }
        pulldowning.value = true
        pullDown().then(() => {
            pulldowning.value = false
        }).catch(() => {
            pulldowning.value = false
        })
    }
}

</script>
<template>
    <div class="chat">
        <div class="header">
            <div class="left">
                <button v-on:click="logout">退出</button>
            </div>
            <div class="center">
                {{ title }}
            </div>
            <div class="right">
                <button v-on:click="settingClick">{{ to.channelID.length == 0 ? '与谁会话？' : `${to.channelType ==
                    ChannelTypeGroup ? '群' : '单聊'}${to.channelID}` }}</button>
            </div>
        </div>
        <div class="content" v-on:scroll="handleScroll" ref="chatRef">
            <template v-for="m in messages">
                <div class="message right" v-if="m.send" :id="m.clientMsgNo">
                    <div class="status" v-if="m.status != MessageStatus.Normal">发送中</div>
                    <div class="bubble right">
                        <div class="text">{{ getMessageText(m) }}</div>
                    </div>
                    <div class="avatar">{{ m.fromUID.substring(0, 1).toUpperCase() }}</div>
                </div>
                <div class="message" v-if="!m.send" :id="m.clientMsgNo">
                    <div class="avatar">{{ m.fromUID.substring(0, 1).toUpperCase() }}</div>
                    <div class="bubble">
                        <div class="text">{{ getMessageText(m) }}</div>
                    </div>
                </div>
            </template>


        </div>
        <div class="footer">
            <input placeholder="发送消息" v-model="text" />
            <button v-on:click="onSend">发送</button>
        </div>
    </div>
    <transition name="fade">
        <div class="setting" v-if="showSettingPanel" v-on:click="settingClick">
            <div class="setting-content" @click.stop="">
                <div class="switch">
                    <div class="item">
                        <input type="radio" @click.stop="chatP2pClick" v-bind:checked="p2p" />单聊
                    </div>
                    <div class="item">
                        <input type="radio" @click.stop="chatGroupClick" v-bind:checked="!p2p" />群聊
                    </div>
                </div>
                <input :placeholder="placeholder" class="to" v-model="channelID" />
                <button class="ok" v-on:click="settingOKClick">确定</button>
            </div>
        </div>
    </transition>
</template>

<style scoped>
.chat {
    width: 100%;
    height: 100vh;
    display: flex;
    flex-direction: column;
}

.header {
    height: 60px;
    background-color: #f5f5f5;
    display: flex;
    align-items: center;
    justify-content: center;
    border-bottom: 1px;
    position: fixed;
    top: 0;
    width: 100%;
}

.header .left button {
    margin-left: 10px;
    height: 40px;
    display: flex;
    align-items: center;
    font-size: 15px;
    background-color: transparent;
}

.header .center {
    flex: 1;
    font-size: 18px;
    font-weight: bold;
}

.header .right button {
    margin-right: 10px;
    height: 40px;
    display: flex;
    align-items: center;
    font-size: 15px;
    background-color: transparent;
    color: rgb(228, 98, 64);
}



.content {
    flex: 1;
    background-color: #f5f5f5;
    flex-direction: column;
    padding-top: 60px;
    /* header height */
    padding-bottom: 60px;
    overflow-y: auto;
    /* footer height */
}

.message {
    display: flex;
    margin: 10px;
}

.message.right {
    justify-content: flex-end;
}

.message .bubble {
    background-color: white;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 0px 10px 10px 10px;
    padding: 10px;
    color: black;
    margin-left: 10px;
}

.bubble.right {
    border-radius: 10px 0px 10px 10px;
    background-color: rgb(228, 98, 64);
    color: white;
    margin-right: 10px;
}

.message .avatar {
    width: 40px;
    height: 40px;
    background-color: green;
    border-radius: 20px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 16px;
    color: white;
}

.message .status {
    font-size: 12px;
    color: rgb(228, 98, 64);
    margin-left: 10px;
    margin-bottom: 5px;
    display: flex;
    align-items: center;
}

.message .bubble .text {
    display: flex;
    text-align: left;
    font-size: 14px;
    max-width: 250px;
}


.footer {
    height: 60px;
    background-color: white;
    display: flex;
    position: fixed;
    bottom: 0px;
    width: 100%;
    align-items: center;
}

.footer button {
    width: 80px;
    height: 40px;
    margin: 5px;
    border: none;
    outline: none;
    background-color: rgb(228, 98, 64);
    color: white;
    font-size: 15px;
}

.footer input {
    flex: 1;
    border: none;
    outline: none;
    margin-left: 10px;
}

.setting {
    position: absolute;
    top: 0px;
    left: 0px;
    width: 100%;
    height: 100%;
}

.setting .setting-content {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 250px;
    background-color: white;
    box-shadow: 0 0 10px rgba(0, 0, 0, 0.1);
    padding: 20px;
    border-radius: 4px;
}

.switch {
    display: flex;
    align-items: center;
    width: 100%;
    justify-content: center;
    margin-top: 10px;
}

.switch .item {
    margin-left: 20px;
    font-size: 14px;
}

.to {
    border: none;
    width: 100%;
    height: 40px;
    margin-top: 20px;
    box-sizing: border-box;
}

.ok {
    width: 100%;
    height: 40px;
    margin-top: 30px;
    border: none;
    outline: none;
    background-color: rgb(228, 98, 64);
    color: white;
    font-size: 15px;
    cursor: pointer;
}

.fade-enter-active,
.fade-leave-active {
    transition: opacity 0.5s;
}

.fade-enter,
.fade-leave-to {
    opacity: 0;
}
</style>