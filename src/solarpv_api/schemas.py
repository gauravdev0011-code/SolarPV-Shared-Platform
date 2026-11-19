"""Small response serializers for the ingestion API."""

from dataclasses import asdict
from typing import Annotated, Literal
from pydantic import BaseModel, ConfigDict, Field, StringConstraints


AssetText = Annotated[str, StringConstraints(strict=True, strip_whitespace=True, min_length=1, max_length=200)]
AssetNote = Annotated[str, StringConstraints(strict=True, max_length=2000)]


class AssetInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    asset_type: AssetText
    name: AssetText
    external_id: AssetText | None = None
    description: AssetNote = ""
    location: AssetNote = ""
    site_id: AssetText | None = None
    data_origin: Literal["unknown", "real", "synthetic"] = "unknown"


class AssetEdit(AssetInput):
    expected_revision: Annotated[str, StringConstraints(pattern=r"^[0-9a-f]{64}$")]


class AssetBulk(BaseModel):
    model_config = ConfigDict(extra="forbid")
    rows: list[AssetInput] = Field(min_length=1, max_length=100)


class AssetBulkCommit(AssetBulk):
    preview_revision: Annotated[str, StringConstraints(pattern=r"^[0-9a-f]{64}$")]


class EquipmentSpecification(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: AssetText
    value: AssetNote | None = None
    unit: Annotated[str, StringConstraints(strict=True, min_length=1, max_length=200)] | None = None


class EquipmentConfiguration(BaseModel):
    model_config = ConfigDict(extra="forbid")
    effective_from: AssetText
    expected_revision: AssetText | None = None
    equipment_kind: Literal['unknown','array','inverter','string','panel','other'] = 'unknown'
    parent_asset_id: int | None = Field(default=None, gt=0, strict=True)
    site_id: AssetText | None = None
    specifications: list[EquipmentSpecification] = Field(default_factory=list, max_length=100)
    source_reference: Annotated[str, StringConstraints(strict=True, strip_whitespace=True, min_length=1, max_length=2000)]


def source_response(source, *, duplicate: bool | None = None) -> dict:
    result = {
        "source_file_id": source.source_file_id,
        "workspace_id": source.workspace_id,
        "original_name": source.original_name,
        "media_type": source.media_type,
        "size_bytes": source.size_bytes,
        "sha256": source.sha256,
        "state": source.state.value,
    }
    if duplicate is not None:
        result["duplicate"] = duplicate
    return result


def job_response(status) -> dict:
    result = asdict(status)
    result["state"] = status.state.value
    result["result_available"] = status.artifact_id is not None and status.state.value == "succeeded"
    result.pop("artifact_id", None)
    return result
