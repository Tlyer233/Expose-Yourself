"""
后端公共工具
被 daemon.py / logs.py / skills.py 共享的通用函数
"""
import json  # 读取 manifest.json
import os  # 路径操作
import sys  # 模块路径

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))  # backend/ 加到 path


def find_manifest(name: str) -> dict | None:
    """
    按 manifest.name 从 plugin_paths 中查找单个插件
    @param name 插件名（如 1_chat_monitor）
    @returns manifest 字典（含 _dir），找不到返回 None
    """
    from config import PLUGIN_PATHS  # 延迟导入避免循环依赖

    for plugin_dir in PLUGIN_PATHS:  # 遍历已注册的插件目录
        manifest_path = os.path.join(plugin_dir, 'manifest.json')  # 拼 manifest 路径
        if not os.path.isfile(manifest_path):  # manifest 不存在
            continue  # 跳过
        try:
            with open(manifest_path, 'r') as f:  # 读文件
                m = json.load(f)  # 解析
            if m.get("name") == name:  # 匹配
                m['_dir'] = plugin_dir  # 记录 daemon 目录
                return m  # 找到返回
        except Exception:  # JSON 格式错误
            pass  # 跳过
    return None  # 找不到
