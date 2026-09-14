# 双客户端消息编辑示例

此示例独立于旧 Vue 示例。它直接加载本工作区构建的 SDK，不使用 npm 已发布版本。
需要 Node.js 22，以及已包含 WuKongIM PR #959 和配套设备身份路由修复
`c1db384a8`（`codex/message-update-hint-route` 分支）的单节点集群或多节点集群。

在仓库根目录运行：

```bash
npm ci --ignore-scripts
npm run build
WK_EDIT_PRODUCT_URL=http://127.0.0.1:5001 \
WK_EDIT_USERS='{"alice":"alice-demo-credential","bob":"bob-demo-credential"}' \
node examples/message-editing/server.cjs
```

1. 打开两个浏览器窗口访问 `http://127.0.0.1:5178`。
2. 分别用 Alice、Bob 的上述用户名和示例凭据连接。
3. 各自填入对方用户名并打开会话；首次没有历史记录时可直接发送第一条消息，再刷新历史。
4. Alice 发送文本，点击“编辑”；观察两端正文和 Bob 的会话预览。
5. 断开 Bob 的网络，Alice 再次编辑；Bob 恢复连接后应看到最新正文。

BFF 只监听 `127.0.0.1`，仅允许配置的用户彼此单聊。它从 Bearer 凭据确定 UID，
读取目标消息检查作者和十分钟编辑窗口，并透传 epoch 与错误码。
此凭据字典和 `/session` 的 Token 注册仅用于受控开发演示，业务项目应接入现有登录与权限体系。
浏览器不会持有 Product HTTP 管理地址，也不能请求任意管理路径。

示例的主要接入点在 `index.html`：`installMessageEditing()`、原有 `openConversation` / 历史查询、
`addMessageUpdateListener()` 和 `updateMessage()`。发送回执的 BigNumber ID 转成十进制字符串。
为了突出消息更新流程，编辑 UI 使用浏览器输入框；正文用 `textContent` 展示。

完整协议和自定义 Provider 接法见 [消息编辑接入](../../docs/message-editing.md)。
