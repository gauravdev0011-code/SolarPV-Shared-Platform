"""FastAPI application factory for the local-first ingestion service."""

import json
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from solarpv_api.asset_routes import trusted_local

from solarpv_api.config import Settings
from solarpv_api.routes import router
from solarpv_api.dataset_routes import router as dataset_router
from solarpv_api.workspace_routes import router as workspace_router
from solarpv_api.dashboard_routes import router as dashboard_router
from solarpv_api.recovery_routes import router as recovery_router
from solarpv_api.asset_routes import router as asset_router
from solarpv_api.visit_routes import router as visit_router
from solarpv_api.visit_routes import demo_router as demo_visit_router
from solarpv_api.association_routes import router as association_router
from solarpv_api.inverter_routes import router as inverter_router
from solarpv_api.panel_routes import router as panel_router
from solarpv_ingestion.datasets import DatasetService
from solarpv_ingestion.intake import FileIntakeService
from solarpv_ingestion.jobs import JobQueue
from solarpv_ingestion.repository import IngestionRepository
from solarpv_ingestion.storage import LocalArtifactStorage
from solarpv_db.dashboard import DashboardService
from solarpv_db.panel_csv import MAX_BYTES as PANEL_CSV_MAX_BYTES
from solarpv_db.workspaces import WorkspaceService


class UploadRequestLimitMiddleware:
    """Bound actual ASGI request bytes before multipart parsing can spool them."""

    def __init__(self, app, max_request_bytes: int):
        self.app = app
        self.max_request_bytes = max_request_bytes

    async def __call__(self, scope, receive, send):
        path_parts = scope.get("path", "").strip("/").split("/")
        is_upload_path = (
            path_parts == ["api", "v1", "uploads"]
            or (len(path_parts) == 5 and path_parts[:3] == ["api", "v1", "workspaces"]
                and path_parts[4] == "uploads")
        )
        is_upload_path = is_upload_path or (len(path_parts)==6 and path_parts[:3]==['api','v1','workspaces'] and path_parts[4:]==['visits','attachments'])
        is_upload_path = is_upload_path or path_parts == ['api','v1','panel-demo','visits','attachments']
        is_panel_csv = path_parts in (
            ["api", "v1", "panel-inspection", "csv-imports", "preview"],
            ["api", "v1", "panel-inspection", "csv-imports", "commit"],
        )
        is_upload_path = is_upload_path or is_panel_csv
        if scope["type"] != "http" or not is_upload_path or scope.get("method") != "POST":
            await self.app(scope, receive, send)
            return
        headers = dict(scope.get("headers", []))
        limit = min(self.max_request_bytes, PANEL_CSV_MAX_BYTES + 64 * 1024) if is_panel_csv else self.max_request_bytes
        length = headers.get(b"content-length")
        if length:
            try:
                if int(length) > limit:
                    await self._reject(send)
                    return
            except ValueError:
                await self._reject(send)
                return
        total = 0
        exceeded = False

        async def limited_receive():
            nonlocal total, exceeded
            message = await receive()
            if message["type"] == "http.request":
                total += len(message.get("body", b""))
                if total > limit:
                    exceeded = True
                    return {"type": "http.disconnect"}
            return message

        async def guarded_send(message):
            if exceeded:
                return
            await send(message)

        try:
            await self.app(scope, limited_receive, guarded_send)
        except Exception:
            if not exceeded:
                raise
        if exceeded:
            await self._reject(send)

    @staticmethod
    async def _reject(send):
        body = json.dumps({"detail": "Upload request exceeds the configured size limit."}).encode()
        await send({"type": "http.response.start", "status": 413,
                    "headers": [(b"content-type", b"application/json"),
                                (b"content-length", str(len(body)).encode())]})
        await send({"type": "http.response.body", "body": body})


def create_app(settings: Settings | None = None) -> FastAPI:
    configured = settings or Settings.from_environment()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        from solarpv_db.database import initialize_database

        initialize_database(configured.database_path)
        storage = LocalArtifactStorage(configured.storage_path)
        app.state.settings = configured
        app.state.storage = storage
        app.state.repository = IngestionRepository(configured.database_path)
        app.state.queue = JobQueue(configured.database_path)
        app.state.datasets = DatasetService(
            configured.database_path, storage, max_json_bytes=configured.max_json_bytes,
        )
        app.state.workspaces = WorkspaceService(configured.database_path)
        app.state.dashboard = DashboardService(configured.database_path)
        app.state.intake = FileIntakeService(
            database_path=configured.database_path, storage=storage,
            max_file_bytes=configured.max_file_bytes,
        )
        yield

    app = FastAPI(title="SOLARIS Ingestion API", version="1.0.0", lifespan=lifespan)
    @app.middleware('http')
    async def local_development_boundary(request: Request, call_next):
        # No client role, selected workspace, forwarded header or optional flag
        # grants API access from outside the approved trusted-local environment.
        try:
            trusted_local(request)
        except HTTPException:
            return JSONResponse({'detail':'This development API accepts only loopback connections, local Host and local browser Origin. Shared access requires Task 12 authentication.'},status_code=403,headers={'Cache-Control':'no-store'})
        return await call_next(request)
    app.state.settings = configured
    app.include_router(router, prefix="/api/v1")
    app.include_router(dataset_router, prefix="/api/v1")
    app.include_router(workspace_router)
    app.include_router(dashboard_router)
    app.include_router(recovery_router)
    app.include_router(asset_router)
    app.include_router(visit_router)
    app.include_router(demo_visit_router)
    app.include_router(association_router)
    app.include_router(inverter_router)
    app.include_router(panel_router, prefix="/api/v1")
    # Preserve the pre-workspace API as a default-workspace compatibility surface.
    app.include_router(router, prefix="/api/v1/workspaces/{workspace_id}")
    app.include_router(dataset_router, prefix="/api/v1/workspaces/{workspace_id}")
    # Multipart framing and form fields need bounded overhead in addition to file bytes.
    app.add_middleware(UploadRequestLimitMiddleware, max_request_bytes=configured.max_file_bytes + 1024 * 1024)
    return app


app = create_app()
