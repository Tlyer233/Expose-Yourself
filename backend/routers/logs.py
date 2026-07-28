"""
日志路由
提供日志日期扫描 + tail 读取 API
对应 0_control_center backend/routes/daemon_manager.py 的 log_dates + logs 端点
"""

import glob  # 文件通配符扫描
import os  # 路径拼接
import re  # 日期文件名校验
import shlex  # 路径防注入
import subprocess  # grep / tail / wc 命令
import sys  # 模块路径

# 确保 backend/ 目录在 Python 搜索路径中（和 daemon.py 一致的导入手势）
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi import APIRouter, HTTPException, Query  # 路由 + 异常 + 查询参数
from utils.common import find_manifest  # 统一 manifest 查找（daemon/logs/skills 共用）

router = APIRouter(prefix="/api", tags=["logs"])  # 所有路由自动加 /api 前缀

# ── tail 日志读取（Unix grep + tail 管道，不在 Python 侧做正则/循环）──


def _read_tail(log_path: str, levels: list[str] | None = None, lines: int = 100) -> dict:
    """
    用 grep 过滤全文件 → tail 截尾：精确取「最后 N 条匹配行」
    @param log_path 日志文件绝对路径
    @param levels 等级列表，如 ["ERROR","WARNING"]；None=不过滤
    @param lines 返回行数上限（安全上限 500）
    @returns {"lines": [...], "total_lines": int}
    """
    lines = min(lines, 500)  # 安全上限
    if not os.path.exists(log_path) or os.path.getsize(log_path) == 0:
        return {"lines": [], "total_lines": 0}  # 兜底

    # ── 总行数 ──
    total = int(subprocess.run(  # wc -l
        ['wc', '-l', log_path], capture_output=True, text=True, timeout=10).stdout.strip().split()[0])

    # ── 出内容 ──
    if levels:  # grep 全文件 → tail 截尾（44万行瞬时）
        pattern = '|'.join(levels)  # 如 ERROR|WARNING
        cmd = f"grep -E '\\| ({pattern})\\s' {shlex.quote(log_path)} | tail -n {lines}"
        out = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=30).stdout
    else:  # 无过滤直接 tail
        out = subprocess.run(['tail', '-n', str(lines), log_path], capture_output=True, text=True, timeout=10).stdout

    return {"lines": [l for l in out.strip().split('\n') if l], "total_lines": total}  # 去空行


# ── 辅助函数 ──────────────────────────────────────────


def _log_path(name: str, date: str) -> str:
    """
    根据插件名和日期，从 manifest 拼出日志文件绝对路径
    @param name 插件名（如 1_chat_monitor）
    @param date 日期字符串（YYYY-MM-DD）
    @returns 日志文件绝对路径
    """
    m = find_manifest(name)  # 查 manifest
    if not m:
        raise HTTPException(status_code=404, detail="daemon not found")  # 插件不存在

    log_dir = m.get('logs', {}).get('dir', 'log')  # 取 logs.dir，默认 "log"
    plugin_dir = m['_dir']  # 插件根目录
    return os.path.join(plugin_dir, log_dir, f"{date}.log")  # 拼完整路径


# ── API 路由 ──────────────────────────────────────────


@router.get("/daemon/{name}/log_dates")
async def daemon_log_dates(name: str):
    """
    返回指定 daemon 的可用日志日期列表（降序）
    @param name 插件名（如 1_chat_monitor）
    @returns {"dates": ["2026-07-27", "2026-07-26", ...]}
    @api GET /api/daemon/{name}/log_dates
    """
    m = find_manifest(name)  # 查 manifest
    if not m:
        raise HTTPException(status_code=404, detail="daemon not found")  # 404

    log_dir = os.path.join(m['_dir'], m.get('logs', {}).get('dir', 'log'))  # 日志目录
    files = glob.glob(os.path.join(log_dir, "*.log"))  # 扫描 *.log
    dates = []
    for f in files:
        fname = os.path.basename(f).replace(".log", "")  # 去掉 .log 后缀
        if re.match(r'^\d{4}-\d{2}-\d{2}$', fname):  # 必须 YYYY-MM-DD 格式
            dates.append(fname)  # 加入结果

    dates.sort(reverse=True)  # 降序（最新在前）
    return {"dates": dates}  # 返回 JSON


@router.get("/daemon/{name}/logs")
async def daemon_logs(
        name: str,
        date: str = Query(..., description="日期，格式 YYYY-MM-DD"),  # 必填
        levels: str | None = Query(None, description="逗号分隔的等级，如 ERROR,WARNING"),  # 可选
        lines: int = Query(100, ge=1, le=500, description="返回行数，1-500"),  # 默认 100
):
    """
    返回指定 daemon 指定日期的 tail 日志（最后 N 行）
    grep 过滤全文件 → tail 截尾 → 保证「最后 N 条匹配行」精确
    @param name 插件名（如 1_chat_monitor）
    @param date 日期（YYYY-MM-DD）
    @param levels 逗号分隔的等级，空=全选
    @param lines 返回行数（1-500，默认 100）
    @returns {"lines": [...], "total_lines": N, "log_path": "..."}
    @api GET /api/daemon/{name}/logs
    """
    # ── 拼日志路径 ──
    log_path = _log_path(name, date)  # 调辅助函数

    # ── 解析 levels 参数 ──
    level_list = None  # None = 不过滤
    if levels:
        level_list = [lvl.strip() for lvl in levels.split(',') if lvl.strip()]  # 逗号分割去空白

    # ── tail 读取 ──
    result = _read_tail(log_path, levels=level_list, lines=lines)  # grep+tail 管道

    # ── 附加 log_path ──
    result["log_path"] = log_path
    return result  # 返回 JSON
