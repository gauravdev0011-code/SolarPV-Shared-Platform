"""Dataset registration, versioning, mapping, validation, and review services."""

from __future__ import annotations

import hashlib
import io
import json
import math
import sqlite3
import tempfile
from pathlib import Path
from uuid import uuid4

from solarpv_db.database import DEFAULT_DATABASE, get_connection
from solarpv_ingestion.processing import InvalidInputError, source_json_value, preview_value
from solarpv_ingestion.repository import IngestionRepository
from solarpv_ingestion.states import ApprovalState, DatasetVersionState
from solarpv_ingestion.storage import LocalArtifactStorage
from solarpv_ingestion.transitions import InvalidStateTransition
from solarpv_ingestion.validation import (
    MAX_ISSUE_ARTIFACT_BYTES,
    MAX_ISSUE_COUNT,
    MAX_RESULT_BYTES,
    VALIDATION_RULE_SET,
    TELEMETRY_RULE_VERSION,
    EXPECTED_UNITS,
    ValidationResourceLimitError,
    preview_records,
    validate_records,
    validate_policy,
)


class DatasetError(ValueError):
    """Invalid dataset request or lifecycle operation."""


class DatasetNotFound(KeyError):
    """A requested dataset resource does not exist in the default workspace."""


class DatasetConflict(RuntimeError):
    """A dataset idempotency key or lifecycle precondition conflicts."""


def _issue_matches_search(issue: dict, search: str | None) -> bool:
    """Identical literal search for paged groups, source findings and export."""
    needle = (search or "").strip().casefold()
    return not needle or needle in " ".join(str(issue.get(key, "")) for key in
        ("row", "field", "code", "message", "observed_value_preview")).casefold()


class DatasetService:
    def __init__(
        self,
        database_path: str | Path = DEFAULT_DATABASE,
        storage: LocalArtifactStorage | None = None,
        *,
        max_json_bytes: int = 5 * 1024 * 1024,
    ) -> None:
        self.database_path = database_path
        self.storage = storage or LocalArtifactStorage(Path(database_path).parent / "private-storage")
        self.max_json_bytes = max_json_bytes
        self.repository = IngestionRepository(database_path)

    def create_dataset(self, *, name: str, job_id: str, idempotency_key: str,
                       workspace_id: str = "default") -> dict:
        name = _required_text(name, "name", 200)
        key = _required_text(idempotency_key, "idempotency_key", 200)
        request_fingerprint = _fingerprint({"operation": "create_dataset", "name": name, "job_id": job_id})
        dataset_id, version_id, request_id = uuid4().hex, uuid4().hex, uuid4().hex
        with get_connection(self.database_path) as connection:
            connection.execute("BEGIN IMMEDIATE")
            replay = self._find_request(connection, key, request_fingerprint, workspace_id)
            if replay:
                return self._version_dict(connection, replay["dataset_version_id"], workspace_id)
            source, artifact, profile = self._processed_job(connection, job_id, workspace_id)
            cursor = connection.execute(
                "INSERT INTO datasets(dataset_id, workspace_id, name) VALUES (?, ?, ?)",
                (dataset_id, workspace_id, name),
            )
            connection.execute(
                """INSERT INTO dataset_versions (
                    dataset_version_id, dataset_id, version_number, state, artifact_key,
                    checksum, schema_version, source_job_id, source_artifact_id,
                    source_sha256, row_count, profile_json
                ) VALUES (?, ?, 1, 'draft', ?, ?, ?, ?, ?, ?, ?, ?)""",
                (version_id, dataset_id, artifact["storage_key"], source["sha256"],
                 artifact["schema_version"], job_id, artifact["artifact_id"], source["sha256"],
                 _row_count(profile), _canonical_json(profile)),
            )
            connection.execute(
                """INSERT INTO dataset_sources(
                    dataset_source_id, dataset_version_id, source_file_id, artifact_id
                ) VALUES (?, ?, ?, ?)""",
                (uuid4().hex, version_id, source["source_file_id"], artifact["artifact_id"]),
            )
            connection.execute(
                """INSERT INTO dataset_version_requests(
                    request_id, workspace_id, dataset_id, dataset_version_id,
                    job_id, idempotency_key, request_fingerprint
                ) VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (request_id, workspace_id, dataset_id, version_id, job_id, key, request_fingerprint),
            )
            connection.execute("UPDATE datasets SET updated_at = CURRENT_TIMESTAMP WHERE dataset_id = ?", (dataset_id,))
            return self._version_dict(connection, version_id, workspace_id)

    def create_version(self, dataset_id: str, *, job_id: str, idempotency_key: str,
                       workspace_id: str = "default") -> dict:
        key = _required_text(idempotency_key, "idempotency_key", 200)
        request_fingerprint = _fingerprint({"operation": "create_version", "dataset_id": dataset_id, "job_id": job_id})
        version_id, request_id = uuid4().hex, uuid4().hex
        with get_connection(self.database_path) as connection:
            connection.execute("BEGIN IMMEDIATE")
            replay = self._find_request(connection, key, request_fingerprint, workspace_id)
            if replay:
                if replay["dataset_id"] != dataset_id:
                    raise DatasetConflict("Idempotency key is already used by another dataset request.")
                return self._version_dict(connection, replay["dataset_version_id"], workspace_id)
            dataset = connection.execute(
                "SELECT dataset_id FROM datasets WHERE dataset_id = ? AND workspace_id = ?",
                (dataset_id, workspace_id),
            ).fetchone()
            if dataset is None:
                raise DatasetNotFound(dataset_id)
            source, artifact, profile = self._processed_job(connection, job_id, workspace_id)
            number = connection.execute(
                "SELECT COALESCE(MAX(version_number), 0) + 1 FROM dataset_versions WHERE dataset_id = ?",
                (dataset_id,),
            ).fetchone()[0]
            connection.execute(
                """INSERT INTO dataset_versions (
                    dataset_version_id, dataset_id, version_number, state, artifact_key,
                    checksum, schema_version, source_job_id, source_artifact_id,
                    source_sha256, row_count, profile_json
                ) VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?)""",
                (version_id, dataset_id, number, artifact["storage_key"], source["sha256"],
                 artifact["schema_version"], job_id, artifact["artifact_id"], source["sha256"],
                 _row_count(profile), _canonical_json(profile)),
            )
            connection.execute(
                "INSERT INTO dataset_sources(dataset_source_id, dataset_version_id, source_file_id, artifact_id) VALUES (?, ?, ?, ?)",
                (uuid4().hex, version_id, source["source_file_id"], artifact["artifact_id"]),
            )
            connection.execute(
                """INSERT INTO dataset_version_requests(
                    request_id, workspace_id, dataset_id, dataset_version_id,
                    job_id, idempotency_key, request_fingerprint
                ) VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (request_id, workspace_id, dataset_id, version_id, job_id, key, request_fingerprint),
            )
            connection.execute("UPDATE datasets SET updated_at = CURRENT_TIMESTAMP WHERE dataset_id = ?", (dataset_id,))
            return self._version_dict(connection, version_id, workspace_id)

    def list_datasets(self, *, limit: int = 50, offset: int = 0,
                      workspace_id: str = "default", search: str = "") -> dict:
        _page(limit, offset)
        if not isinstance(search, str) or len(search) > 200:
            raise DatasetError('Dataset search must be at most 200 characters.')
        # Literal substring matching: wildcard characters in research names are not SQL patterns.
        query = '%' + search.replace('!', '!!').replace('%', '!%').replace('_', '!_') + '%'
        with get_connection(self.database_path) as connection:
            rows = connection.execute(
                """SELECT dataset.dataset_id, dataset.name, dataset.created_at, dataset.updated_at,
                          (SELECT MAX(version_number) FROM dataset_versions v
                           WHERE v.dataset_id = dataset.dataset_id) AS latest_version_number,
                          (SELECT v.row_count FROM dataset_versions v WHERE v.dataset_id=dataset.dataset_id ORDER BY v.version_number DESC LIMIT 1) AS source_row_count,
                          (SELECT f.original_name FROM dataset_versions v JOIN dataset_sources s ON s.dataset_version_id=v.dataset_version_id JOIN source_files f ON f.source_file_id=s.source_file_id WHERE v.dataset_id=dataset.dataset_id AND f.workspace_id=dataset.workspace_id ORDER BY v.version_number DESC,s.dataset_source_id LIMIT 1) AS source_name,
                          (SELECT f.size_bytes FROM dataset_versions v JOIN dataset_sources s ON s.dataset_version_id=v.dataset_version_id JOIN source_files f ON f.source_file_id=s.source_file_id WHERE v.dataset_id=dataset.dataset_id AND f.workspace_id=dataset.workspace_id ORDER BY v.version_number DESC,s.dataset_source_id LIMIT 1) AS source_size_bytes,
                          (SELECT state FROM dataset_versions v WHERE v.dataset_id = dataset.dataset_id
                           ORDER BY version_number DESC LIMIT 1) AS latest_version_state,
                          (SELECT v.version_number FROM dataset_versions v
                           JOIN approvals a ON a.dataset_version_id = v.dataset_version_id
                           WHERE v.dataset_id = dataset.dataset_id AND a.state = 'approved'
                           ORDER BY a.decision_at DESC, a.created_at DESC LIMIT 1) AS approved_version_number
                   FROM datasets dataset WHERE workspace_id = ? AND name LIKE ? ESCAPE '!'
                   ORDER BY created_at DESC, dataset_id LIMIT ? OFFSET ?""",
                (workspace_id, query, limit, offset),
            ).fetchall()
            count = connection.execute(
                "SELECT COUNT(*) FROM datasets WHERE workspace_id = ? AND name LIKE ? ESCAPE '!'", (workspace_id, query)
            ).fetchone()[0]
        return {"items": [dict(row) for row in rows], "total": count, "limit": limit, "offset": offset}

    def get_dataset(self, dataset_id: str, *, workspace_id: str = "default") -> dict:
        with get_connection(self.database_path) as connection:
            row = connection.execute(
                "SELECT * FROM datasets WHERE dataset_id = ? AND workspace_id = ?",
                (dataset_id, workspace_id),
            ).fetchone()
            if row is None:
                raise DatasetNotFound(dataset_id)
            versions = connection.execute(
                """SELECT version.*, dataset.name, dataset.workspace_id, source.source_file_id
                   FROM dataset_versions version JOIN datasets dataset
                     ON dataset.dataset_id = version.dataset_id
                   LEFT JOIN dataset_sources source
                     ON source.dataset_version_id = version.dataset_version_id
                   WHERE version.dataset_id = ? AND dataset.workspace_id = ?
                   ORDER BY version.version_number DESC, source.dataset_source_id""",
                (dataset_id, workspace_id),
            ).fetchall()
            latest_approval = connection.execute(
                """SELECT approval.* FROM approvals approval
                   JOIN dataset_versions version ON version.dataset_version_id = approval.dataset_version_id
                   JOIN datasets dataset ON dataset.dataset_id = version.dataset_id
                   WHERE version.dataset_id = ? AND approval.state = 'approved'
                     AND dataset.workspace_id = ?
                   ORDER BY approval.decision_at DESC, approval.created_at DESC LIMIT 1""",
                (dataset_id, workspace_id),
            ).fetchone()
        return {"dataset_id": row["dataset_id"], "workspace_id": row["workspace_id"],
                "name": row["name"], "created_at": row["created_at"], "updated_at": row["updated_at"],
                "versions": [self._version_dict_from_row(v) for v in versions],
                "approved_version_id": latest_approval["dataset_version_id"] if latest_approval else None}

    def list_versions(self, dataset_id: str, *, workspace_id: str = "default") -> list[dict]:
        with get_connection(self.database_path) as connection:
            if connection.execute(
                "SELECT 1 FROM datasets WHERE dataset_id = ? AND workspace_id = ?", (dataset_id, workspace_id)
            ).fetchone() is None:
                raise DatasetNotFound(dataset_id)
            rows = connection.execute(
                """SELECT version.*, dataset.name, dataset.workspace_id, source.source_file_id
                   FROM dataset_versions AS version
                   JOIN datasets AS dataset ON dataset.dataset_id = version.dataset_id
                   LEFT JOIN dataset_sources AS source
                     ON source.dataset_version_id = version.dataset_version_id
                   WHERE version.dataset_id = ? AND dataset.workspace_id = ?
                   ORDER BY version.version_number DESC, source.dataset_source_id""",
                (dataset_id, workspace_id),
            ).fetchall()
        return [self._version_dict_from_row(row) for row in rows]

    def get_version(self, dataset_id: str, version_id: str, *, workspace_id: str = "default") -> dict:
        with get_connection(self.database_path) as connection:
            row = connection.execute(
                """SELECT version.*, dataset.name, dataset.workspace_id, source.source_file_id
                   FROM dataset_versions version JOIN datasets dataset
                   ON dataset.dataset_id = version.dataset_id
                   LEFT JOIN dataset_sources source
                     ON source.dataset_version_id = version.dataset_version_id
                   WHERE dataset.dataset_id = ? AND version.dataset_version_id = ?
                     AND dataset.workspace_id = ?
                   ORDER BY source.dataset_source_id LIMIT 1""", (dataset_id, version_id, workspace_id)
            ).fetchone()
            if row is None:
                raise DatasetNotFound(version_id)
            return self._version_dict_from_row(row)

    def get_profile(self, dataset_id: str, version_id: str, *, workspace_id: str = "default") -> dict:
        version = self.get_version(dataset_id, version_id, workspace_id=workspace_id)
        if version["profile"] is None:
            raise DatasetError("Dataset profile is unavailable.")
        return {"dataset_id": dataset_id, "dataset_version_id": version_id,
                "source_file_id": version["source_file_id"], "source_sha256": version["source_sha256"],
                "processing_job_id": version["source_job_id"], "profile": version["profile"]}

    def get_preview(self, dataset_id: str, version_id: str, *, limit: int = 20,
                    workspace_id: str = "default", bounded: bool = True) -> dict:
        version = self.get_version(dataset_id, version_id, workspace_id=workspace_id)
        with get_connection(self.database_path) as connection:
            row = connection.execute(
                """SELECT file.storage_key, file.original_name, file.sha256, file.size_bytes FROM dataset_sources source
                   JOIN source_files file ON file.source_file_id = source.source_file_id
                   WHERE source.dataset_version_id = ? ORDER BY source.dataset_source_id LIMIT 1""",
                (version_id,),
            ).fetchone()
        if row is None:
            raise DatasetError("Dataset source is unavailable.")
        if not self.storage.matches(row["storage_key"], sha256=row["sha256"], size_bytes=row["size_bytes"]):
            raise DatasetError("Original source does not match its recorded fingerprint.")
        preview = preview_records(self.storage, row["storage_key"], row["original_name"],
                                  limit=limit, max_json_bytes=self.max_json_bytes, bounded=bounded)
        return {"dataset_id": dataset_id, "dataset_version_id": version_id,
                "source_file_id": version["source_file_id"], "source_sha256": version["source_sha256"],
                **preview}

    def get_intelligence(self, dataset_id: str, version_id: str, *, workspace_id: str = "default") -> dict:
        from solarpv_ingestion.intelligence import RULE_VERSION, recognize, normalize_cell
        from solarpv_ingestion.diagnosis import build_diagnoses, eligibility
        version = self.get_version(dataset_id, version_id, workspace_id=workspace_id)
        preview = self.get_preview(dataset_id, version_id, limit=100, workspace_id=workspace_id, bounded=False)
        recognition = recognize(preview["columns"], preview["rows"])
        mapping = self.get_mapping(dataset_id, version_id, workspace_id=workspace_id)
        run_id = version["current_validation_run_id"]
        report = self.get_validation(run_id, workspace_id=workspace_id) if run_id else None

        with get_connection(self.database_path) as connection:
            approval = connection.execute(
                "SELECT * FROM approvals WHERE dataset_version_id=? ORDER BY CASE state WHEN 'approved' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END, created_at DESC, approval_id DESC LIMIT 1",
                (version_id,),
            ).fetchone()
            previous = connection.execute(
                """SELECT v.dataset_version_id FROM dataset_versions v JOIN approvals a
                   ON a.dataset_version_id=v.dataset_version_id WHERE v.dataset_id=?
                   AND v.version_number<? AND a.state='approved' ORDER BY v.version_number DESC LIMIT 1""",
                (dataset_id, version["version_number"]),
            ).fetchone()
        prior_fingerprint = None
        if previous:
            prior = self.get_preview(dataset_id, previous[0], limit=1, workspace_id=workspace_id)
            prior_fingerprint = recognize(prior["columns"], []) ["schema_fingerprint"]
        source = self._source_for_version(version_id, workspace_id)
        decisions = []
        for candidate in recognition["fields"]:
            if candidate["target_field"] == "power_factor" and candidate.get("measurement_unit") == "%":
                saved = next((c for c in (mapping or {}).get("columns", []) if c["source_column"] == candidate["source_column"]), None)
                samples = [normalize_cell(row.get(candidate["source_column"]), {"expected_type": "number"}) for row in preview["rows"]]
                numbers = [float(cell["value"]) for cell in samples if cell["status"] == "valid" and math.isfinite(float(cell["value"]))]
                decisions.append({"field": candidate["source_column"], "kind": "power_factor_scale",
                                  "state": "confirmed" if saved and saved.get("value_scale") else "unresolved",
                                  "confirmed_scale": saved.get("value_scale") if saved else None,
                                  "sample_count": len(numbers), "sample_min": min(numbers) if numbers else None,
                                  "sample_max": max(numbers) if numbers else None,
                                  "evidence_scope": "First 100 source records; not full-file statistics",
                                  "hypotheses": ["Ratio representation", "Percentage representation", "Incorrect field semantics"],
                                  "automatic_choice": None})
        diagnosed = build_diagnoses(self.export_validation_issues(run_id, workspace_id=workspace_id), run_id, (mapping or {}).get("columns", [])) if run_id else []
        approval_data = self._approval_dict(approval) if approval else None
        registration = eligibility(version, report, diagnosed, approval_data)
        registration["validation_current"] = bool(report and report.get("telemetry_rule_version") == TELEMETRY_RULE_VERSION)
        if report and not registration["validation_current"] and not registration["registered"]:
            registration.update(state="review_required", primary_action="inspect_integrity", can_submit=False, can_approve=False)
            registration["policy"] = "Validation uses an older scientific rule version. Create a new version and validate current inputs before a new approval."
        current = self.get_version(dataset_id, version_id, workspace_id=workspace_id)
        if current["mapping_revision_id"] != version["mapping_revision_id"] or current["current_validation_run_id"] != run_id:
            raise DatasetConflict("Dataset inputs changed during diagnosis. Retry the view.")
        return {"dataset_id": dataset_id, "dataset_version_id": version_id,
                "eligibility": registration,
                "source_size_bytes": source["size_bytes"],
                "automatic_handling": ["Original source checksum verified", f"{len((mapping or {}).get('columns',[]))} field mappings persisted"]
                    + ([f"Validation completed for {report.get('row_count',0)} records"] if report else [])
                    + (["Missing/invalid source states are retained with quality flags"] if any(d["category"] in {"numeric","missing"} for d in diagnosed) else [])
                    + (["Versioned normalization is derived on demand from the saved mapping"] if mapping else []),
                "scientific_decisions": decisions,
                "filename": source["original_name"], "recognition": recognition,
                "schema_changed": prior_fingerprint != recognition["schema_fingerprint"] if prior_fingerprint else None,
                "previous_approved_schema_fingerprint": prior_fingerprint,
                "diagnoses": diagnosed, "validation": report,
                "approval": self._approval_dict(approval) if approval else None,
                "normalization": {"rule_version": RULE_VERSION, "representation": "derived_from_preserved_source",
                                  "mapping_revision_id": version["mapping_revision_id"],
                                  "source_sha256": version["source_sha256"],
                                  "validation_run_id": run_id,
                                  "status": "available" if mapping else "pending"},
                "pending_decisions": registration["pending_decisions"],
                "processing_complete": bool(run_id),
                "registration_allowed": registration["can_submit"]}

    def original_source(self, dataset_id: str, version_id: str, *, workspace_id: str = "default"):
        self.get_version(dataset_id,version_id,workspace_id=workspace_id)
        source=self._source_for_version(version_id,workspace_id)
        if not self.storage.matches(source["storage_key"],sha256=source["sha256"],size_bytes=source["size_bytes"]):
            raise DatasetError("Original source failed integrity verification.")
        def chunks():
            with self.storage.open_read(source["storage_key"]) as stream:
                while chunk:=stream.read(65536):yield chunk
        return source["original_name"],chunks()

    def get_source_profiles(self, dataset_id: str, *, workspace_id: str = "default") -> dict:
        from solarpv_ingestion.intelligence import recognize, NULL_MARKERS, RULE_VERSION
        self.get_dataset(dataset_id, workspace_id=workspace_id)
        with get_connection(self.database_path) as connection:
            rows=connection.execute(
                """SELECT DISTINCT v.dataset_version_id,v.version_number FROM dataset_versions v
                JOIN approvals a ON a.dataset_version_id=v.dataset_version_id
                WHERE v.dataset_id=? AND a.state='approved' ORDER BY v.version_number DESC LIMIT 20""",(dataset_id,)).fetchall()
        profiles=[]
        for row in rows:
            preview=self.get_preview(dataset_id,row["dataset_version_id"],limit=1,workspace_id=workspace_id)
            mapping=self.get_mapping(dataset_id,row["dataset_version_id"],workspace_id=workspace_id)
            profiles.append({"profile_id":row["dataset_version_id"],"profile_version":row["version_number"],
                "source_identity":{"dataset_id":dataset_id,"scope":"Explicit dataset/source lineage; instrument identity must be confirmed by the operator"},
                "schema_fingerprint":recognize(preview["columns"],[])["schema_fingerprint"],
                "mapping_revision_id":(mapping or {}).get("mapping_revision_id"),"field_mappings":(mapping or {}).get("columns",[]),
                "missing_markers":sorted(NULL_MARKERS),"normalization_rule_version":RULE_VERSION,
                "interpretation_reuse_requires_explicit_profile_selection":True})
        return {"profiles":profiles}

    def prepare(self, dataset_id: str, version_id: str, *, workspace_id: str = "default", source_profile_version_id: str | None = None) -> dict:
        """Resume safe mapping and preliminary validation using stable operation identities."""
        from solarpv_ingestion.intelligence import recognize
        if source_profile_version_id is not None:
            source_profile_version_id = _required_text(source_profile_version_id, "source_profile_version_id", 200)
        version = self.get_version(dataset_id, version_id, workspace_id=workspace_id)
        mapping = self.get_mapping(dataset_id, version_id, workspace_id=workspace_id)
        if mapping and source_profile_version_id:
            with get_connection(self.database_path) as connection:
                revision=connection.execute("SELECT idempotency_key FROM dataset_mapping_revisions WHERE mapping_revision_id=?",(mapping["mapping_revision_id"],)).fetchone()
            if not revision or revision[0] != f"automatic-mapping-v2:{source_profile_version_id}":
                raise DatasetConflict("This version was prepared with different mapping inputs; create a new version to select a source profile.")
        if not mapping and version["state"] == "draft":
            preview = self.get_preview(dataset_id, version_id, limit=100, workspace_id=workspace_id, bounded=False)
            recognized = recognize(preview["columns"], preview["rows"])
            columns = [{k: v for k, v in item.items() if k not in {"evidence", "automatic"}}
                       for item in recognized["fields"] if item["automatic"]]
            # A prior operator-approved mapping may be reused only within this dataset,
            # for an unchanged header fingerprint and compatible observed sample types.
            with get_connection(self.database_path) as connection:
                prior = connection.execute(
                    """SELECT v.dataset_version_id FROM dataset_versions v JOIN approvals a
                       ON a.dataset_version_id=v.dataset_version_id WHERE v.dataset_id=?
                       AND v.version_number<? AND a.state='approved' AND (? IS NULL OR v.dataset_version_id=?) ORDER BY v.version_number DESC LIMIT 1""",
                    (dataset_id, version["version_number"], source_profile_version_id, source_profile_version_id),
                ).fetchone()
            if source_profile_version_id and not prior:
                raise DatasetError("Select an approved earlier source profile in this dataset/workspace.")
            if prior:
                previous_mapping=self.get_mapping(dataset_id,prior[0],workspace_id=workspace_id)
                approved=[]
                present=set(preview["columns"])
                from solarpv_ingestion.validation import _type_issue
                for column in (previous_mapping or {}).get("columns",[]):
                    if column["source_column"] not in present:
                        if column.get("is_required"):
                            raise DatasetConflict("A required approved source field is absent; review schema drift before reuse.")
                        continue
                    if column["target_field"]=="power_factor" and not source_profile_version_id:continue
                    candidate=next((c for c in recognized["fields"] if c["source_column"]==column["source_column"]),None)
                    if column.get("measurement_unit"):
                        if candidate and candidate["expected_type"]=="number" and candidate.get("measurement_unit")!=column["measurement_unit"]:
                            if source_profile_version_id:
                                raise DatasetConflict("Source units conflict with the approved profile; review the mapping before reuse.")
                            continue
                        if not candidate and not source_profile_version_id:
                            continue
                    values=[row.get(column["source_column"]) for row in preview["rows"]]
                    compatible=all(v is None or str(v).strip().casefold() in {"","na","n/a","null","none","<null>"} or _type_issue(v,column) is None for v in values)
                    if not compatible and column.get("is_required"):
                        raise DatasetConflict("A required approved field changed representation; review the source profile before reuse.")
                    if compatible:approved.append(column)
                approved_sources={c["source_column"] for c in approved};approved_targets={c["target_field"] for c in approved}
                # An operator-approved compatible interpretation takes precedence over a generic alias.
                columns=[c for c in columns if c["source_column"] not in approved_sources and c["target_field"] not in approved_targets]+approved
            if columns:
                mapping = self.save_mapping(dataset_id, version_id, columns=columns,
                                            idempotency_key=f"automatic-mapping-v2:{source_profile_version_id or 'safe'}", workspace_id=workspace_id)
        version = self.get_version(dataset_id, version_id, workspace_id=workspace_id)
        validation = self.get_validation(version["current_validation_run_id"], workspace_id=workspace_id) if version["current_validation_run_id"] else self.validate(
            dataset_id, version_id, idempotency_key="automatic-validation-v1", workspace_id=workspace_id)
        return {"mapping": mapping, "validation": validation,
                "version": self.get_version(dataset_id, version_id, workspace_id=workspace_id)}

    def explore(self, dataset_id: str, version_id: str, *, workspace_id: str = "default",
                offset: int = 0, limit: int = 25, search: str = "", field: str | None = None,
                start: str | None = None, end: str | None = None, chart_limit: int = 2000,
                quality: str = "", sort: str = "source", source_row: int | None = None, include_chart: bool = True) -> dict:
        from datetime import datetime
        from decimal import Decimal
        import heapq
        from collections import Counter
        from solarpv_ingestion.intelligence import RULE_VERSION, normalize_cell, scientific_warnings
        from solarpv_ingestion.validation import read_records
        from solarpv_ingestion.chart_sampling import ExtremaSampler
        _page(limit, offset)
        if not 5 <= chart_limit <= 2000 or quality not in {"", "valid", "invalid", "warning", "missing", "unresolved", "unmapped"} or sort not in {"source", "source_desc", "value_asc", "value_desc"}:
            raise DatasetError("Invalid chart budget, quality filter or sort order.")
        if len(search) > 500:
            raise DatasetError("Search text must be at most 500 characters.")
        if source_row is not None and source_row < 1:
            raise DatasetError("Source row must be positive.")
        if sort != "source" and offset + limit > 5000:
            raise DatasetError("Sorted browsing is limited to 5,000 rows; narrow search or use source order.")
        version = self.get_version(dataset_id, version_id, workspace_id=workspace_id)
        source = self._source_for_version(version_id, workspace_id)
        if not self.storage.matches(source["storage_key"], sha256=source["sha256"], size_bytes=source["size_bytes"]):
            raise DatasetError("Original source failed checksum verification.")
        mappings = self._get_mapping_rows(version["mapping_revision_id"])
        by_source = {m["source_column"]: m for m in mappings}
        timestamp = next((m["source_column"] for m in mappings if m["target_field"] == "timestamp"), None)
        if (field and (field not in by_source or by_source[field]["expected_type"] not in {"number", "integer"})) or (sort.startswith("value") and not field):
            raise DatasetError("Choose a mapped numeric measurement for value sorting/charting.")
        try:
            lower = datetime.fromisoformat(start.replace("Z", "+00:00")) if start else None
            upper = datetime.fromisoformat(end.replace("Z", "+00:00")) if end else None
            if lower and upper and lower > upper:
                raise ValueError()
        except (ValueError, TypeError) as error:
            raise DatasetError("Time range must use ordered ISO timestamps in the source clock convention.") from error
        run_id = version["current_validation_run_id"]
        issue_rows, row_quality = {}, {}
        if run_id:
            for issue in self.export_validation_issues(run_id, workspace_id=workspace_id):
                row = issue.get("row")
                if row is not None:
                    row_quality[row] = "invalid" if issue["severity"] == "error" else row_quality.get(row, "warning")
                    if issue.get("field") in {field, timestamp}:
                        issue_rows.setdefault(row, []).append(issue["code"])
        headers, records = read_records(self.storage, source["storage_key"], source["original_name"], max_json_bytes=self.max_json_bytes)
        if len(headers) * (version.get("row_count") or 0) > 10_000_000:
            records.close()
            raise DatasetError("Explorer exceeds the 10 million cell processing limit.")
        sampler = ExtremaSampler(chart_limit)
        items, total, selected_heap = [], 0, []
        excluded = missing = 0
        previous_time = previous_interval = None
        intervals = Counter(); coverage_first = coverage_last = None
        filtered_first = filtered_last = None
        plotted_first = plotted_last = None
        latest_reading = None
        display_budget=[200_000]
        def display_value(value):
            return preview_value(value,display_budget)
        def pack(row, record, bounded=True):
            cells={name:normalize_cell(record.get(name),by_source.get(name)) for name in headers}
            statuses={cell["status"] for cell in cells.values()}
            status=row_quality.get(row) or ("invalid" if "invalid" in statuses else "missing" if "missing" in statuses else "unresolved" if "unresolved" in statuses else "unmapped" if "unmapped" in statuses else "valid" if run_id else "not_validated")
            original=source_json_value(record);literals={n:v.source_literal for n,v in record.items() if hasattr(v,"source_literal")};shortened=[]
            if bounded:
                for name in headers:
                    original[name],cut=display_value(literals.get(name,original.get(name)))
                    if cut:shortened.append(name)
                    if name in literals:literals[name]=original[name]
                    cells[name]["value"],cut=display_value(cells[name]["value"])
                    if cut:cells[name]["display_truncated"]=True
            return {"source_row":row,"original":original,"original_literals":literals,"original_truncated":shortened,"normalized":cells,"status":status}
        try:
            for row, record in records:
                need_time = bool((include_chart and field) or lower or upper)
                time_cell=normalize_cell(record.get(timestamp),by_source.get(timestamp)) if timestamp and need_time else {}
                time_text=time_cell.get("value") if time_cell.get("status")=="valid" else None
                parsed=datetime.fromisoformat(time_text) if time_text else None
                # Plot naive timestamps as source-clock seconds, independent of browser timezone/DST.
                seconds=(parsed.timestamp() if parsed.tzinfo else (parsed-datetime(1970,1,1)).total_seconds()) if parsed else None
                if seconds is not None:
                    if coverage_first is None or seconds<coverage_first[0]:coverage_first=(seconds,time_text)
                    if coverage_last is None or seconds>coverage_last[0]:coverage_last=(seconds,time_text)
                delta=None
                if seconds is not None and previous_time is not None:
                    delta=seconds-previous_time
                    if delta>0:intervals[delta]+=1
                # Naive bounds explicitly filter the displayed source clock; no timezone is assigned.
                def outside(bound, is_lower):
                    if parsed is None:return True
                    compare=parsed.replace(tzinfo=None) if bound.tzinfo is None else parsed
                    try:return compare<bound if is_lower else compare>bound
                    except TypeError as error:raise DatasetError("Aware time bounds require aware source timestamps.") from error
                in_time=not ((lower and outside(lower,True)) or (upper and outside(upper,False)))
                cell=normalize_cell(record.get(field),by_source.get(field)) if field and (include_chart or sort.startswith("value")) else {}
                if include_chart and field and run_id and in_time:
                    flags=issue_rows.get(row,[])
                    bad_time=any(code in {"invalid_datetime","invalid_date","timestamp_duplicate","timestamp_out_of_order","timestamp_timezone_mixed"} for code in flags)
                    value=None
                    if cell.get("status")=="valid" and seconds is not None and not bad_time and by_source[field].get("measurement_unit"):
                        try:
                            value=float(cell["value"])
                            if not math.isfinite(value):value=None
                        except (ValueError,TypeError,OverflowError):value=None
                    if delta is not None and delta<=0:value=None;flags=[*flags,"timestamp_order"]
                    break_before=bool(delta is not None and (delta<=0 or previous_interval is not None and delta!=previous_interval)) or "energy_counter_decrease" in flags
                    if value is not None and seconds is not None:
                        if latest_reading is None or seconds >= latest_reading['plot_seconds']:
                            exact = str(cell.get('value'))
                            latest_reading = {'source_row':row,'timestamp':time_text,'plot_seconds':seconds,
                                              'value':value,'value_text':exact[:200],
                                              'value_text_truncated':len(exact)>200,'flags':flags}
                        if plotted_first is None or seconds<plotted_first[0]:plotted_first=(seconds,time_text)
                        if plotted_last is None or seconds>plotted_last[0]:plotted_last=(seconds,time_text)
                    if cell.get("status")=="missing":missing+=1
                    if value is None:excluded+=1
                    if seconds is not None:
                        if filtered_first is None or seconds<filtered_first[0]:filtered_first=(seconds,time_text)
                        if filtered_last is None or seconds>filtered_last[0]:filtered_last=(seconds,time_text)
                    exact_text=str(cell.get('value')) if value is not None else None
                    sampler.add({"source_row":row,"timestamp":time_text,"plot_seconds":seconds,"value":value,
                                 "value_text":exact_text[:200] if exact_text is not None else None,
                                 "value_text_truncated":bool(exact_text and len(exact_text)>200),
                                 "status":cell.get("status"),"flags":flags,"break_before":break_before})
                if seconds is not None:previous_time=seconds
                if delta is not None and delta>0:previous_interval=delta
                # Table filters intentionally do not change chart coverage or sampling.
                if not in_time or source_row is not None and row!=source_row or search.casefold() not in " ".join(str(v) for v in record.values()).casefold():continue
                if quality:
                    if quality in {"missing","unresolved","unmapped"}:
                        if not any(normalize_cell(record.get(n),by_source.get(n))["status"]==quality for n in headers):continue
                    elif pack(row,record,bounded=False)["status"]!=quality:continue
                if sort=="source":
                    if offset<=total<offset+limit:items.append(pack(row,record))
                else:
                    if sort=="source_desc":rank=(-row,)
                    else:
                        present=cell.get("status")=="valid"
                        number=Decimal(cell["value"]) if present else Decimal(0)
                        rank=(0 if present else 1, -number if sort=="value_desc" else number, row)
                    inverse=tuple(-v for v in rank)
                    candidate=(inverse,row)
                    if len(selected_heap)<offset+limit:heapq.heappush(selected_heap,candidate)
                    elif candidate>selected_heap[0]:heapq.heapreplace(selected_heap,candidate)
                total+=1
        finally:records.close()
        if sort!="source":
            ids=[row for _,row in sorted(selected_heap,reverse=True)][offset:offset+limit]
            wanted=set(ids);found={}
            _,again=read_records(self.storage,source["storage_key"],source["original_name"],max_json_bytes=self.max_json_bytes)
            try:
                for row,record in again:
                    if row in wanted:found[row]=pack(row,record)
                    if len(found)==len(wanted):break
            finally:again.close()
            items=[found[row] for row in ids]
        current=self.get_version(dataset_id,version_id,workspace_id=workspace_id)
        if current["mapping_revision_id"]!=version["mapping_revision_id"] or current["current_validation_run_id"]!=run_id:
            raise DatasetConflict("Dataset mapping or validation changed during inspection. Retry the view.")
        points=sampler.points()
        mode=intervals.most_common(1)
        warnings=scientific_warnings(headers,mappings)
        return {"columns":headers,"items":items,"total":total,"offset":offset,"limit":limit,"scientific_warnings":warnings,
          "chart":{"points":points,"truncated":False,"downsampled":sampler.count>len(points),"source_count":sampler.count,
            "latest_reading":latest_reading,
            "unit_interpretation":"unresolved" if any(w['field']==field for w in warnings) else "mapped" if field else "not_selected",
            "returned_points":len(points),"sampling":"Streaming first/min/max/last extrema per source-order bucket; gapped buckets are disconnected" if sampler.stride>1 else "Every selected source row",
            "excluded_count":excluded,"missing_count":missing,"unit":normalize_cell("1",by_source.get(field)).get("unit") if field else None,
            "timestamp_field":timestamp,"validation_run_id":run_id,
            "source_time_range":[coverage_first[1],coverage_last[1]] if coverage_first else None,
            "selected_time_range":[filtered_first[1],filtered_last[1]] if filtered_first else None,
            "plotted_time_range":[plotted_first[1],plotted_last[1]] if plotted_first else None,
            "observed_cadence":{"most_common_seconds":mode[0][0] if mode else None,"matching_intervals":mode[0][1] if mode else 0,"positive_intervals":sum(intervals.values()),"basis":"Observed source timestamp differences; filename not used; not an expected sampling contract"},
            "scope":"Full selected time range; table search/quality/sort does not filter chart; no interpolation"},
          "provenance":{"source_sha256":version["source_sha256"],"source_file_id":version["source_file_id"],"mapping_revision_id":version["mapping_revision_id"],"rule_version":RULE_VERSION}}

    def save_mapping(self, dataset_id: str, version_id: str, *, columns: list[dict],
                     idempotency_key: str, workspace_id: str = "default", expected_mapping_revision_id: str | None = None) -> dict:
        if expected_mapping_revision_id is not None:
            expected_mapping_revision_id = _required_text(expected_mapping_revision_id, "expected_mapping_revision_id", 200)
        if not isinstance(columns, list) or len(columns) > 500:
            raise DatasetError("Mapping must be an array of at most 500 column mappings.")
        key = _required_text(idempotency_key, "idempotency_key", 200)
        normalized = [_normalize_mapping(item) for item in columns]
        if len({item["source_column"] for item in normalized}) != len(normalized):
            raise DatasetError("Each source column can be mapped only once.")
        if len({item["target_field"] for item in normalized}) != len(normalized):
            raise DatasetError("Each target field can be mapped only once per revision.")
        fingerprint = _fingerprint(normalized)
        mapping_id = uuid4().hex
        with get_connection(self.database_path) as connection:
            connection.execute("BEGIN IMMEDIATE")
            version = self._require_version(connection, dataset_id, version_id, workspace_id)
            prior = connection.execute(
                "SELECT * FROM dataset_mapping_revisions WHERE dataset_version_id = ? AND idempotency_key = ?",
                (version_id, key),
            ).fetchone()
            if prior:
                if prior["fingerprint"] != fingerprint:
                    raise DatasetConflict("Mapping idempotency key was reused with different content.")
                return self._mapping_dict(connection, prior["mapping_revision_id"])
            if expected_mapping_revision_id is not None and version["mapping_revision_id"] != expected_mapping_revision_id:
                raise DatasetConflict("The mapping changed in another request. Reload it before saving.")
            if version["state"] != "draft":
                raise DatasetConflict("Mappings are frozen after validation begins.")
            revision_number = connection.execute(
                "SELECT COALESCE(MAX(revision_number), 0) + 1 FROM dataset_mapping_revisions WHERE dataset_version_id = ?",
                (version_id,),
            ).fetchone()[0]
            connection.execute(
                "INSERT INTO dataset_mapping_revisions(mapping_revision_id, dataset_version_id, revision_number, fingerprint, idempotency_key) VALUES (?, ?, ?, ?, ?)",
                (mapping_id, version_id, revision_number, fingerprint, key),
            )
            for column in normalized:
                connection.execute(
                    """INSERT INTO dataset_column_mappings(
                        column_mapping_id, mapping_revision_id, source_column, target_field,
                        expected_type, is_required, measurement_unit, timestamp_format, timezone, value_scale
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (uuid4().hex, mapping_id, column["source_column"], column["target_field"],
                     column["expected_type"], int(column["is_required"]), column["measurement_unit"],
                     column["timestamp_format"], column["timezone"], column["value_scale"]),
                )
            connection.execute(
                "UPDATE dataset_versions SET mapping_revision_id = ?, current_validation_run_id = NULL WHERE dataset_version_id = ?",
                (mapping_id, version_id),
            )
            connection.execute(
                "UPDATE datasets SET updated_at = CURRENT_TIMESTAMP WHERE dataset_id = ?", (dataset_id,)
            )
            return self._mapping_dict(connection, mapping_id)

    def get_mapping(self, dataset_id: str, version_id: str, *, workspace_id: str = "default") -> dict | None:
        version = self.get_version(dataset_id, version_id, workspace_id=workspace_id)
        if version["mapping_revision_id"] is None:
            return None
        with get_connection(self.database_path) as connection:
            return self._mapping_dict(connection, version["mapping_revision_id"])

    def validate(self, dataset_id: str, version_id: str, *, idempotency_key: str,
                 workspace_id: str = "default", policy: dict | None = None) -> dict:
        policy = validate_policy(policy)
        key = _required_text(idempotency_key, "idempotency_key", 200)
        version = self.get_version(dataset_id, version_id, workspace_id=workspace_id)
        source = self._source_for_version(version_id, workspace_id)
        if not self.storage.matches(source["storage_key"], sha256=source["sha256"], size_bytes=source["size_bytes"]):
            raise DatasetError("Original source does not match its recorded fingerprint.")
        artifact = self.repository.get_artifact(version["source_artifact_id"])
        if artifact is None:
            raise DatasetError("Processing result metadata is unavailable.")
        result = self._read_processing_result(artifact)
        if (result.get("source", {}).get("source_file_id") != source["source_file_id"]
                or result.get("source", {}).get("sha256") != source["sha256"]
                or result.get("processing", {}).get("parser_id") != artifact.parser_id
                or result.get("processing", {}).get("parser_version") != artifact.parser_version
                or result.get("schema_version") != artifact.schema_version):
            raise DatasetError("Processing result provenance does not match its source metadata.")
        input_fingerprint = _fingerprint({
            "source_file_id": source["source_file_id"], "source_sha256": source["sha256"],
            "source_artifact_id": artifact.artifact_id,
            "processing_result_checksum": artifact.checksum,
            "result_schema_version": artifact.schema_version,
            "parser_id": artifact.parser_id,
            "parser_version": artifact.parser_version,
            "mapping_revision_id": version["mapping_revision_id"],
            "rule_set_version": VALIDATION_RULE_SET,
            "telemetry_rule_version": TELEMETRY_RULE_VERSION,
            "policy": policy,
        })
        with get_connection(self.database_path) as connection:
            prior = connection.execute(
                "SELECT * FROM validation_runs WHERE dataset_version_id = ? AND idempotency_key = ?",
                (version_id, key),
            ).fetchone()
            if prior:
                if prior["input_fingerprint"] != input_fingerprint:
                    raise DatasetConflict("Validation idempotency key was reused with different inputs.")
                return self.get_validation(prior["validation_run_id"], workspace_id=workspace_id)
            pending = connection.execute(
                "SELECT 1 FROM approvals WHERE dataset_version_id = ? AND state = 'pending' LIMIT 1",
                (version_id,),
            ).fetchone()
        if pending:
            raise DatasetConflict("A validation result under review cannot be replaced.")
        if version["state"] not in {"draft", "validating"}:
            raise DatasetConflict("A validated dataset version is immutable; create a new version to change its inputs.")

        mappings = self._get_mapping_rows(version["mapping_revision_id"])
        for field, limits in policy.get("equipment_limits", {}).items():
            if not any(m["source_column"] == field and m.get("measurement_unit") == limits["unit"] and m["expected_type"] in {"number", "integer"} for m in mappings):
                raise DatasetError("Equipment limits require a mapped numeric source field with the same documented unit.")
        issues = tempfile.SpooledTemporaryFile(max_size=1024 * 1024, mode="w+b")
        issue_count = 0
        issue_bytes = 0

        def write_issue(issue: dict) -> None:
            nonlocal issue_count, issue_bytes
            issue_count += 1
            if issue_count > MAX_ISSUE_COUNT:
                raise ValidationResourceLimitError(
                    f"Validation exceeds the {MAX_ISSUE_COUNT:,}-finding detail limit."
                )
            encoded_issue = (_canonical_json(issue) + "\n").encode("utf-8")
            issue_bytes += len(encoded_issue)
            if issue_bytes > MAX_ISSUE_ARTIFACT_BYTES:
                raise ValidationResourceLimitError(
                    f"Validation details exceed the {MAX_ISSUE_ARTIFACT_BYTES // (1024 * 1024)} MB limit."
                )
            issues.write(encoded_issue)

        try:
            report = validate_records(
                self.storage, source["storage_key"], source["original_name"], mappings,
                max_json_bytes=self.max_json_bytes, issue_sink=write_issue, policy=policy,
            )
        except ValidationResourceLimitError as error:
            issues.close()
            raise DatasetError(str(error)) from error
        except InvalidInputError as error:
            malformed_issue = {"severity": "error", "row": None, "field": None,
                               "code": "malformed_dataset", "message": str(error)[:300]}
            write_issue(malformed_issue)
            report = {
                "rule_set_version": VALIDATION_RULE_SET, "outcome": "failed", "row_count": 0,
                "error_count": 1, "warning_count": 0,
                "error_details_truncated": False, "warning_details_truncated": False,
                "errors": [{"row": None, "field": None, "code": "malformed_dataset", "message": str(error)[:300]}],
                "warnings": [], "limits": {"max_error_details": 1},
            }
        issues.seek(0)
        issue_artifact_key = None
        issue_artifact_checksum = None
        staged_issues = None
        try:
            if issue_count:
                staged_issues = self.storage.stage_stream(issues, max_bytes=MAX_ISSUE_ARTIFACT_BYTES)
                issue_artifact_key = f"dataset-validations/{uuid4().hex}.jsonl"
                issue_artifact_checksum = staged_issues.sha256
        finally:
            issues.close()
        if issue_artifact_key:
            report["issue_details"] = {
                "storage_key": issue_artifact_key,
                "sha256": issue_artifact_checksum,
                "size_bytes": staged_issues.size_bytes,
                "count": issue_count,
                "available": True,
            }
        else:
            report["issue_details"] = {"count": 0, "available": False}
        report.setdefault("affected_record_count", 0)
        report.setdefault("affected_column_count", 0)
        report.update({
            "dataset_id": dataset_id, "dataset_version_id": version_id,
            "source_file_id": source["source_file_id"], "source_sha256": source["sha256"],
            "processing_job_id": version["source_job_id"], "parser_id": artifact.parser_id,
            "parser_version": artifact.parser_version,
            "source_artifact_id": artifact.artifact_id,
            "processing_result_checksum": artifact.checksum,
            "result_schema_version": artifact.schema_version,
            "mapping_revision_id": version["mapping_revision_id"],
            "input_fingerprint": input_fingerprint,
        })
        try:
            encoded = _canonical_json(report).encode("utf-8")
            if len(encoded) > MAX_RESULT_BYTES:
                raise DatasetError("Validation report exceeds its 1 MB storage limit.")
        except Exception:
            if staged_issues is not None:
                self.storage.discard(staged_issues)
            raise
        validation_id = uuid4().hex
        # Keep the private storage key short enough for Windows paths. The
        # immutable validation ID and database provenance provide association.
        result_key = f"dataset-validations/{validation_id}.json"
        checksum = hashlib.sha256(encoded).hexdigest()
        try:
            if staged_issues is not None:
                self.storage.publish(staged_issues, issue_artifact_key)
                self.storage.release_staged(staged_issues)
            self.storage.put_bytes(result_key, encoded)
            with get_connection(self.database_path) as connection:
                connection.execute("BEGIN IMMEDIATE")
                current = self._require_version(connection, dataset_id, version_id, workspace_id)
                if current["state"] not in {"draft", "validating"} or current["mapping_revision_id"] != version["mapping_revision_id"]:
                    raise DatasetConflict("Dataset inputs changed during validation.")
                if connection.execute(
                    "SELECT 1 FROM approvals WHERE dataset_version_id = ? AND state = 'pending' LIMIT 1",
                    (version_id,),
                ).fetchone():
                    raise DatasetConflict("A review was opened while validation was running.")
                connection.execute(
                    """INSERT INTO validation_runs(
                        validation_run_id, dataset_version_id, rule_set_version, outcome,
                        result_key, source_sha256, parser_id, parser_version,
                        source_file_id, source_artifact_id, processing_result_checksum,
                        result_schema_version, mapping_revision_id, input_fingerprint, result_checksum,
                        error_count, warning_count, idempotency_key
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (validation_id, version_id, VALIDATION_RULE_SET, report["outcome"], result_key,
                     source["sha256"], artifact.parser_id, artifact.parser_version,
                     source["source_file_id"], artifact.artifact_id, artifact.checksum,
                     artifact.schema_version,
                     version["mapping_revision_id"], input_fingerprint, checksum,
                     report["error_count"], report["warning_count"], key),
                )
                scale_review_required = any(
                    warning.get("code") == "power_factor_percent_scale_review"
                    for warning in report.get("warnings", [])
                )
                if current["state"] == "draft" and not scale_review_required:
                    connection.execute(
                        "UPDATE dataset_versions SET state = 'validating' WHERE dataset_version_id = ?",
                        (version_id,),
                    )
                connection.execute(
                    "UPDATE dataset_versions SET current_validation_run_id = ? WHERE dataset_version_id = ?",
                    (validation_id, version_id),
                )
                if not scale_review_required:
                    target = "invalid" if report["error_count"] else "valid"
                    connection.execute(
                        "UPDATE dataset_versions SET state = ? WHERE dataset_version_id = ?",
                        (target, version_id),
                    )
                connection.execute(
                    "UPDATE datasets SET updated_at = CURRENT_TIMESTAMP WHERE dataset_id = ?", (dataset_id,)
                )
                row = connection.execute(
                    "SELECT * FROM validation_runs WHERE validation_run_id = ?", (validation_id,)
                ).fetchone()
        except Exception:
            self.storage.delete_uncommitted(result_key)
            if issue_artifact_key:
                self.storage.delete_uncommitted(issue_artifact_key)
            if staged_issues is not None:
                self.storage.discard(staged_issues)
            raise
        report["validation_run_id"] = validation_id
        report["result_checksum"] = checksum
        report["issue_details_available"] = bool((report.get("issue_details") or {}).get("available"))
        report["issue_details_count"] = int((report.get("issue_details") or {}).get("count", 0))
        report.pop("issue_details", None)
        return report

    def get_validation(self, validation_id: str, *, workspace_id: str = "default") -> dict:
        with get_connection(self.database_path) as connection:
            row = connection.execute(
                """SELECT validation.* FROM validation_runs validation
                   JOIN dataset_versions version ON version.dataset_version_id=validation.dataset_version_id
                   JOIN datasets dataset ON dataset.dataset_id=version.dataset_id
                   WHERE validation.validation_run_id=? AND dataset.workspace_id=?""",
                (validation_id, workspace_id),
            ).fetchone()
        if row is None:
            raise DatasetNotFound(validation_id)
        if not row["result_key"] or not row["result_checksum"]:
            raise DatasetError("Validation result artifact is unavailable.")
        content = self.storage.read_bytes(row["result_key"])
        if hashlib.sha256(content).hexdigest() != row["result_checksum"]:
            raise DatasetError("Validation result failed checksum verification.")
        try:
            result = json.loads(content.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise DatasetError("Validation result artifact is malformed.") from error
        result["validation_run_id"] = validation_id
        result["result_checksum"] = row["result_checksum"]
        issue_details = result.get("issue_details") or {}
        result["issue_details_available"] = bool(issue_details.get("available"))
        result["issue_details_count"] = int(issue_details.get("count", 0))
        result.pop("issue_details", None)
        return result

    def get_validation_issue_groups(self, validation_id: str, *, workspace_id: str = "default",
                                    severity: str | None = None, field: str | None = None,
                                    category: str | None = None, search: str | None = None,
                                    offset: int = 0, limit: int | None = None) -> dict:
        from solarpv_ingestion.diagnosis import category_for, CATEGORIES
        if severity not in {None,'error','warning'} or category is not None and category not in {*CATEGORIES,'integrity'}:
            raise DatasetError('Choose a supported severity or issue category.')
        if offset < 0 or limit is not None and not 1 <= limit <= 100 or search is not None and len(search)>500:
            raise DatasetError('Issue groups require bounded pagination and search.')
        report, stream = self._open_issue_details(validation_id, workspace_id)
        groups: dict[tuple[str, str, str], dict] = {}
        try:
            for line in stream:
                issue = json.loads(line)
                if severity and issue['severity']!=severity or field and issue.get('field')!=field or category and category_for(issue['code'])!=category:
                    continue
                if not _issue_matches_search(issue, search):
                    continue
                identity = (issue["severity"], issue.get("field") or "", issue["code"])
                group = groups.get(identity)
                if group is None:
                    group = {"severity": identity[0], "field": identity[1] or None,
                             "code": identity[2], "message": issue["message"],
                             "count": 0, "affected_record_count": 0,
                             "_last_row": None, "examples": []}
                    groups[identity] = group
                group["count"] += 1
                if issue.get("row") is not None and issue["row"] != group["_last_row"]:
                    group["affected_record_count"] += 1
                    group["_last_row"] = issue["row"]
                group["recommended_action"] = _validation_issue_action(identity[2])
                if len(group["examples"]) < 2:
                    group["examples"].append({key: value for key, value in issue.items()
                                              if key in {"row", "observed_value_preview", "observed_value_truncated"}})
        finally:
            stream.close()
        order = {"error": 0, "warning": 1}
        items = sorted(groups.values(), key=lambda item: (-item["count"], order.get(item["severity"], 2), item["field"] or "", item["code"]))
        for item in items:
            item.pop("_last_row", None)
            item['category']=category_for(item['code'])
            item['blocks_registration']=item['severity']=='error' or item['category']=='interpretation'
        return {"validation_run_id": validation_id, "total_issues": int(report.get("error_count", 0)) + int(report.get("warning_count", 0)),
                'total_groups':len(items),'matching_issues':sum(item['count'] for item in items),'offset':offset,'limit':limit,
                "groups": items[offset:offset+limit] if limit is not None else items[offset:]}

    def get_validation_issues(self, validation_id: str, *, workspace_id: str = "default",
                              severity: str | None = None, field: str | None = None,
                              code: str | None = None, category: str | None = None,
                              search: str | None = None, offset: int = 0, limit: int = 50) -> dict:
        from solarpv_ingestion.diagnosis import category_for, CATEGORIES
        if category is not None and category not in {*CATEGORIES, "integrity"}:
            raise DatasetError("Unknown diagnosis category.")
        if severity not in {None, "error", "warning"}:
            raise DatasetError("Severity must be error or warning.")
        if offset < 0 or not 1 <= limit <= 100:
            raise DatasetError("Issue pagination requires a nonnegative offset and a limit from 1 to 100.")
        _, stream = self._open_issue_details(validation_id, workspace_id)
        matches = []
        total = 0
        needle = (search or "").strip().casefold()
        try:
            for line in stream:
                issue = json.loads(line)
                if category and category_for(issue["code"]) != category:
                    continue
                if severity and issue["severity"] != severity:
                    continue
                if field and issue.get("field") != field:
                    continue
                if code and issue.get("code") != code:
                    continue
                if not _issue_matches_search(issue, needle):
                    continue
                if offset <= total < offset + limit:
                    matches.append(issue)
                total += 1
        finally:
            stream.close()
        return {"validation_run_id": validation_id, "offset": offset, "limit": limit,
                "total": total, "items": matches}

    def export_validation_issues(self, validation_id: str, *, workspace_id: str = "default",
                                 severity: str | None = None, field: str | None = None, code: str | None = None,
                                 search: str | None = None, category: str | None = None):
        from solarpv_ingestion.diagnosis import category_for, CATEGORIES
        if category is not None and category not in {*CATEGORIES, "integrity"}:
            raise DatasetError("Unknown diagnosis category.")
        if severity not in {None, "error", "warning"} or search is not None and len(search)>500:
            raise DatasetError("Choose a supported severity and bounded search.")
        # Resolve identity, workspace and integrity before response headers are sent.
        _, stream = self._open_issue_details(validation_id, workspace_id)
        def selected():
            try:
                for line in stream:
                    issue = json.loads(line)
                    if category and category_for(issue["code"]) != category:
                        continue
                    if severity and issue["severity"] != severity:
                        continue
                    if field and issue.get("field") != field:
                        continue
                    if code and issue.get("code") != code:
                        continue
                    needle = (search or "").strip().casefold()
                    if not _issue_matches_search(issue, needle):
                        continue
                    yield issue
            finally:
                stream.close()
        return selected()

    def _open_issue_details(self, validation_id: str, workspace_id: str):
        report = self.get_validation(validation_id, workspace_id=workspace_id)
        with get_connection(self.database_path) as connection:
            row = connection.execute(
                "SELECT result_key FROM validation_runs WHERE validation_run_id = ?", (validation_id,)
            ).fetchone()
        if row is None:
            raise DatasetNotFound(validation_id)
        raw = json.loads(self.storage.read_bytes(row["result_key"]).decode("utf-8"))
        details = raw.get("issue_details") or {}
        if not details.get("available") or not details.get("storage_key"):
            return report, io.BytesIO(b"")
        if not self.storage.matches(details["storage_key"], sha256=details["sha256"], size_bytes=details["size_bytes"]):
            raise DatasetError("Validation issue details failed integrity verification.")
        return report, self.storage.open_read(details["storage_key"])

    def create_approval(self, dataset_id: str, version_id: str, *, validation_run_id: str,
                        idempotency_key: str, workspace_id: str = "default") -> dict:
        key = _required_text(idempotency_key, "idempotency_key", 200)
        fingerprint = _fingerprint({"dataset_id": dataset_id, "version_id": version_id, "validation_run_id": validation_run_id})
        approval_id = uuid4().hex
        verified_report = self.get_validation(validation_run_id, workspace_id=workspace_id)
        original = self._source_for_version(version_id, workspace_id)
        if not self.storage.matches(original["storage_key"], sha256=original["sha256"], size_bytes=original["size_bytes"]):
            raise DatasetError("Original source integrity must be restored before review.")
        with get_connection(self.database_path) as connection:
            connection.execute("BEGIN IMMEDIATE")
            version = self._require_version(connection, dataset_id, version_id, workspace_id)
            if version["state"] != "valid" or version["current_validation_run_id"] != validation_run_id:
                raise DatasetConflict("Approval requires the current validation for a valid version.")
            run = connection.execute(
                "SELECT * FROM validation_runs WHERE validation_run_id = ? AND dataset_version_id = ?",
                (validation_run_id, version_id),
            ).fetchone()
            if run is None or run["outcome"] not in {"passed", "warnings"} or run["error_count"] != 0:
                raise DatasetConflict("Validation errors must be resolved before review.")
            prior = connection.execute(
                "SELECT * FROM approvals WHERE dataset_version_id = ? AND idempotency_key = ?",
                (version_id, key),
            ).fetchone()
            if prior:
                if prior["validation_run_id"] != validation_run_id:
                    raise DatasetConflict("Approval idempotency key was reused with different validation.")
                return self._approval_dict(prior)
            existing = connection.execute(
                "SELECT * FROM approvals WHERE dataset_version_id=? AND state IN ('pending','approved') ORDER BY created_at LIMIT 1",
                (version_id,),
            ).fetchone()
            if existing:
                if existing["validation_run_id"] != validation_run_id:
                    raise DatasetConflict("An existing review references different validation inputs.")
                return self._approval_dict(existing)
            if verified_report.get("telemetry_rule_version") != TELEMETRY_RULE_VERSION:
                raise DatasetConflict("Current scientific validation is required before a new review.")
            connection.execute(
                """INSERT INTO approvals(
                    approval_id, dataset_version_id, validation_run_id, state, idempotency_key
                ) VALUES (?, ?, ?, 'pending', ?)""",
                (approval_id, version_id, validation_run_id, key),
            )
            row = connection.execute("SELECT * FROM approvals WHERE approval_id = ?", (approval_id,)).fetchone()
            connection.execute(
                "UPDATE datasets SET updated_at = CURRENT_TIMESTAMP WHERE dataset_id = ?", (dataset_id,)
            )
            return self._approval_dict(row)

    def decide_approval(self, approval_id: str, *, decision: str, reviewer_identity: str,
                        workspace_id: str = "default") -> dict:
        try:
            target = ApprovalState(decision)
        except ValueError as error:
            raise DatasetError("Decision must be approved or rejected.") from error
        if target not in {ApprovalState.APPROVED, ApprovalState.REJECTED}:
            raise DatasetError("Decision must be approved or rejected.")
        reviewer = _required_text(reviewer_identity, "reviewer_identity", 200)
        if target == ApprovalState.APPROVED:
            existing = self.get_approval(approval_id, workspace_id=workspace_id)
            verified_report = self.get_validation(existing["validation_run_id"], workspace_id=workspace_id)
            if existing["state"] != "approved" and verified_report.get("telemetry_rule_version") != TELEMETRY_RULE_VERSION:
                raise DatasetConflict("Current scientific validation is required before approval.")
            original = self._source_for_version(existing["dataset_version_id"], workspace_id)
            if not self.storage.matches(original["storage_key"], sha256=original["sha256"], size_bytes=original["size_bytes"]):
                raise DatasetError("Original source failed integrity verification; approval was not recorded.")
        try:
            self.repository.transition_approval(
                approval_id, target, decision_by=reviewer, idempotent=True,
                workspace_id=workspace_id,
            )
        except KeyError as error:
            raise DatasetNotFound(approval_id) from error
        except (InvalidStateTransition, ValueError) as error:
            raise DatasetConflict(str(error)) from error
        with get_connection(self.database_path) as connection:
            row = connection.execute(
                """SELECT approval.* FROM approvals approval
                   JOIN dataset_versions version ON version.dataset_version_id=approval.dataset_version_id
                   JOIN datasets dataset ON dataset.dataset_id=version.dataset_id
                   WHERE approval.approval_id=? AND dataset.workspace_id=?""",
                (approval_id, workspace_id),
            ).fetchone()
            if row is not None:
                connection.execute(
                    """UPDATE datasets SET updated_at = CURRENT_TIMESTAMP
                       WHERE dataset_id = (SELECT dataset_id FROM dataset_versions WHERE dataset_version_id = ?)""",
                    (row["dataset_version_id"],),
                )
        return self._approval_dict(row)

    def get_approval(self, approval_id: str, *, workspace_id: str = "default") -> dict:
        with get_connection(self.database_path) as connection:
            row = connection.execute(
                """SELECT approval.* FROM approvals approval
                   JOIN dataset_versions version ON version.dataset_version_id = approval.dataset_version_id
                   JOIN datasets dataset ON dataset.dataset_id = version.dataset_id
                   WHERE approval.approval_id = ? AND dataset.workspace_id = ?""", (approval_id, workspace_id)
            ).fetchone()
        if row is None:
            raise DatasetNotFound(approval_id)
        return self._approval_dict(row)

    def _processed_job(self, connection, job_id: str, workspace_id: str):
        row = connection.execute(
            """SELECT file.*, job.state AS job_state, job.workspace_id AS job_workspace,
                      runtime.state AS runtime_state,
                      artifact.*
               FROM ingestion_jobs job
               JOIN ingestion_job_runtime runtime ON runtime.job_id = job.job_id
               JOIN source_files file ON file.source_file_id = job.source_file_id
               JOIN extraction_artifacts artifact ON artifact.job_id = job.job_id
               WHERE job.job_id = ? AND job.workspace_id = ?
                 AND artifact.artifact_type = 'processing_result'
               ORDER BY artifact.created_at DESC LIMIT 1""", (job_id, workspace_id)
        ).fetchone()
        if (row is None or row["job_state"] != "succeeded" or row["runtime_state"] != "succeeded"
                or row["state"] != "available" or row["job_workspace"] != workspace_id
                or row["workspace_id"] != workspace_id):
            raise DatasetError("Dataset registration requires a successful job and available source in this workspace.")
        source = connection.execute("SELECT * FROM source_files WHERE source_file_id = ?", (row["source_file_id"],)).fetchone()
        artifact = connection.execute("SELECT * FROM extraction_artifacts WHERE artifact_id = ?", (row["artifact_id"],)).fetchone()
        if not self.storage.matches(source["storage_key"], sha256=source["sha256"], size_bytes=source["size_bytes"]):
            raise DatasetError("Original source does not match its recorded fingerprint.")
        result = self._read_processing_result(artifact)
        if (result.get("source", {}).get("source_file_id") != source["source_file_id"]
                or result.get("source", {}).get("sha256") != source["sha256"]
                or result.get("processing", {}).get("parser_id") != artifact["parser_id"]
                or result.get("processing", {}).get("parser_version") != artifact["parser_version"]
                or result.get("schema_version") != artifact["schema_version"]
                or result.get("source", {}).get("size_bytes") != source["size_bytes"]):
            raise DatasetError("Processing result provenance does not match its source metadata.")
        return source, artifact, result["profile"]

    def _read_processing_result(self, artifact) -> dict:
        try:
            content = self.storage.read_bytes(artifact["storage_key"] if isinstance(artifact, sqlite3.Row) else artifact.storage_key)
            checksum = artifact["checksum"] if isinstance(artifact, sqlite3.Row) else artifact.checksum
            if hashlib.sha256(content).hexdigest() != checksum:
                raise DatasetError("Processing result checksum verification failed.")
            result = json.loads(content.decode("utf-8"))
        except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
            raise DatasetError("Processing result is unavailable or malformed.") from error
        if not isinstance(result, dict) or not isinstance(result.get("profile"), dict):
            raise DatasetError("Processing result does not contain a valid profile.")
        return result

    def _find_request(self, connection, key: str, fingerprint: str, workspace_id: str):
        row = connection.execute(
            "SELECT * FROM dataset_version_requests WHERE workspace_id = ? AND idempotency_key = ?",
            (workspace_id, key),
        ).fetchone()
        if row and row["request_fingerprint"] != fingerprint:
            raise DatasetConflict("Dataset idempotency key was reused with different request content.")
        return row

    def _require_version(self, connection, dataset_id: str, version_id: str,
                         workspace_id: str = "default"):
        row = connection.execute(
            """SELECT version.*, dataset.workspace_id FROM dataset_versions version
               JOIN datasets dataset ON dataset.dataset_id = version.dataset_id
               WHERE version.dataset_version_id = ? AND version.dataset_id = ?
                 AND dataset.workspace_id = ?""", (version_id, dataset_id, workspace_id)
        ).fetchone()
        if row is None:
            raise DatasetNotFound(version_id)
        return row

    def _version_dict(self, connection, version_id: str,
                      workspace_id: str = "default") -> dict:
        row = connection.execute(
            """SELECT version.*, dataset.name, dataset.workspace_id, source.source_file_id
               FROM dataset_versions version JOIN datasets dataset ON dataset.dataset_id = version.dataset_id
               LEFT JOIN dataset_sources source ON source.dataset_version_id = version.dataset_version_id
               WHERE version.dataset_version_id = ? AND dataset.workspace_id = ?
               ORDER BY source.dataset_source_id LIMIT 1""",
            (version_id, workspace_id),
        ).fetchone()
        if row is None:
            raise DatasetNotFound(version_id)
        return self._version_dict_from_row(row)

    @staticmethod
    def _version_dict_from_row(row) -> dict:
        profile = None
        if row["profile_json"]:
            try:
                profile = json.loads(row["profile_json"])
            except json.JSONDecodeError:
                profile = None
        return {"dataset_id": row["dataset_id"], "dataset_version_id": row["dataset_version_id"],
                "workspace_id": row["workspace_id"], "name": row["name"],
                "version_number": row["version_number"], "state": row["state"],
                "source_file_id": row["source_file_id"], "source_job_id": row["source_job_id"],
                "source_artifact_id": row["source_artifact_id"], "source_sha256": row["source_sha256"],
                "row_count": row["row_count"], "schema_version": row["schema_version"],
                "mapping_revision_id": row["mapping_revision_id"],
                "current_validation_run_id": row["current_validation_run_id"],
                "profile": profile, "created_at": row["created_at"]}

    @staticmethod
    def _mapping_dict(connection, mapping_id: str) -> dict:
        revision = connection.execute(
            "SELECT * FROM dataset_mapping_revisions WHERE mapping_revision_id = ?", (mapping_id,)
        ).fetchone()
        columns = connection.execute(
            "SELECT source_column, target_field, expected_type, is_required, measurement_unit, timestamp_format, timezone, value_scale FROM dataset_column_mappings WHERE mapping_revision_id = ? ORDER BY source_column",
            (mapping_id,),
        ).fetchall()
        return {"mapping_revision_id": revision["mapping_revision_id"],
                "dataset_version_id": revision["dataset_version_id"],
                "revision_number": revision["revision_number"], "fingerprint": revision["fingerprint"],
                "columns": [{**dict(item), "is_required": bool(item["is_required"])} for item in columns]}

    def _get_mapping_rows(self, mapping_id: str | None) -> list[dict]:
        if mapping_id is None:
            return []
        with get_connection(self.database_path) as connection:
            return [dict(row) for row in connection.execute(
                "SELECT * FROM dataset_column_mappings WHERE mapping_revision_id = ? ORDER BY source_column",
                (mapping_id,),
            ).fetchall()]

    def _source_for_version(self, version_id: str, workspace_id: str = "default"):
        with get_connection(self.database_path) as connection:
            row = connection.execute(
                """SELECT file.* FROM dataset_sources source
                   JOIN source_files file ON file.source_file_id = source.source_file_id
               WHERE source.dataset_version_id = ? AND file.workspace_id = ?
               ORDER BY source.dataset_source_id LIMIT 1""",
            (version_id, workspace_id),
            ).fetchone()
        if row is None:
            raise DatasetError("Dataset source is unavailable.")
        return row

    @staticmethod
    def _validation_result(row) -> dict:
        return {"validation_run_id": row["validation_run_id"], "dataset_version_id": row["dataset_version_id"],
                "rule_set_version": row["rule_set_version"], "outcome": row["outcome"],
                "source_sha256": row["source_sha256"], "parser_id": row["parser_id"],
                "parser_version": row["parser_version"], "mapping_revision_id": row["mapping_revision_id"],
                "source_file_id": row["source_file_id"], "source_artifact_id": row["source_artifact_id"],
                "processing_result_checksum": row["processing_result_checksum"],
                "result_schema_version": row["result_schema_version"],
                "input_fingerprint": row["input_fingerprint"], "result_checksum": row["result_checksum"],
                "error_count": row["error_count"], "warning_count": row["warning_count"]}

    @staticmethod
    def _approval_dict(row) -> dict:
        return {"approval_id": row["approval_id"], "dataset_version_id": row["dataset_version_id"],
                "validation_run_id": row["validation_run_id"], "state": row["state"],
                "reviewer_identity": row["decision_by"], "decision_at": row["decision_at"],
                "created_at": row["created_at"]}


def _required_text(value, field: str, maximum: int) -> str:
    if not isinstance(value, str) or not value.strip() or len(value.strip()) > maximum:
        raise DatasetError(f"{field} must be a non-empty string of at most {maximum} characters.")
    return value.strip()


def _normalize_mapping(value: dict) -> dict:
    if not isinstance(value, dict):
        raise DatasetError("Each mapping must be an object.")
    source = value.get("source_column")
    if not isinstance(source,str) or not source.strip() or len(source)>500:
        raise DatasetError("source_column must identify an original nonempty source header of at most 500 characters.")
    target = _required_text(value.get("target_field"), "target_field", 200)
    expected = value.get("expected_type")
    if expected not in {"string", "integer", "number", "boolean", "date", "datetime"}:
        raise DatasetError("expected_type must be string, integer, number, boolean, date, or datetime.")
    if target in EXPECTED_UNITS and expected not in {"number", "integer"}:
        raise DatasetError("Recognized scientific measurements require a numeric mapping type.")
    if target == "timestamp" and expected not in {"date", "datetime"}:
        raise DatasetError("Timestamp mappings require an explicit date or datetime convention.")
    required = value.get("is_required", False)
    if not isinstance(required, bool):
        raise DatasetError("is_required must be a boolean.")
    optional = {}
    for field, max_len in (("measurement_unit", 100), ("timestamp_format", 100), ("timezone", 100)):
        item = value.get(field)
        if item is not None and (not isinstance(item, str) or len(item) > max_len):
            raise DatasetError(f"{field} must be a string of at most {max_len} characters.")
        optional[field] = item.strip() if isinstance(item, str) and item.strip() else None
    if expected != "datetime" and (optional["timestamp_format"] or optional["timezone"]):
        raise DatasetError("Timestamp format and timezone apply only to datetime mappings.")
    value_scale = value.get("value_scale")
    if value_scale is not None and value_scale not in {"ratio_0_1", "percent_0_100"}:
        raise DatasetError("value_scale must be ratio_0_1 or percent_0_100.")
    if value_scale is not None and (target != "power_factor" or optional["measurement_unit"] != "%"):
        raise DatasetError("Power-factor value scale applies only to percentage-labelled power-factor mappings.")
    return {"source_column": source, "target_field": target, "expected_type": expected,
            "is_required": required, **optional, "value_scale": value_scale}


def _fingerprint(value: dict | list) -> str:
    return hashlib.sha256(_canonical_json(value).encode("utf-8")).hexdigest()


def _canonical_json(value) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _validation_issue_action(code: str) -> str:
    actions = {
        "invalid_number": "Check the source reading and confirm the selected numeric mapping; no value was converted.",
        "invalid_integer": "Check the source value and confirm whether an integer field is appropriate.",
        "invalid_boolean": "Review the source representation and map only documented true/false values.",
        "invalid_date": "Check the source date format and correct the mapping or source file.",
        "invalid_datetime": "Confirm the timestamp format and timezone represented by the source.",
        "timezone_missing": "Provide the source timezone before interpreting this timestamp.",
        "measurement_unit_missing": "Confirm the measurement unit from source documentation before review.",
        "measurement_unit_unrecognized": "Correct the unit mapping using documented source units.",
        "power_factor_percent_scale_review": "Confirm whether readings use a 0–1 ratio or 0–100 percent scale.",
        "power_factor_outside_confirmed_scale": "Recheck the source reading and the explicitly selected scale.",
        "optional_null_marker": "Confirm that this missing-reading marker is expected for the measurement.",
        "optional_value_missing": "Review whether the missing reading is acceptable for this source.",
        "required_null_marker": "Provide a valid required value or correct the source record.",
        "required_value_missing": "Provide the required value or correct the source record.",
        "unmapped_column": "Map this source field if it belongs in the dataset; unknown fields remain preserved.",
        "source_column_missing": "Select a source column that exists in this dataset version.",
        "malformed_dataset": "Correct the reported structural issue in the source file before validating again.",
    }
    return actions.get(code, "Review the source record and mapping; consult the original file using the row reference.")


def _row_count(profile: dict) -> int | None:
    value = profile.get("row_count")
    if value is None:
        value = profile.get("record_count")
    return value if isinstance(value, int) and value >= 0 else None


def _page(limit: int, offset: int) -> None:
    if not isinstance(limit, int) or not 1 <= limit <= 100 or not isinstance(offset, int) or offset < 0:
        raise DatasetError("limit must be 1–100 and offset must be nonnegative.")
