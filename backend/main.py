"""
Expose Yourself — FastAPI 应用入口
对应 SpringBoot 的 @SpringBootApplication 主类

启动方式（开发）：
    uvicorn backend.main:app --reload --port 9877
    → 等价于 SpringBoot 的 mvn spring-boot:run

启动方式（生产）：
    uvicorn backend.main:app --host 0.0.0.0 --port 9877
    → 等价于 java -jar app.jar
"""

import os  # 路径
import sys  # 模块路径

# 确保 backend/ 目录在 Python 搜索路径中（方便 from config import xxx）
# 对应 SpringBoot 的 @ComponentScan 自动扫描
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from fastapi import FastAPI  # Web 框架（对应 SpringBoot 的 SpringApplication）
from fastapi.middleware.cors import CORSMiddleware  # 跨域中间件（对应 SpringBoot 的 @CrossOrigin 或 WebMvcConfigurer.addCorsMappings）
from fastapi.staticfiles import StaticFiles  # 静态文件服务（对应 spring.web.resources.static-locations）
from fastapi.responses import FileResponse, JSONResponse  # 文件响应 + JSON 响应（SPA fallback 用）
from config import SERVER_HOST, SERVER_PORT, FRONTEND_DIST, PLUGINS_DIR  # 配置常量
from routers.daemon import router as daemon_router, _load_manifests  # daemon 管理路由 + manifest 扫描
from routers.logs import router as logs_router  # 日志 tail 读取路由（步骤 4-2-1）
from routers.skills import router as skills_router  # Skills 管理路由（步骤 4-5）
from plugin_loader import load_plugin_routers  # 插件业务 API 动态加载器（步骤 4-4-2）

# ─── 创建 FastAPI 应用实例 ──────────────────────────────
# 对应 SpringBoot 的 SpringApplication.run(MyApp.class, args)
# title: Swagger 文档标题（对应 springdoc.swagger-ui.title）
# version: API 版本号
app = FastAPI(
    title="Expose Yourself",
    description="把你的一切行为暴露给 AI Agent，让 AI 真正认识你",
    version="1.0.0",
)

# ─── CORS 跨域配置 ─────────────────────────────────────
# 对应 SpringBoot 的 WebMvcConfigurer.addCorsMappings()
# 开发时前端 Vite dev server 在 localhost:5173，需要允许跨域
# 生产时 serve 同源静态文件，CORS 也不碍事
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # 允许所有来源（开发阶段放开，生产应限制）
    allow_credentials=True,  # 允许携带 Cookie
    allow_methods=["*"],  # 允许所有 HTTP 方法（GET/POST/PUT/DELETE...）
    allow_headers=["*"],  # 允许所有请求头
)

# ─── 注册路由 ──────────────────────────────────────────
# 对应 SpringBoot 的 @ComponentScan → 自动发现 @RestController
# FastAPI 需要手动 include_router（类似 SpringBoot 的 @Import）
app.include_router(daemon_router)  # /api/manifests, /api/daemon/{name}/status|start|stop|restart
app.include_router(logs_router)  # /api/daemon/{name}/log_dates|logs（步骤 4-2-1）
app.include_router(skills_router)  # /api/daemon/{name}/skills|skills/action（步骤 4-5）

# ─── 动态挂载插件业务 API ──────────────────────────────
# 扫描 manifest.api 字段，importlib 加载插件 APIRouter 并 include_router
# 所有插件业务代码归插件目录，壳子不写业务（步骤 4-4-2）
load_plugin_routers(app, _load_manifests())

# ─── 插件 UI 静态文件服务 ──────────────────────────────────
# 对应 Flask: @app.route('/plugins/<plugin_name>/<path:filename>')
# 例: /plugins/1_chat_monitor/index.html → ExposeYourself/plugins/1_chat_monitor/index.html
# 需先 expy deploy-ui 把构建产物复制过来
app.mount("/plugins", StaticFiles(directory=PLUGINS_DIR), name="plugins")

# ─── 健康检查接口 ──────────────────────────────────────
# 对应 SpringBoot Actuator 的 /actuator/health
# FastAPI 自带 /docs (Swagger) 和 /openapi.json，无需额外配置


@app.get("/api/health")
async def health_check():
    """
    健康检查接口
    用于验证服务是否正常运行
    @returns { "status": "ok" }
    @api GET /api/health
    """
    return {"status": "ok"}  # SpringBoot 中返回 ResponseEntity.ok(Map.of("status","ok"))


# ─── SPA fallback（生产模式：serve 前端构建产物）─────────
# 对应 SpringBoot 的 spring.web.resources.static-locations
# /api/* → 上方路由处理；/plugins/* → StaticFiles mount 处理
# 其余所有请求 → frontend/dist/（React SPA）


@app.get("/{full_path:path}")
async def serve_frontend(full_path: str):
    """
    SPA fallback：非 /api /plugins 请求返回前端静态文件
    @param full_path URL 路径（如 "assets/index.js" 或 ""=首页）
    @returns 静态文件内容 或 index.html（SPA 路由由 React Router 接管）
    @doc https://fastapi.tiangolo.com/advanced/custom-response/#fileresponse
    """
    # 拼出前端 dist 目录下的对应文件路径
    file_path = os.path.join(FRONTEND_DIST, full_path) if full_path else ""  # 根路径 → 空字符串
    # 请求的是具体文件且存在 → 直接返回（如 /assets/index-xxx.js）
    if full_path and os.path.isfile(file_path):
        return FileResponse(file_path)  # 返回静态文件
    # SPA fallback：返回 index.html（React Router 接管路由）
    index_path = os.path.join(FRONTEND_DIST, "index.html")  # 拼 index.html 路径
    if os.path.isfile(index_path):  # dist 存在
        return FileResponse(index_path)  # 返回壳子首页
    # dist 目录不存在 → 返回 503 提示前端未构建
    return JSONResponse(  # 503 Service Unavailable
        status_code=503,
        content={"detail": "前端未构建，请执行: cd frontend && npm run build"}  # 提示信息
    )


# uvicorn backend.main:app --reload --port 9877
# 杀进程: lsof -ti:9877 | xargs kill
