
## 文档

https://githubim.com/sdk/jssdk/intro.html


## npm 或yarn安装

```js
npm i wukongimjssdk
```
或者

```js
yarn add wukongimjssdk
```

## 在线体验

http://imdemo.githubim.com

## 构建

yarn build

## 开发检查

PR 更新和推送到 `main` 时，`SDK CI` 会在 Ubuntu / Node.js 22 上执行以下检查：

```bash
npm ci --ignore-scripts --no-audit --no-fund
npm run build
npm run typecheck
npm run lint
npm run test:unit
```

构建会先生成 `src/version.ts` 和测试使用的产物。`npm test` 仍会自动构建并运行单元测试；
`npm run test:unit` 用于已有构建产物的场景。真实服务端与浏览器联调继续通过
`npm run test:integration` 单独运行，环境要求见 [消息编辑接入文档](docs/message-editing.md#运行示例与验证)。

## 发布

修改package.json里版本号

发布npm包

npm publish

## 引用

npm i wukongimjssdk



原生浏览器<script>的引入方式 使用lib/wukongimjssdk.umd.js 文件

原生引入需要加前缀例如：`wk.WKSDK.shared()`

## 消息编辑

支持新服务端的可选消息编辑接入：一处配置、一个编辑调用、一个更新监听。参见 [接入文档](docs/message-editing.md) 和 [双客户端浏览器示例](examples/message-editing/README.md)。预发布版本安装：`npm install wukongimjssdk@1.4.0-beta.1`，配套服务端 `v3.0.0-beta.17`。
