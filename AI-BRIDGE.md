# 本机 AI Bridge · 协议与使用

> [English](./AI-BRIDGE.en.md) | 中文

这个功能让外部 AI 程序代打**本机玩家**，但只拿得到该玩家自己的视角。

    网页（本机浏览器）
       ↕ 127.0.0.1:3210/control
    本机 Bridge 终端
       ↕ 127.0.0.1:3211–3218
    外部 AI 程序

主机只接收网页最终提交的正常 `action`，不知道 Bridge 的存在。

## 1. 启动

### 第一次

在本机运行：

    install-ai-bridge.bat

它会为当前 Windows 用户注册：

    dfbridge://

之后不需要再找文件夹双击。

### 房间内

1. 打开“辅助设置”；
2. 勾选“启用外部 AI 通道”；
3. 选择模式：
   - 手动确认 AI 提议；
   - AI 直接提交；
4. 回到房间，在对应座位的型号/简介下面点 `Bridge` 或 `AI Bridge`；
5. 同一个按钮会变成“关闭 Bridge”，再点直接关闭。

- 本机玩家自己的卡片显示自己的 Bridge；
- 房主添加的每个 AI 座位显示 `AI Bridge`，可以让外部模型接管该 AI；
- 局域网普通玩家只看到自己座位的按钮，不显示房主的 AI 按钮；
- 关闭 Bridge 后，AI 下回合恢复内置模型。

- 房主：服务端直接在本机启动 Bridge；
- 客机：浏览器打开 `dfbridge://`，由本机 Windows 启动 Bridge；
- Bridge 终端标题/日志会显示房间和玩家名。

也可以手动运行：

    start-ai-bridge.bat

## 2. 端口

    3210  网页 ↔ Bridge 控制口
    3211  外部 AI 通道 1
    3212  外部 AI 通道 2
    ...
    3218  外部 AI 通道 8

- 全部绑定 `127.0.0.1`；
- 不出局域网；
- 每个玩家一台机器一个 Bridge；
- 每条通道只接受一个外部 AI 连接；
- 最后一个合法 action 生效；人类可以覆盖。

## 3. 外部 AI 握手

连接到任意外部端口后，Bridge 发送：

    {
      "v": 1,
      "type": "hello",
      "protocol": 1,
      "channel": 1,
      "port": 3211,
      "room": "ABCD",
      "player": "玩家名",
      "controlPort": 3210,
      "modelPorts": [3211, 3212, 3213, 3214, 3215, 3216, 3217, 3218]
    }

### 连接确认

Bridge 会在结算界面每秒发送一次：

    { "v": 1, "type": "round_check", "nonce": 12 }

AI 必须回复：

    { "v": 1, "type": "round_ack", "nonce": 12 }

只有已 ack 的通道才会收到 `snapshot`。

下一回合开始前会再确认一次；失败则本回合回退手动。

## 4. Snapshot

收到：

    {
      "v": 1,
      "type": "snapshot",
      "snapshot": {
        "schema": 1,
        "round": 3,
        "phase": "selecting",
        "S": 13,
        "P": 5,
        "segments": [
          { "index": 0, "terrain": "pillar", "bomb": false }
        ],
        "bomb": { "targets": [4], "targetRound": 6, "mode": "fast" },
        "players": [
          { "id": 0, "name": "你", "alive": true, "isAI": false }
        ],
        "you": {
          "id": 0,
          "name": "你",
          "alive": true,
          "position": 2,
          "terrain": "pillar"
        },
        "legal": {
          "canHide": true,
          "canHideEffective": true,
          "observe": { "max": 6, "full": false },
          "moves": []
        },
        "corpses": [],
        "observations": [],
        "log": [],
        "privateLog": [],
        "lastResult": null
      }
    }

约束：

- `players` 不含其他人的位置；
- 其他玩家坐标只在 `spectator` 时才会出现（本机玩家已出局）；
- 地图、轰炸、自己的私密日志、公开日志都包含；
- `legal` 是服务端当前合法行动。

## 5. 提交 action

    {
      "v": 1,
      "type": "action",
      "requestId": "my-ai-1",
      "action": { "type": "hide" }
    }

支持的 action：

    { "type": "hide" }
    { "type": "observe", "dir": 1, "length": 3 }
    { "type": "attack", "target": 4, "dir": -1 }
    { "type": "slip", "dir": 1, "distance": 1 }

Bridge 只转发给网页；网页/服务端用正常规则校验。

## 6. 手动 / 自动

### 手动

AI 的 action 会显示为：

    AI 1 号通道提议：攻 4 段
    [同意] [修改] [忽略]

- 同意：以人类身份提交；
- 修改：打开正常操作面板，预填 AI 行动；
- 忽略：丢弃；
- 超时：按【藏】。

### 自动

- AI 合法 action 直接提交；
- 服务端保留 **1.5 秒人类覆盖窗**；
- 玩家可在这 1.5 秒内改动作或取消；
- 1.5 秒后按 AI 动作结算；
- 人类总能覆盖 AI。

## 7. 示例客户端（Node.js）

    import WebSocket from 'ws';

    const ws = new WebSocket('ws://127.0.0.1:3211');
    let nonce = null;

    ws.on('open', () => {
      // Bridge 会先发 hello；不需要客户端先发认证。
    });

    ws.on('message', (raw) => {
      const msg = JSON.parse(String(raw));

      if (msg.type === 'round_check') {
        nonce = msg.nonce;
        ws.send(JSON.stringify({ type: 'round_ack', nonce }));
      }

      if (msg.type === 'snapshot') {
        const s = msg.snapshot;
        if (s.phase !== 'selecting') return;

        // 简单示例：能藏就藏，否则观察。
        const action = s.legal.canHideEffective
          ? { type: 'hide' }
          : { type: 'observe', dir: 1, length: s.legal.observe.max };

        ws.send(JSON.stringify({
          type: 'action',
          requestId: `ai-${s.round}`,
          action,
        }));
      }
    });

## 8. 安全边界

- Bridge 只监听 `127.0.0.1`；
- 不出局域网；
- 网页只把本机玩家的 view 转给 Bridge；
- 主机不接触 Bridge；
- 如果同一台机器跑两个浏览器/两个 Bridge，技术上可能绕过“一人一机”规则；这属于本机作弊，按局域网熟人规则处理。

## 9. 排查

- 状态：未连接本机 Bridge；检查：是否运行了 `start-ai-bridge.bat` / `install-ai-bridge.bat`
- 状态：已连接但没有通道；检查：外部 AI 是否连到 3211–3218
- 状态：通道不 ready；检查：是否回复 `round_ack`
- 状态：收不到 snapshot；检查：是否在结算界面 ack，并在下一回合开始前保持连接
- 状态：action 被拒绝；检查：服务端规则校验失败；看网页提示
- 状态：Bridge 窗口闪退；检查：端口 3210–3218 是否被占用

## 10. 结果查看时间

- 结算界面至少 **5 秒**后才能点“继续下一回合”；
- 最多 **20 秒**自动进入下一回合；
- 所有存活人类都准备后立即进入下一回合；
- Bridge 的连接检查借用这段时间，不额外拖慢。
