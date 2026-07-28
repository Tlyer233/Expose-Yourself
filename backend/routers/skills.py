"""
Skills 管理路由
提供 skill 列表查询 / 启用 / 更新 / 禁用
对应 0_control_center/backend/routes/daemon_manager.py 的 Skills 部分（Flask → FastAPI）
"""

import os  # 路径操作
import shutil  # 文件拷贝
import sys  # sys.path

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))  # backend/ 加到 path

from fastapi import APIRouter, Body, HTTPException  # 路由分组 + 请求体 + 异常
from pydantic import BaseModel  # 请求体模型
from config import HERMES_SKILLS_DIR  # ~/.hermes/skills
from utils.common import find_manifest  # 统一 manifest 查找（daemon/logs/skills 共用）

router = APIRouter(prefix="/api", tags=["skills"])  # /api/daemon/{name}/skills 系列

# ─── 请求体模型 ─────────────────────────────────────────


class SkillActionRequest(BaseModel):
    """skill 操作请求体"""
    path: str  # manifest.skills 中的相对路径如 skills/chat-query
    action: str  # enable | update | disable


# ─── 工具函数 ───────────────────────────────────────────


def _skill_paths(m: dict, skill_rel: str) -> tuple[str, str, str]:
    """
    解析 skill 源/目标绝对路径
    @param m manifest（含 _dir）
    @param skill_rel manifest.skills 中的相对路径
    @returns (name, src_abs, dst_abs)
    """
    name = os.path.basename(skill_rel.rstrip("/"))  # skills/chat-query → chat-query
    src = os.path.abspath(os.path.join(m["_dir"], skill_rel))  # 插件内绝对路径
    dst = os.path.join(HERMES_SKILLS_DIR, name)  # ~/.hermes/skills/<name>
    return name, src, dst  # 返回三元组


# ─── API 端点 ───────────────────────────────────────────


@router.get("/daemon/{name}/skills")
async def get_skills(name: str):
    """
    读取插件 manifest.skills，返回列表及启用状态
    @param name 插件名
    @returns [{ path, name, src, dst, enabled, exists_in_plugin }]
    """
    m = find_manifest(name)  # 按 name 查 manifest
    if not m:  # 未找到
        raise HTTPException(404, {"error": "daemon not found"})  # 404
    result = []  # 组装列表
    for skill_rel in m.get("skills") or []:  # 遍历 skills 数组
        if not isinstance(skill_rel, str) or not skill_rel.strip():  # 跳过非法项
            continue  # 空串/非字符串忽略
        skill_rel = skill_rel.strip()  # 去空白
        sname, src, dst = _skill_paths(m, skill_rel)  # 解析路径
        result.append({  # 单条 skill 状态
            "path": skill_rel,  # manifest 中的相对路径
            "name": sname,  # skill 文件夹名
            "src": src,  # 源绝对路径
            "dst": dst,  # 目标绝对路径
            "enabled": os.path.isdir(dst),  # ~/.hermes/skills 下是否存在
            "exists_in_plugin": os.path.isdir(src),  # 插件源目录是否存在
        })
    return result  # JSON 列表（FastAPI 自动转换）


@router.post("/daemon/{name}/skills/action")
async def skills_action(name: str, body: SkillActionRequest):
    """
    对单个 skill 执行 enable/update/disable
    - enable: 复制 src → dst
    - update: 删除 dst 后复制 src → dst
    - disable: 删除 dst
    @param name 插件名
    @param body { path, action }
    @returns { success, action, name }
    """
    m = find_manifest(name)  # 查 manifest
    if not m:  # 未找到
        raise HTTPException(404, {"error": "daemon not found"})  # 404
    skill_rel = body.path.strip()  # 相对路径
    action = body.action.strip()  # 动作
    if not skill_rel or action not in ("enable", "update", "disable"):  # 参数校验
        raise HTTPException(400, {"error": "invalid params", "need": "path + action"})  # 400
    allowed = set(m.get("skills") or [])  # 白名单：只允许 manifest 声明的 skill
    if skill_rel not in allowed:  # 防止任意路径拷贝
        raise HTTPException(400, {"error": "skill not in manifest"})  # 未注册
    sname, src, dst = _skill_paths(m, skill_rel)  # 解析绝对路径
    try:
        os.makedirs(HERMES_SKILLS_DIR, exist_ok=True)  # 确保目标根目录存在
        if action == "disable":  # 禁用：删除 ~/.hermes/skills/<name>
            if os.path.isdir(dst):  # 存在才删
                shutil.rmtree(dst)  # 递归删除
            return {"success": True, "action": "disable", "name": sname}  # 成功
        if not os.path.isdir(src):  # enable/update 需要源目录
            raise HTTPException(404, {"error": f"source not found: {src}"})  # 404
        if action == "enable" and os.path.isdir(dst):  # 已启用则拒绝 enable
            raise HTTPException(409, {"error": "already enabled", "name": sname})  # 409
        if os.path.isdir(dst):  # update：先清旧目录
            shutil.rmtree(dst)  # 删除旧版
        shutil.copytree(src, dst)  # 整夹拷贝到 Hermes
        return {"success": True, "action": action, "name": sname, "dst": dst}  # 成功
    except HTTPException:  # 已知异常直接抛出（不出现在 except Exception 中）
        raise  # 重新抛出
    except Exception as e:  # 其他异常
        raise HTTPException(500, {"error": str(e)})  # 500
