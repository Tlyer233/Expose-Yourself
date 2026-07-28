"""
Expose Yourself — 后端配置
所有配置从 ../config.yaml 读取，无硬编码
"""
import os  # 路径操作
import sys  # 退出

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # ExposeYourself/

# ─── 读取 config.yaml（必须存在，不兜底）────────────────
try:
    import yaml  # PyYAML（pip install pyyaml）
except ImportError:  # pyyaml 未安装
    print("❌ pyyaml 未安装，请执行: pip install pyyaml")
    sys.exit(1)  # 退出

_config_path = os.path.join(BASE_DIR, 'config.yaml')  # 配置文件路径
if not os.path.isfile(_config_path):  # 配置文件不存在
    print(f"❌ 配置文件不存在: {_config_path}")
    print(f"   请从模板创建或检查路径")
    sys.exit(1)  # 退出，不兜底

with open(_config_path) as f:  # 读取
    _cfg = yaml.safe_load(f)  # 解析 YAML

# ─── 服务器配置 ──────────────────────────────────────
SERVER_HOST = _cfg['server']['host']  # 监听地址
SERVER_PORT = _cfg['server']['port']  # 端口号

# ─── 插件路径列表（expy deploy 自动维护）───────────────
PLUGIN_PATHS = _cfg.get('plugin_paths', [])  # 每个元素是插件根目录的绝对路径

# ─── sudo 密码（从环境变量读取，绝不写入文件）─────────
SUDO_PASSWORD = os.environ.get('HERMES_SUDO_PASSWORD', '')  # 未设置则为空字符串
# 注意：如果 SUDO_PASSWORD 为空，executor.run_command(sudo=True) 会返回错误提示

# ─── 派生路径（基于 BASE_DIR 计算，无需配置）──────────
HERMES_SKILLS_DIR = os.path.expanduser("~/.hermes/skills")  # ~/.hermes/skills/
PLUGINS_DIR = os.path.join(BASE_DIR, "plugins")  # ExposeYourself/plugins/
FRONTEND_DIST = os.path.join(BASE_DIR, "frontend", "dist")  # ExposeYourself/frontend/dist/
