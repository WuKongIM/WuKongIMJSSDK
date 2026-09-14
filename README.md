
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

## 发布

修改package.json里版本号

发布npm包

npm publish

## 引用

npm i wukongimjssdk



原生浏览器<script>的引入方式 使用lib/wukongimjssdk.umd.js 文件

原生引入需要加前缀例如：`wk.WKSDK.shared()`

## 消息编辑

支持新服务端的可选消息编辑接入：一处配置、一个编辑调用、一个更新监听。参见 [接入文档](docs/message-editing.md) 和 [双客户端浏览器示例](examples/message-editing/README.md)。此能力尚未发布到 npm。
