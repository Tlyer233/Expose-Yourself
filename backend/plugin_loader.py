"""
插件业务 API 动态加载器
启动时扫描 manifest.api 字段，按声明 importlib 加载插件 APIRouter 并挂载到壳子 app

设计原则：
  - 代码归属在插件目录，壳子只认 manifest + include_router
  - 单个插件 load 失败 → log + skip，不影响其他插件和通用 API
  - 不在此文件写任何业务逻辑
"""

import importlib.util  # 按路径动态加载模块
import logging  # 日志
import sys  # sys.modules / sys.path
from pathlib import Path  # 跨平台路径

from fastapi import FastAPI, APIRouter  # 壳子 app + 路由类型

logger = logging.getLogger(__name__)  # 模块日志


def load_plugin_routers(app: FastAPI, manifests: list[dict]) -> None:
    """
    按 manifest.api 动态挂载插件 APIRouter
    @param app FastAPI 应用实例
    @param manifests _load_manifests() 返回的列表，每项含 _dir 和可选 api 字段
    """
    for m in manifests:  # 遍历所有插件
        api = m.get("api")  # manifest.api 字段
        if not api:  # 无业务 API → 跳过（如 5_sfl）
            continue

        plugin_name = m.get("name", "unknown")  # 插件名（日志用）
        plugin_dir = m.get("_dir", "")  # 插件磁盘根目录（_load_manifests 写入）
        module_name = api.get("module", "api.router")  # 模块路径如 api.router
        attr = api.get("attr", "router")  # 导出变量名

        # 1) 模块文件路径：plugin_dir / api/router.py
        rel = module_name.replace(".", "/") + ".py"  # api.router → api/router.py
        file_path = Path(plugin_dir) / rel  # 完整路径
        if not file_path.is_file():  # 文件不存在
            logger.warning("插件 %s: %s 不存在，跳过", plugin_name, file_path)  # 打日志
            continue  # 不拖垮壳子

        # 2) 唯一 module 名，避免多插件互相覆盖
        unique = f"expy_plugin_{plugin_name}_{module_name.replace('.', '_')}"  # 如 expy_plugin_1_chat_monitor_api_router
        try:
            # 插件目录临时加入 sys.path（让插件内可相对 import 同目录文件如 executor）
            sys.path.insert(0, str(plugin_dir))  # 临时 push
            spec = importlib.util.spec_from_file_location(unique, file_path)  # 创建 spec
            if spec is None or spec.loader is None:  # spec 创建失败
                logger.warning("插件 %s: spec_from_file_location 失败，跳过", plugin_name)  # 打日志
                continue  # 跳过
            mod = importlib.util.module_from_spec(spec)  # 创建空模块
            sys.modules[unique] = mod  # 注册到 sys.modules
            spec.loader.exec_module(mod)  # 执行模块代码
        except Exception as e:  # 加载失败
            logger.warning("插件 %s: 加载失败 %s", plugin_name, e)  # 打日志
            continue  # 跳过
        finally:
            # 恢复 sys.path（避免污染后续插件）
            if str(plugin_dir) in sys.path:  # 有则移除
                sys.path.remove(str(plugin_dir))  # pop

        # 3) 取出 APIRouter 并挂载
        plugin_router = getattr(mod, attr, None)  # 取导出变量
        if not isinstance(plugin_router, APIRouter):  # 不是 APIRouter
            logger.warning("插件 %s: %s.%s 不是 APIRouter，跳过", plugin_name, module_name, attr)  # 打日志
            continue  # 跳过

        app.include_router(plugin_router)  # 挂载到壳子 app
        logger.info("插件 %s: 业务 API 已挂载 %s", plugin_name, module_name)  # 成功日志
