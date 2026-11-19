"""Versioned routes for local file intake and processing results."""

import hashlib
import json
from uuid import uuid4

from fastapi import APIRouter, HTTPException, Request

from solarpv_ingestion.intake import UnsafeUploadError
from solarpv_ingestion.processing import InvalidInputError, PARSER_ID, PARSER_VERSION
from solarpv_ingestion.storage import UploadTooLargeError
from solarpv_ingestion.validation import preview_records
from solarpv_api.schemas import job_response, source_response as serialize_source_response
from solarpv_db.workspaces import WorkspaceNotFound

router = APIRouter()


@router.post("/uploads", status_code=202)
async def upload_file(request: Request, workspace_id: str = "default"):
    workspace_id = _workspace_for_route(request, workspace_id)
    try:
        request.app.state.workspaces.get(workspace_id)
    except WorkspaceNotFound as error:
        raise HTTPException(404, "Workspace not found.") from error
    content_type = request.headers.get("content-type", "").lower()
    if not content_type.startswith("multipart/form-data"):
        raise HTTPException(415, "Upload must use multipart/form-data.")
    try:
        form = await request.form(max_files=1, max_fields=1)
    except Exception as error:
        raise HTTPException(400, "Invalid multipart upload.") from error
    files = [(key, value) for key, value in form.multi_items() if hasattr(value, "filename")]
    if len(files) != 1 or files[0][0] != "file" or len(form.multi_items()) != 1:
        raise HTTPException(400, "Provide exactly one file field named 'file'.")
    upload = files[0][1]
    filename = upload.filename or ""
    suffix = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if suffix not in {"csv", "json"}:
        await upload.close()
        raise HTTPException(415, "Only CSV and JSON uploads are supported.")
    try:
        accepted = request.app.state.intake.accept(
            upload.file, workspace_id=workspace_id, original_filename=filename,
            media_type=upload.content_type,
        )
    except UploadTooLargeError as error:
        raise HTTPException(413, str(error)) from error
    except (UnsafeUploadError, ValueError) as error:
        raise HTTPException(400, str(error)) from error
    finally:
        await upload.close()

    job, reused = request.app.state.queue.create_or_get_job(
        job_id=uuid4().hex, workspace_id=accepted.source_file.workspace_id,
        source_file_id=accepted.source_file.source_file_id,
        idempotency_key=f"profile:{PARSER_ID}:{PARSER_VERSION}:{accepted.source_file.source_file_id}",
    )
    return {
        "source": serialize_source_response(accepted.source_file, duplicate=accepted.duplicate),
        "job_id": job.job_id,
        "job_state": job.state.value,
        "job_reused": reused,
    }


@router.get("/uploads/{source_file_id}")
def get_upload(source_file_id: str, request: Request, workspace_id: str = "default"):
    workspace_id = _workspace_for_route(request, workspace_id)
    source = request.app.state.repository.get_source_file(source_file_id, workspace_id=workspace_id)
    if source is None:
        raise HTTPException(404, "Source file not found.")
    return serialize_source_response(source)


@router.get("/jobs/{job_id}")
def get_job(job_id: str, request: Request, workspace_id: str = "default"):
    workspace_id = _workspace_for_route(request, workspace_id)
    status = request.app.state.repository.get_job_status(job_id, workspace_id=workspace_id)
    if status is None:
        raise HTTPException(404, "Job not found.")
    return job_response(status)


@router.get("/jobs/{job_id}/result")
def get_result(job_id: str, request: Request, workspace_id: str = "default"):
    workspace_id = _workspace_for_route(request, workspace_id)
    artifact = request.app.state.repository.get_job_result(job_id, workspace_id=workspace_id)
    if artifact is None:
        status = request.app.state.repository.get_job_status(job_id, workspace_id=workspace_id)
        if status is None:
            raise HTTPException(404, "Job not found.")
        raise HTTPException(409, "Processing result is not available.")
    try:
        content = request.app.state.storage.read_bytes(artifact.storage_key)
        if hashlib.sha256(content).hexdigest() != artifact.checksum:
            raise ValueError("checksum mismatch")
        result = json.loads(content)
    except (OSError, ValueError, json.JSONDecodeError) as error:
        raise HTTPException(500, "Stored processing result failed integrity verification.") from error
    # Keep the processed result and its bounded source preview on the same API
    # response so the UI does not depend on a separately deployed preview route.
    preview = None
    preview_error = None
    status = request.app.state.repository.get_job_status(job_id, workspace_id=workspace_id)
    source = request.app.state.repository.get_source_file(artifact.source_file_id, workspace_id=workspace_id)
    if status is None or source is None or source.state.value != "available":
        preview_error = "The original source is unavailable for preview."
    elif not request.app.state.storage.matches(
        source.storage_key, sha256=source.sha256, size_bytes=source.size_bytes,
    ):
        preview_error = "The original source could not be verified for preview."
    else:
        try:
            preview = {
                "source_file_id": source.source_file_id,
                "source_sha256": source.sha256,
                **preview_records(
                    request.app.state.storage, source.storage_key, source.original_name,
                    limit=10, max_json_bytes=request.app.state.settings.max_json_bytes,
                ),
            }
        except (InvalidInputError, OSError):
            preview_error = "A bounded preview could not be produced from the original source."
    return {
        "job_id": job_id,
        "source_file_id": artifact.source_file_id,
        "artifact_id": artifact.artifact_id,
        "parser_id": artifact.parser_id,
        "parser_version": artifact.parser_version,
        "schema_version": artifact.schema_version,
        "checksum": artifact.checksum,
        "result": result,
        "preview": preview,
        "preview_error": preview_error,
    }


@router.get("/jobs/{job_id}/preview")
def get_job_preview(job_id: str, request: Request, limit: int = 10, workspace_id: str = "default"):
    """Return a bounded preview directly from a completed job's source file."""
    workspace_id = _workspace_for_route(request, workspace_id)
    if not 1 <= limit <= 20:
        raise HTTPException(422, "Preview limit must be between 1 and 20.")
    status = request.app.state.repository.get_job_status(job_id, workspace_id=workspace_id)
    if status is None:
        raise HTTPException(404, "Processing job not found.")
    if status.state.value != "succeeded":
        raise HTTPException(409, "Preview is available after processing succeeds.")
    source = request.app.state.repository.get_source_file(status.source_file_id, workspace_id=workspace_id)
    if source is None or source.state.value != "available":
        raise HTTPException(404, "Original source file is unavailable.")
    if not request.app.state.storage.matches(
        source.storage_key, sha256=source.sha256, size_bytes=source.size_bytes,
    ):
        raise HTTPException(409, "Original source fingerprint verification failed.")
    try:
        preview = preview_records(
            request.app.state.storage, source.storage_key, source.original_name,
            limit=limit, max_json_bytes=request.app.state.settings.max_json_bytes,
        )
    except (InvalidInputError, OSError) as error:
        raise HTTPException(422, "A bounded preview could not be produced from this source file.") from error
    return {
        "job_id": job_id,
        "source_file_id": source.source_file_id,
        "source_sha256": source.sha256,
        **preview,
    }


@router.post("/jobs/{job_id}/cancel")
def cancel_job(job_id: str, request: Request, workspace_id: str = "default"):
    workspace_id = _workspace_for_route(request, workspace_id)
    try:
        runtime = request.app.state.queue.request_cancellation(job_id, workspace_id=workspace_id)
    except KeyError as error:
        raise HTTPException(404, "Job not found.") from error
    except ValueError as error:
        raise HTTPException(409, str(error)) from error
    return {"job_id": job_id, "state": runtime.state.value}


@router.post("/jobs/{job_id}/retry", status_code=202)
async def retry_job(job_id: str, request: Request, workspace_id: str = "default"):
    """Start a new linked job for a terminal failure; repeated requests replay safely."""
    workspace_id = _workspace_for_route(request, workspace_id)
    body = await _body(request)
    retry_key = body.get("idempotency_key")
    if not isinstance(retry_key, str) or not retry_key.strip():
        raise HTTPException(422, "idempotency_key is required.")
    try:
        runtime = request.app.state.queue.create_retry_job(
            prior_job_id=job_id, job_id=uuid4().hex, idempotency_key=retry_key,
            workspace_id=workspace_id,
        )
    except KeyError as error:
        raise HTTPException(404, "Processing job not found.") from error
    except ValueError as error:
        raise HTTPException(409, str(error)) from error
    return {
        "job_id": runtime.job_id,
        "state": runtime.state.value,
        "retry_of_job_id": runtime.retry_of_job_id,
        "attempt_count": runtime.attempt_count,
        "max_attempts": runtime.max_attempts,
    }


async def _body(request: Request) -> dict:
    """Read a JSON request object for the retry operation."""
    try:
        body = await request.json()
    except (ValueError, json.JSONDecodeError) as error:
        raise HTTPException(400, "Request body must be valid JSON.") from error
    if not isinstance(body, dict):
        raise HTTPException(400, "Request body must be a JSON object.")
    return body


def _workspace_for_route(request: Request, path_workspace_id: str) -> str:
    """Keep legacy routes pinned to default; scoped routes use their path ID."""
    if request.url.path.startswith("/api/v1/workspaces/"):
        return path_workspace_id
    return "default"
