# ChatGPT 套餐授权与免费报告备用（0.5.0）

PaperDesk 0.5.0 改用 OpenAI 官方开源本地应用 Sign in with ChatGPT（SIWC）授权。运行时不再启动或打包 Codex，也不读取浏览器Cookie。普通ChatGPT网页已登录不代表已授权PaperDesk。

## 连接并验证

1. 打开文献概览 / 读书报告，展开“报告渠道与账户设置”。
2. 点击 **Continue with ChatGPT**。PaperDesk先启动本机127.0.0.1回调，再打开你的默认浏览器。
3. 使用自己的ChatGPT账户登录，核对应用名称PaperDesk和套餐使用权限，再授权。账户资格、地区、手机号验证由OpenAI决定，PaperDesk无法取消要求。
4. 返回工作站，状态应显示“已授权 · 推理待测试”。点击“读取账户可用模型”，选择该账户实际可用的模型。
5. 点击“测试实际推理”。只有收到完整成功响应后才显示“授权及推理均已验证”。测试会消耗少量套餐额度；成功后即可主动生成报告。

可分别保存多个账户/工作区；返回登录复用已注册客户端与本机host ID。退出会尝试撤销远程会话，并清除本地令牌；网络失败时会提示远程撤销尚未确认。令牌通过Windows系统安全存储加密保存，不进入浏览器缓存、日志或仓库。

请求使用官方 `https://api.openai.com/v1/models` 和 `responses`，设置 `store:false`、`stream:true`。只有收到 `response.completed` 才保存为成功结果。没有API密钥或静默切换计费API的流程；套餐额度、应用使用上限和是否允许使用额外信用，由你在[ChatGPT设置](https://chatgpt.com/settings/usage)管理。应用无法替账户取消服务端验证或无限扩充额度。

## OpenRouter免费报告

1. 在[OpenRouter](https://openrouter.ai/keys)创建自己的密钥，无需发给开发者；不充值、不启用自动充值。
2. 在工作站的免费模型设置中保存密钥；选择免费自动路由或刷新当前免费模型。
3. 选择“OpenRouter免费模型”生成报告。仅允许 `openrouter/free` 或API当前标价为零的 `:free` 模型，同时发送零价格限制并关闭供应商收费回退。
4. 如希望ChatGPT失败后自动使用免费模型，可单独勾选备用开关。默认关闭。启用意味着允许向该渠道发送论文提取文字。

免费额度、模型上下线和限速以服务账户实际情况为准。长论文可能超出模型上下文；失败时保留已有报告，不截断后声称已读完，不自动换付费模型。OpenRouter生成内容会明确标注“免费模型报告”，不会显示为ChatGPT已连接。

## 本地报告与手动网页

无需连接任何账户，也可以手工填写梗概和七部分报告；支持逐部分修改标题、内容，以及增删部分。已保存报告直接从本地SQLite读取，阅读、编辑、历史恢复不请求AI。

每次修改或再次生成均保留历史版本。草稿保存在本机；多窗口修改冲突时拒绝覆盖。生成结果在写入笔记之前另存恢复副本，冲突后可从“生成恢复副本”载入草稿。报告编辑保存后同步文库AI概览；“我的文献概览”属于独立的个人整理，不被AI重新生成覆盖。

手动网页复制提问材料只在该区域显示复制状态，不代表已生成报告。打开网页不会自动上传文献。

## 验证边界

已测试OAuth回调、state/PKCE/nonce、ID令牌签名及身份绑定、账户模型目录和流式完整性。没有使用你的账户完成真人登录，也没有代替你申请或测试DeepL、百度、OpenRouter密钥。

官方资料：[快速开始](https://developers.openai.com/siwc/quickstart)、[开源应用授权](https://developers.openai.com/siwc/token-sharing-open-source)、[模型与推理](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)。
