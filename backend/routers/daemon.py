"""
daemon 管理路由
提供 daemon 的发现/列表/状态/启停/安装等通用 API
对应 SpringBoot 的 @RestController + @RequestMapping("/api")
"""
import json  # 读取 manifest.json
import os  # 路径操作
import sys  # sys.path（确保 backend/ 可 import）

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))  # backend/ 加到 path

from fastapi import APIRouter, HTTPException  # 路由分组 + HTTP 异常
from executor import run_command  # shell 命令执行器
from utils.common import find_manifest  # 统一 manifest 查找（daemon/logs/skills 共用）

router = APIRouter(prefix="/api", tags=["daemon"])  # 所有路由自动加 /api 前缀

# ─── 辅助函数 ──────────────────────────────────────────


def _load_manifests() -> list[dict]:
    """
    从 config.yaml 的 plugin_paths 列表加载所有已注册插件的 manifest.json
    @returns manifest 列表（含 _dir 字段记录插件目录）
    """
    from config import PLUGIN_PATHS  # 延迟导入避免循环依赖

    manifests = []  # 收集结果
    for plugin_dir in PLUGIN_PATHS:  # 遍历已注册的插件目录
        manifest_path = os.path.join(plugin_dir, 'manifest.json')  # 拼 manifest 路径
        if not os.path.isfile(manifest_path):  # manifest 不存在
            continue  # 跳过
        try:
            with open(manifest_path, 'r') as f:  # 读文件
                m = json.load(f)  # 解析 JSON
            m['_dir'] = plugin_dir  # 记录 daemon 目录
            manifests.append(m)  # 加入列表
        except Exception:  # JSON 格式错误
            pass  # 跳过损坏的 manifest
    return manifests  # 返回列表


# find_manifest 已移至 utils/common.py，daemon/logs/skills 统一从那里导入


def _expand_path(path: str, daemon_dir: str) -> str:
    """
    展开 manifest 中的路径变量
    ~/Library → /Users/xi/Library（expanduser）
    相对路径 → 拼到 daemon_dir 下
    绝对路径 → 原样返回
    被 _cmd_action、install、uninstall、status 等路由共同使用（5+处）
    @param path 原始路径值（manifest 中的 plist_src/plist_dest）
    @param daemon_dir 插件目录（manifest._dir）
    @returns 展开后的绝对路径
    """
    if path.startswith('~/'):  # 用户目录简写
        return os.path.expanduser(path)  # ~/Library → /Users/xi/Library
    if not path.startswith('/'):  # 相对路径
        return os.path.join(daemon_dir, path)  # 拼到插件目录下
    return path  # 已是绝对路径，原样返回


def _launchctl_domain(plist_dest: str) -> str:
    """
    根据 plist 安装路径判断 launchctl 域（domain）
    macOS 的 launchctl bootstrap/bootout 需要指定域：
      ~/Library/LaunchAgents/xxx → gui/$(id -u)  用户域（当前用户）
      /Library/LaunchDaemons/xxx → system         系统域（所有用户）
      其他路径                   → gui/$(id -u)  兜底为用户域
    @param plist_dest 展开后的 plist 目标绝对路径
    @returns launchctl domain 字符串
    """
    if '/Library/LaunchDaemons' in plist_dest:  # 系统级守护进程
        return 'system'  # system 域
    return 'gui/$(id -u)'  # 用户级（$(id -u) 由 shell 展开为当前用户 UID）


def _cmd_action(m: dict, action: str) -> str:
    """
    从 manifest 构建 start/stop/restart 的 shell 命令
    start  = 自动 cp plist 到标准目录 + bootstrap 启动
    stop   = bootout 停止 + rm 删除 plist（彻底移除）
    restart = 停（含 rm）+ 启（cp + bootstrap）
    @param m manifest（含 _dir 和 daemon 字段）
    @param action "start" | "stop" | "restart"
    @returns shell 命令字符串
    """
    src = _expand_path(m['daemon']['plist_src'], m['_dir'])  # plist 源文件（插件目录下）
    dest = _expand_path(m['daemon']['plist_dest'], m['_dir'])  # plist 目标位置（标准目录）
    domain = _launchctl_domain(dest)  # 判断 gui/UID 还是 system
    if action == 'start':  # 启动 → plist 不存在则 cp，然后 bootstrap 注册并启动
        return f"[ -f {dest} ] || cp {src} {dest}; launchctl bootstrap {domain} {dest}"
    if action == 'stop':  # 停止 → bootout 注销 + rm 删除 plist（彻底移除）
        return f"[ -f {dest} ] && {{ launchctl bootout {domain} {dest}; rm -f {dest}; }} || true"
    if action == 'restart':  # 重启 → 先彻底停（bootout+rm），再启（cp+bootstrap）
        return f"[ -f {dest} ] && launchctl bootout {domain} {dest} 2>/dev/null; rm -f {dest}; cp {src} {dest}; launchctl bootstrap {domain} {dest}"
    return ""


# ─── API 路由 ──────────────────────────────────────────


@router.get("/manifests")
async def list_manifests():
    """
    返回所有已注册插件的 manifest 列表
    控制中心前端启动时调用一次获取侧栏菜单
    @returns JSON 数组 [{name, displayName, icon, route, ...}]
    @api GET /api/manifests
    """
    manifests = _load_manifests()  # 扫描所有
    # 过滤掉内部字段 _dir（前端不需要知道磁盘路径）
    return [{k: v for k, v in m.items() if k != '_dir'} for m in manifests]  # 返回清洗后的列表


# ─── Daemon 管理 API ────────────────────────────────────


@router.get("/daemon/{name}/status")
async def daemon_status(name: str):
    """
    查询 daemon 运行状态 + 开机自启安装状态
    @param name 插件名（如 1_chat_monitor ）
    @returns { service, status:"running"|"stopped", installed:bool, output }
    @api GET /api/daemon/{name}/status
    """
    m = find_manifest(name)  # 查 manifest
    if not m:
        raise HTTPException(status_code=404, detail="daemon not found")  # 404
    sn = m['daemon']['service_name']  # launchctl Label
    needs_sudo = m['daemon'].get('sudo', False)  # 是否需要 sudo
    result = run_command(f"launchctl list {sn}", sudo=needs_sudo)  # 执行 launchctl list
    # 双重判断: returncode==0 且 stdout 中包含 service_name
    running = result["success"] and sn in result["stdout"]
    # 检查 plist 是否已安装（文件是否存在）
    dest = _expand_path(m['daemon']['plist_dest'], m['_dir'])  # plist 目标路径
    installed = os.path.exists(dest)  # 文件存在 = 已安装（开机自启）
    return {
        "service": name,
        "status": "running" if running else "stopped",  # 运行状态
        "installed": installed,  # 是否开机自启
        "output": result["stdout"] or result["stderr"],  # 原始输出（调试用）
    }


@router.get("/daemon/{name}/start")
async def daemon_start(name: str):
    """
    启动 daemon（launchctl load）
    @param name 插件名
    @returns { action:"start", success, output }
    @api GET /api/daemon/{name}/start
    """
    m = find_manifest(name)  # 查 manifest
    if not m:
        raise HTTPException(status_code=404, detail="daemon not found")  # 404
    cmd = _cmd_action(m, 'start')  # 构建 launchctl load 命令
    needs_sudo = m['daemon'].get('sudo', False)  # 是否需要 sudo
    result = run_command(cmd, sudo=needs_sudo)  # 执行
    return {"action": "start", "success": result["success"], "output": result["stdout"] or result["stderr"]}


@router.get("/daemon/{name}/stop")
async def daemon_stop(name: str):
    """
    停止 daemon（launchctl unload）
    @param name 插件名
    @returns { action:"stop", success, output }
    @api GET /api/daemon/{name}/stop
    """
    m = find_manifest(name)  # 查 manifest
    if not m:
        raise HTTPException(status_code=404, detail="daemon not found")  # 404
    cmd = _cmd_action(m, 'stop')  # 构建 launchctl unload 命令
    needs_sudo = m['daemon'].get('sudo', False)  # 是否需要 sudo
    result = run_command(cmd, sudo=needs_sudo)  # 执行
    return {"action": "stop", "success": result["success"], "output": result["stdout"] or result["stderr"]}


@router.get("/daemon/{name}/restart")
async def daemon_restart(name: str):
    """
    重启 daemon（launchctl unload && launchctl load）
    @param name 插件名
    @returns { action:"restart", success, output }
    @api GET /api/daemon/{name}/restart
    """
    m = find_manifest(name)  # 查 manifest
    if not m:
        raise HTTPException(status_code=404, detail="daemon not found")  # 404
    cmd = _cmd_action(m, 'restart')  # 构建 unload && load 命令
    needs_sudo = m['daemon'].get('sudo', False)  # 是否需要 sudo
    result = run_command(cmd, sudo=needs_sudo)  # 执行
    return {"action": "restart", "success": result["success"], "output": result["stdout"] or result["stderr"]}
