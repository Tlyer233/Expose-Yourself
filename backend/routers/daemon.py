"""
daemon 管理路由 v2 — 新旧 manifest 格式兼容
  旧格式: plist_src + plist_dest + service_name（显式声明）
  新格式: sudo + entry + args + env（壳子自动生成 plist，字符串模板输出 XML）
"""
import base64, json, os, sys  # base64 安全嵌入 shell / json 读 manifest / os 路径 / sys 模块路径

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))  # backend/ 加到 path

from fastapi import APIRouter, HTTPException  # 路由 + 异常
from executor import run_command  # shell 命令执行器
from utils.common import find_manifest, load_all_manifests  # 按 name 查 manifest + 加载全部

router = APIRouter(prefix="/api", tags=["daemon"])  # 所有路由 /api 前缀

# ─── 新格式 plist XML 模板（ProgramArguments 指向 shell 脚本，Login Items 显示脚本名）────
_PLIST_TPL = '''<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>{label}</string>
    <key>ProgramArguments</key>
    <array>
        <string>{shell}</string>
    </array>
    <key>WorkingDirectory</key>
    <string>{dir}</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/tmp/{label}_stdout.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/{label}_stderr.log</string>{sudo}{env}
</dict>
</plist>'''

# ─── 辅助函数 ──────────────────────────────────────────


def _expand_path(path: str, daemon_dir: str) -> str:
    """展开路径变量: ~/ → /Users/..., 相对 → 拼 daemon_dir, 绝对 → 原样"""
    return os.path.expanduser(path) if path.startswith('~/') else (  # ~/ 简写
        os.path.join(daemon_dir, path) if not path.startswith('/') else path)  # 相对拼根 / 绝对原样


def _resolve_plist_dest(m: dict) -> str:
    """获取 plist 安装绝对路径（旧格式取 manifest 字段，新格式根据 sudo 推导）"""
    d = m.get('daemon', {})  # daemon 配置块
    return _expand_path(d['plist_dest'], m['_dir']) if d.get('plist_dest') else (  # 旧格式显式声明
        f"/Library/LaunchDaemons/com.expy.{m['name']}.plist" if d.get('sudo')  # sudo → 系统级
        else os.path.expanduser(f"~/Library/LaunchAgents/com.expy.{m['name']}.plist"))  # 非 sudo → 用户级


def _cmd_action(m: dict, action: str) -> str:
    """从 manifest 构建 start/stop/restart 的 shell 命令字符串"""
    d, dest = m.get('daemon', {}), _resolve_plist_dest(m)  # daemon 配置块 + plist 目标路径
    old = bool(d.get('plist_dest') or d.get('service_name'))  # 有 plist_dest 或 service_name = 旧格式
    domain = 'system' if '/Library/LaunchDaemons' in dest else 'gui/$(id -u)'  # 系统域 / 用户域

    if action == 'stop':  # stop: bootout + rm plist + rm shell 脚本（新格式）
        # 新格式需删 shell 脚本，旧格式无 shell
        sh = os.path.join(__import__('config').SHELL_DIR, f"expy-{m['name']}.sh") if not old else '/dev/null'
        return f"[ -f {dest} ] && {{ launchctl bootout {domain} {dest}; rm -f {dest}; rm -f {sh}; }} || true"

    if old:  # 旧格式: cp 插件目录下的 plist 模板文件
        src = _expand_path(d['plist_src'], m['_dir'])  # plist 源文件绝对路径
        wcmd = {'start': f"[ -f {dest} ] || cp {src} {dest}", 'restart': f"cp {src} {dest}"}[action]
    else:  # 新格式: 生成 shell 脚本 → 生成 plist → base64 → 写入 → bootstrap
        from config import PYTHON_PATH, SHELL_DIR  # config.yaml 配置

        sudo, entry = d.get('sudo', False), d.get('entry', 'main.py')
        env = dict(d.get('env', {}))
        if sudo and 'HOME' not in env: env['HOME'] = os.path.expanduser('~')

        label = f"com.expy.{m['name']}"
        main_py = os.path.join(m['_dir'], entry)
        sh_path = os.path.join(SHELL_DIR, f"expy-{m['name']}.sh")  # Login Items 显示此名

        # ① 生成 shell 脚本: #!/bin/bash\nexec python3 main.py "$@"\n
        sh = f"#!/bin/bash\nexec {PYTHON_PATH} {main_py} \"$@\"\n"
        sh_b64 = base64.b64encode(sh.encode()).decode()

        # ② 生成 plist XML（ProgramArguments = [sh_path]）
        plist = _PLIST_TPL.format(
            label=label,
            shell=sh_path,
            dir=m['_dir'],
            sudo='\n    <key>UserName</key>\n    <string>root</string>\n    <key>LimitLoadToSessionType</key>\n    <string>System</string>' if sudo else '',
            env='\n    <key>EnvironmentVariables</key>\n    <dict>' + ''.join(f'\n        <key>{k}</key>\n        <string>{v}</string>' for k, v in env.items()) + '\n    </dict>' if env else '',
        )
        plist_b64 = base64.b64encode(plist.encode()).decode()

        # ③ 构建 shell 命令: 写脚本 + 写 plist + bootstrap
        write_sh = f"mkdir -p {SHELL_DIR}; echo '{sh_b64}' | base64 -d > {sh_path}; chmod +x {sh_path}"
        wcmd = {'start': f"{write_sh}; echo '{plist_b64}' | base64 -d > {dest}", 'restart': f"{write_sh}; echo '{plist_b64}' | base64 -d > {dest}"}[action]

    boot = f"[ -f {dest} ] && launchctl bootout {domain} {dest} 2>/dev/null; rm -f {dest}; " if action == 'restart' else ''
    return f"{boot}{wcmd}; launchctl bootstrap {domain} {dest}"


# ─── API 路由 ──────────────────────────────────────────


@router.get("/manifests")
async def list_manifests():
    return [{k: v for k, v in m.items() if k != '_dir'} for m in load_all_manifests()]


@router.get("/daemon/{name}/status")
async def daemon_status(name: str):
    m = find_manifest(name)
    if not m: raise HTTPException(404, detail="daemon not found")
    d = m.get('daemon', {})
    sn = d.get('service_name') or f"com.expy.{name}"
    result = run_command(f"launchctl list {sn}", sudo=d.get('sudo', False))
    return {"service": name, "status": "running" if result["success"] and sn in result["stdout"] else "stopped", "installed": os.path.exists(_resolve_plist_dest(m)), "output": result["stdout"] or result["stderr"]}


@router.get("/daemon/{name}/start")
async def daemon_start(name: str):
    m = find_manifest(name)
    if not m: raise HTTPException(404, detail="daemon not found")
    result = run_command(_cmd_action(m, 'start'), sudo=m['daemon'].get('sudo', False))
    return {"action": "start", "success": result["success"], "output": result["stdout"] or result["stderr"]}


@router.get("/daemon/{name}/stop")
async def daemon_stop(name: str):
    m = find_manifest(name)
    if not m: raise HTTPException(404, detail="daemon not found")
    result = run_command(_cmd_action(m, 'stop'), sudo=m['daemon'].get('sudo', False))
    return {"action": "stop", "success": result["success"], "output": result["stdout"] or result["stderr"]}


@router.get("/daemon/{name}/restart")
async def daemon_restart(name: str):
    m = find_manifest(name)
    if not m: raise HTTPException(404, detail="daemon not found")
    result = run_command(_cmd_action(m, 'restart'), sudo=m['daemon'].get('sudo', False))
    return {"action": "restart", "success": result["success"], "output": result["stdout"] or result["stderr"]}
