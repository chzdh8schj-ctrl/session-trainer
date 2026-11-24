"""Pydantic-модели запросов и ответов."""

from typing import Literal

from pydantic import BaseModel, Field


class LoginIn(BaseModel):
    password: str


class SubjectIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)


class SubjectPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)


class SubjectOut(BaseModel):
    id: str
    name: str
    created_at: str


class SubjectSummary(SubjectOut):
    tickets_count: int
    parts_count: int


class PartOut(BaseModel):
    id: str
    ticket_id: str
    title: str
    question: str
    options: list[str]
    correct_index: int
    note: str
    position: int


class PartIn(BaseModel):
    title: str = ""
    question: str = ""
    options: list[str] = Field(default_factory=list)
    correct_index: int = -1
    note: str = ""


class PartPatch(BaseModel):
    title: str | None = None
    question: str | None = None
    options: list[str] | None = None
    correct_index: int | None = None
    note: str | None = None


class TicketOut(BaseModel):
    id: str
    subject_id: str
    title: str
    question: str
    position: int
    created_at: str
    parts: list[PartOut]


class TicketIn(BaseModel):
    subject_id: str
    title: str = Field(min_length=1, max_length=300)
    question: str = Field(min_length=1)


class TicketPatch(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=300)
    question: str | None = Field(default=None, min_length=1)


class GenerateIn(BaseModel):
    force: bool = False


AiStatus = Literal["ok", "manual", "budget", "error"]


class TicketAiOut(TicketOut):
    ai_status: AiStatus
    ai_error: str | None = None


class AnswerIn(BaseModel):
    chosen_index: int


class AnswerOut(BaseModel):
    correct: bool
    correct_index: int
    note: str


class UsageOut(BaseModel):
    month: str
    requests: int
    prompt_tokens: int
    completion_tokens: int
    cost_rub: float
    limit_rub: float
    left_rub: float
    ai_enabled: bool


class SettingsOut(BaseModel):
    monthly_limit_rub: float
    ai_enabled: bool


class SettingsIn(BaseModel):
    monthly_limit_rub: float | None = Field(default=None, ge=0)
    ai_enabled: bool | None = None


class ExportPart(BaseModel):
    title: str
    question: str
    options: list[str]
    correct_index: int
    note: str


class ExportTicket(BaseModel):
    title: str
    question: str
    parts: list[ExportPart]


class ExportSubject(BaseModel):
    name: str
    tickets: list[ExportTicket]


class ExportOut(BaseModel):
    version: int = 1
    exported_at: str
    subjects: list[ExportSubject]


class ImportIn(BaseModel):
    replace: bool = False
    subjects: list[ExportSubject]


class ImportOut(BaseModel):
    subjects_created: int
    tickets_created: int
    parts_created: int
