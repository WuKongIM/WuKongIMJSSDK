# 消息编辑接入

此功能需要包含 [WuKongIM #959](https://github.com/WuKongIM/WuKongIM/pull/959)
的服务端，且需包含本次配套的 `c1db384a8` 修复（分支
`codex/message-update-hint-route`）：编辑提示路由必须保留设备身份，否则真实客户端
的会话校验会丢弃提示。当前文档描述此分支源码，不能据此认为已发布的 npm 1.3.5 包支持编辑。

使用者增加一处配置、一个编辑调用和一个更新监听。继续使用
`conversationManager.openConversation` 和 `chatManager.syncMessages()`；
不需要管理同步 Session、编辑游标或版本比较。

## 标准 HTTP 适配器

```ts
import { WKSDK, installMessageEditing, MessageText } from "wukongimjssdk"

const sdk = WKSDK.shared()
// 先按原有流程设置 sdk.config.uid、token、addr。
const uninstall = installMessageEditing(sdk, {
  // 所有请求发往自己的业务后端。transport 应使用现有登录凭据并设置超时。
  transport: async (path, body, signal) => {
    const response = await businessApi.post(path, body, { signal })
    return {
      status: response.status,
      body: response.data,
      contentEpoch: response.headers["x-wk-content-epoch"],
    }
  },
  conversationRoute: "/conversation/sync", // 也支持 /conversation/list
  onError: error => showSyncError(error),
})

const onUpdated = messages => {
  // 按 channel + messageID 替换已展示的消息；不要追加气泡或增加未读。
  chatStore.replaceExisting(messages)
}
sdk.chatManager.addMessageUpdateListener(onUpdated)

// 原有的页面生命周期和历史查询保持不变。
sdk.conversationManager.openConversation = conversation
const page = await sdk.chatManager.syncMessages(conversation.channel, historyOptions)

// 保存完整的新正文；request_id、预期版本和 epoch 由 SDK 管理。
await sdk.chatManager.updateMessage(message, new MessageText("下午三点开会"))

// 离开聊天页。
sdk.conversationManager.openConversation = undefined
// 销毁应用或注销账号时。
sdk.chatManager.removeMessageUpdateListener(onUpdated)
uninstall()
sdk.disconnect()
```

适配器安装标准历史、最近会话、编辑和编辑增量 Provider，卸载时恢复原有 Provider。
如果原有 Provider 包含业务扩展字段、分页管理或自定义路由，使用下文的自定义模式，
避免覆盖这些逻辑。浏览器前后台变化自动处理；UniApp 等宿主可调用
`sdk.messageUpdateManager.setForeground(visible)` 转发生命周期。

## 业务后端需要提供什么

标准适配器使用以下路径和服务端原有 JSON 结构：

| 路径 | 业务后端职责 |
| --- | --- |
| `/message/update` | 验证作者、频道权限和编辑时间窗口；转发完整正文及幂等参数 |
| `/channel/messageupdates` | 注入登录 UID，转发当前频道的游标和分页参数 |
| `/channel/messagesync` | 保留消息 ID 字符串、正文版本和编辑时间 |
| `/conversation/sync` 或 `/conversation/list` | 保留最后消息的正文版本及编辑时间 |

从业务登录态确定 `login_uid` / `uid`，不能信任客户端自报身份。
成功响应保留 `X-WK-Content-Epoch`；也可由后端在 JSON 根对象提供
`content_epoch`。错误保留 HTTP 状态及 JSON `code`，不能全部转换为普通 HTTP 200。
如果使用会自动抛出非 2xx 的 HTTP 客户端，transport 需要返回其 HTTP 响应，或将异常
转换成保留 `code`、`status` 的 `MessageUpdateError`；网络超时用 `timeout` 或
`network_error`。业务 HTTP 客户端负责认证、超时和 AbortSignal。

最近会话的默认查询是 legacy 第 1 页、每页 100 个会话、每个会话一个预览。
`conversationManager.sync(filter)` 可以继续传入分页条件。后台刷新合并重复提示，
刷新最近使用的会话查询范围，不遍历每个频道的编辑接口。
编辑不推进普通会话版本；读取最新预览时不能只依赖“新消息版本大于上次版本”的筛选。
canonical `/conversation/list` 的目录游标、coverage 和完整分页遍历继续由业务数据源管理；
标准适配器只转换本次返回的页面和明确的 `deletes`，不会把缺席于某一页的会话当作删除。

## 保留自定义 Provider

原来的两个读取回调增加响应包装；只有开启编辑时才要求 epoch，未开启时数组返回值仍兼容。
SDK 的公开 `syncMessages()` / `sync()` 仍返回数组。

```ts
provider.syncMessagesCallback = async (channel, options) => ({
  contentEpoch: "7",
  data: messages, // Message[]，保留业务扩展字段
})
provider.syncConversationsCallback = async filter => ({
  contentEpoch: "7",
  data: conversations, // Conversation[]
  removedChannels: [], // 可选，仅放服务端明确删除的频道
})
provider.updateMessageCallback = async (request, signal) => ({
  contentEpoch: "7",
  data: { messageID: request.messageID, messageSeq: 100, version: "1", updatedAtMs: 1789300800000 },
})
provider.syncMessageUpdatesCallback = async (channel, options) => ({
  contentEpoch: "7",
  data: { updates: messages, nextUpdateCursor: "opaque", more: false, resetRequired: false },
})
const uninstall = sdk.messageUpdateManager.enable({ onError: showSyncError })
```

以上仅展示返回类型；实际字段必须来自后端响应，不能硬编码版本、epoch 或游标。
`messageFromHTTP` 和 `conversationFromHTTP` 可复用于自定义转换。

`Message.contentVersion` 是正文版本字符串，与旧 `remoteExtra.extraVersion` 无关。
新编辑模式展示 `message.content`，不再让旧 `remoteExtra.contentEdit` 覆盖它。
通过 SENDACK 填充本地消息时，沿用现有 SDK 类型：
`message.messageID = ack.messageID.toString()`，不要把 BigNumber 对象或舍入后的 Number
作为 Message 的 ID。

## SDK 自动处理的行为

- 每次认证连接后用 EVENT 协商 `message_updates.enable` / `message_updates.ready`。
  `message_updated` 只触发补拉，提示中的版本不直接写入缓存。
- 当前频道首次历史读取前取得基线，再一起提交历史和游标，随后补拉并发编辑。
  `more=true` 的空页仍继续处理；失败不会推进游标。
- 同一频道历史读取与编辑补拉串行执行；重复提示合并，每个同步波次最多处理 20 页后让出执行。
  只有当前频道主动同步；不对 1000 个非当前频道分别发起编辑请求。
- 同代次只保留较新正文；更高 epoch 使旧缓存和游标失效，更低 epoch 的迟到响应被丢弃。
  换账号、离开频道和断开连接会阻止旧请求提交。
- 编辑只替换匹配消息的正文。预览必须仍指向该消息才更新；不会走普通新消息通知，
  不增加未读、不改变原始发送时间和会话顺序。
- 网络错误和 503 最多重试两次，带指数退避和抖动。编辑重试保留完全相同的请求 ID、
  正文、预期版本和 epoch。首次确认成功后才替换正文。

首次编辑 WebSocket 消息可能需要一次精确范围的历史读取，以获得可信版本。
如果读取结果已经不同于用户看到的正文，SDK 返回冲突，保留用户的编辑决定，
不会基于别人刚修改的版本自动覆盖。

## 页面与错误处理

遇到 `version_conflict`、`content_epoch_conflict`，展示最新内容并保留草稿，
由用户再次决定是否提交。不要无条件循环调用 `updateMessage()`。
出现 `outcome_unknown` 时，需要先用同一份草稿重试之前的操作；SDK 最多保留
32 个结果未知的编辑请求，避免无限积累正文。

恢复或可见范围改变时，已有缓存消息会以 `contentStale=true` 通知页面。
此时显示加载占位而不是确认它仍有效；SDK 会重新读取当前历史范围。
其它旧页在再次展示时必须通过 `syncMessages()` 重新读取。
仅收到一页中没有某条消息，不能推断它已删除。

默认只保留内存状态，最多 1000 条历史消息、约 8 MiB 的估算缓存正文及记录开销，
可用 `maxCachedMessages` / `maxCachedBytes` 调整。会话管理器、HTTP 在途响应和 UI
自己保存的数据不属于这个预算。退出页面或缓存淘汰后的旧页，需要重新查询。
游标追平不代表所有历史页都已校准。

此版本不提供持久化游标或 IndexedDB 适配器。不要自行只把游标保存到 localStorage；
未来持久化接入必须保证消息与游标在同一事务中提交。

当前验证覆盖 Node.js 22 和 Chromium；宿主需支持 `AbortController` / `AbortSignal`，
其它浏览器和 UniApp 尚未完成兼容性联调。服务端提示采用后台任务发现机制，本次
真实联调观察到秒级提示等待；SDK 的 100 ms 合并窗口不是端到端时延保证。
提示到达、重连或回到前台会触发修复，SDK 不通过周期轮询保证固定时限内刷新。

## 运行示例与验证

参见 [独立浏览器示例](../examples/message-editing/README.md)。
本次测试范围和剩余性能边界见 [验证记录](message-editing-validation.md)。

```bash
npm ci --ignore-scripts
npm run typecheck
npm run lint
npm test

# 真实单节点集群、256 个 Hash Slot、两个隔离 SDK 运行实例。
WK_EDIT_SERVER_BIN=/absolute/path/to/wukongim npm run test:integration

# 可选：同时用本机已安装的 Playwright 验证两个 Chromium 页面。
WK_EDIT_SERVER_BIN=/absolute/path/to/wukongim \
WK_EDIT_PLAYWRIGHT=/absolute/path/to/node_modules/@playwright/test \
npm run test:integration
```

测试不购买云资源，也不连接生产集群。它启动自己的服务端和环回 BFF，结束后停止进程，
在输出的临时目录保留日志。浏览器测试依赖已安装的 Chromium。
