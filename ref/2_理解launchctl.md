
## daemon.py 和 plist 的关系

daemon.py 不直接跑 plist 也不直接跑 sh。它通过 `launchctl` 命令把 plist 注册给 macOS 的 `launchd`（PID=1 系统进程管理器），由 launchd 负责拉起和管理进程。

```
壳子 daemon.py
  │
  ├─ start: 生成 plist（新格式） → 写入 /Library/LaunchDaemons/ 或 ~/Library/LaunchAgents/
  │         launchctl bootstrap <domain> <plist>     ← 告诉 launchd "请管理这个服务"
  │
  └─ launchd (macOS PID=1, 独立进程)
       │
       └─ 读取 plist → 按 ProgramArguments 执行 python3 main.py
```

---

## 两种 plist 类型

| 属性 | sudo=true | sudo=false |
|------|-----------|------------|
| **安装路径** | `/Library/LaunchDaemons/com.expy.{name}.plist` | `~/Library/LaunchAgents/com.expy.{name}.plist` |
| **运行身份** | root | 当前用户 |
| **启动时机** | 系统启动（boot 时） | 用户登录（login 时） |
| **launchctl domain** | `system` | `gui/$(id -u)` |
| **查看方式** | `sudo launchctl list \| grep com.expy.` | `launchctl list \| grep com.expy.` |
| **Login Items 可见?** | ❌ 不可见（root 守护进程） | ✅ 可见（"Allow in the Background"） |
| **删除 plist** | 需要 sudo | 不需要 sudo |
| **适用场景** | eslogger、系统级监控等需要 root 权限的 | 用户级服务（聊天监控、历史记录等） |

---

## 如何找到某个 plist 文件

launchctl 不直接显示 plist 路径，但根据我们的命名约定可以推导：

```bash
# 1. 查服务 Label
sudo launchctl list | grep 'com.expy.'

# 2. 根据 Label 推导 plist 路径
#    sudo=true  → cat /Library/LaunchDaemons/com.expy.{name}.plist
#    sudo=false → cat ~/Library/LaunchAgents/com.expy.{name}.plist
```

---

## 如何正确删除（bootout → rm）

**正确顺序**（daemon.py stop 做的事）：

```bash
# 1. 先卸载运行中的服务（kill 进程）
sudo launchctl bootout system /Library/LaunchDaemons/com.expy.xxx.plist

# 2. 再删除磁盘上的 plist 文件
sudo rm -f /Library/LaunchDaemons/com.expy.xxx.plist
```

**为什么不能只 rm**：
- `rm` 只删磁盘文件，已运行的进程不受影响
- launchd 不知道文件被删，进程继续跑
- 下次重启时找不到 plist 不会重新拉起，但当前进程残留

**为什么不能只 bootout**：
- bootout 只停止进程，plist 文件还在磁盘
- 下次重启 launchd 会重新读取 plist 并拉起进程（因为 `RunAtLoad=true`）
- 必须 rm 才能彻底移除

---

## 新格式 plist 字段速查

```xml
<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
<dict>
    <key>Label</key>              <string>com.expy.插件名</string>   <!-- 壳子自动生成 -->
    <key>ProgramArguments</key>   <array>                             <!-- 壳子自动拼 -->
        <string>/path/to/ExposeYourself/shell/expy-插件名.sh</string>  <!-- 壳子自动生成的启动脚本 -->
    </array>
    <key>WorkingDirectory</key>   <string>/path/to/plugin</string>   <!-- 插件根目录 -->
    <key>RunAtLoad</key>          <true/>                             <!-- 固定 -->
    <key>KeepAlive</key>          <true/>                             <!-- 固定 -->
    <key>StandardOutPath</key>    <string>/tmp/com.expy.插件名_stdout.log</string>
    <key>StandardErrorPath</key>  <string>/tmp/com.expy.插件名_stderr.log</string>
    <!-- sudo=true 时额外字段 -->
    <key>UserName</key>           <string>root</string>
    <key>LimitLoadToSessionType</key> <string>System</string>
    <key>EnvironmentVariables</key>   <dict><key>HOME</key><string>/Users/xxx</string></dict>
</dict>
</plist>
```

### Shell 脚本生命周期

- **START**：生成 `shell/expy-{name}.sh` → 写 plist → `launchctl bootstrap`
- **STOP**：`launchctl bootout` → `rm plist` → `rm shell/expy-{name}.sh`

---

## Login Items 显示名原理

macOS Ventura+ 的「系统设置 → 登录项 → 允许在后台」列表中，显示名 = **`basename(ProgramArguments[0])`**。

| ProgramArguments[0] | Login Items 显示名 | 来源 |
|---|---|---|
| `/opt/homebrew/bin/python3` | **python3** | 所有插件同名，无法区分 |
| `shell/expy-1_chat_monitor.sh` | **expy-1_chat_monitor.sh** | 可区分 |
| `/bin/zsh` | **zsh** | 被其他 job 合并，看不到 |

> 参考：[macOS の Background Items 表示名は plist の ProgramArguments で決まる](https://rengotaku.github.io/2026/05/20/launchd-background-items-display-name/)（2026-05-20）
>
> 結論：`Label` は内部 ID。UI の表示名は **ProgramArguments[0]**
> - インタプリタ (`/bin/zsh`, `/usr/bin/python3` 等) を先頭に置くな
> - shebang を活用してスクリプトを直接実行ファイル化し、そのパスを `ProgramArguments[0]` に指定する

**因此**：必须用 shell 脚本包装，将脚本路径作为 `ProgramArguments[0]` 才能让 Login Items 显示可区分的名字。

---

## "项目来自身份不明的开发者" 警告

**无法消除**（除非 $99/年 Apple Developer Program 签名）。

原因：macOS 13+ 通过 code signature 追踪 "responsible code"。shell 脚本无签名 → `AssociatedBundleIdentifiers` 对其无效 → 系统标记为 "unidentified developer"。

已尝试的方案：
- `AssociatedBundleIdentifiers` → 无效（bash 无 Team Identifier）
- symlink 指向已签名 python3 → 签名跟随但 basename 仍为 symlink 名，警告依然存在
- 直接 `ProgramArguments=[python3, main.py]` → 无警告但显示名全是 "python3"

最终选择：shell 脚本方案（显示名可区分） + 接受 "unidentified developer" 警告（纯外观不影响功能）。

> Apple DTS 确认：["I have tried setting AssociateBundleIdentifiers in my plist file but the console tells me it is being ignored because bash does not have a Team Identifier."](https://developer.apple.com/forums/thread/755904)（2024-05）

---

## manifest.json daemon 字段（新格式）

```json
"daemon": {
    "sudo": true,           // true → LaunchDaemon (root), false → LaunchAgent (user)
    "entry": "main.py",     // 入口文件，默认 main.py
    "args": [],             // 可选，额外参数
    "env": {}               // 可选，环境变量（sudo 时自动补 HOME）
}
```

不需要写 `service_name`、`plist_src`、`plist_dest`——壳子全部自动推导。
