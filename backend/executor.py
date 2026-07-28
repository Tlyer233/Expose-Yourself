"""
shell 命令执行器
提供统一的 shell 命令执行能力，支持 sudo、超时、工作目录指定
对应 SpringBoot 中 Runtime.getRuntime().exec() 的工具类封装

职责边界：
  executor.py — 只负责执行命令，判断 returncode==0 → success
  daemon.py  — 调用方根据业务需求额外解析 stdout/stderr
"""

import subprocess  # 执行 shell 命令（对应 Java 的 Runtime.exec 或 ProcessBuilder）
import os  # 环境变量
import sys  # sys.path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # 确保 backend/ 可 import

from config import SUDO_PASSWORD  # sudo 密码


def run_command(command: str, cwd: str | None = None, sudo: bool = False, timeout: int = 30) -> dict:
    """
    执行 shell 命令，返回执行结果
    @param command 要执行的命令字符串（如 "launchctl list run_chat"）
    @param cwd 工作目录，None 表示当前目录
    @param sudo 是否需要 sudo 权限，True 时自动拼接 echo <密码> | sudo -S <命令>
    @param timeout 超时秒数，超时直接 kill 返回错误信息
    @returns { success: bool, stdout: str, stderr: str, command: str }
              success=True 仅表示 returncode==0，不等于业务成功
    """
    try:
        # ── 环境变量：确保 PATH 包含常用二进制目录 ────────
        # launchctl、brew 等工具可能不在 Python 进程的默认 PATH 中
        env = os.environ.copy()  # 复制当前环境变量
        env["PATH"] = f"/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:{env.get('PATH', '')}"  # 前置常用路径

        # ── sudo 处理 ───────────────────────────────────
        if sudo:
            if not SUDO_PASSWORD: # 环境变量未设置
                return {
                    "success": False,
                    "stdout": "",
                    "stderr": "HERMES_SUDO_PASSWORD 未设置，请在 ~/.zshrc 中添加:\n  export HERMES_SUDO_PASSWORD=你的Mac登录密码\n然后执行 source ~/.zshrc",
                    "command": command,
                }
            # 转义命令中的单引号，防止破坏 sh -c 的引号结构
            # 例如: don't → don'\''t（结束当前串 → 转义的单引号 → 开始新串）
            safe_cmd = command.replace("'", "'\\''")  # 转义单引号
            # 用 sh -c 包裹整个命令，确保 ; && 等分隔的子命令都在 sudo 下执行
            # 错误写法: echo pwd | sudo -S cmd1; cmd2 ← cmd2 没有 sudo
            # 正确写法: echo pwd | sudo -S sh -c 'cmd1; cmd2' ← 全部有 sudo
            command = f"echo '{SUDO_PASSWORD}' | sudo -S sh -c '{safe_cmd}'"

        # ── 执行命令 ────────────────────────────────────
        result = subprocess.run(
            command,  # 命令字符串
            shell=True,  # 通过 shell 执行（支持管道、重定向等 shell 语法）
            cwd=cwd,  # 工作目录（None = 当前 Python 进程目录）
            capture_output=True,  # 捕获 stdout 和 stderr（不在终端显示）
            text=True,  # 输出解码为 str 而非 bytes
            timeout=timeout,  # 超时秒数
            env=env,  # 传入定制的环境变量
        )

        # ── 判断成功（仅看 returncode，不推断业务语义）─────
        success = result.returncode == 0  # Unix 约定: 0=成功, 非0=失败
        return {
            "success": success,  # 命令是否以 exit 0 退出
            "stdout": result.stdout.strip(),  # 标准输出（去掉首尾空白）
            "stderr": result.stderr.strip(),  # 标准错误（去掉首尾空白）
            "command": command,  # 实际执行的命令（调试用）
        }

    except subprocess.TimeoutExpired:  # 命令执行超时
        return {
            "success": False,
            "stdout": "",
            "stderr": "命令执行超时",  # 超时提示
            "command": command,
        }

    except Exception as e:  # 其他异常（如命令语法错误、文件不存在等）
        return {
            "success": False,
            "stdout": "",
            "stderr": str(e),  # 原始错误信息
            "command": command,
        }
