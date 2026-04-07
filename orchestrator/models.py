from pydantic import BaseModel


# --- Auth ---
class RegisterRequest(BaseModel):
    email: str
    password: str
    display_name: str | None = None

class LoginRequest(BaseModel):
    email: str
    password: str

class UserResponse(BaseModel):
    id: int
    email: str
    display_name: str | None
    created_at: str

class AuthResponse(BaseModel):
    user: UserResponse
    token: str


# --- Reads ---
class CreateReadRequest(BaseModel):
    title: str
    content: str
    type: str = "text"
    source_url: str | None = None
    file_name: str | None = None

class UpdateReadRequest(BaseModel):
    title: str | None = None
    progress_segment: int | None = None
    progress_word: int | None = None

class SegmentResponse(BaseModel):
    id: int
    read_id: int
    segment_index: int
    text: str
    audio_generated: bool
    word_timings_json: str | None
    generated_at: str | None

class ReadSummary(BaseModel):
    id: int
    user_id: int
    title: str
    type: str
    source_url: str | None
    file_name: str | None
    progress_segment: int
    progress_word: int
    segment_count: int
    created_at: str
    updated_at: str
    voice: str | None = None
    engine: str | None = None
    generated_at: str | None = None

class ReadDetail(BaseModel):
    id: int
    user_id: int
    title: str
    type: str
    source_url: str | None
    file_name: str | None
    content: str
    progress_segment: int
    progress_word: int
    created_at: str
    updated_at: str
    voice: str | None = None
    engine: str | None = None
    generated_at: str | None = None
    segments: list[SegmentResponse]


# --- Bookmarks ---
class CreateBookmarkRequest(BaseModel):
    segment_index: int
    word_offset: int = 0
    note: str | None = None

class UpdateBookmarkRequest(BaseModel):
    note: str | None = None

class BookmarkResponse(BaseModel):
    id: int
    read_id: int
    segment_index: int
    word_offset: int
    note: str | None
    created_at: str


# --- Voices ---
class VoiceResponse(BaseModel):
    id: int
    user_id: int | None
    name: str
    type: str
    created_at: str


# --- Settings ---
class SettingsResponse(BaseModel):
    settings: dict[str, str]

class UpdateSettingsRequest(BaseModel):
    settings: dict[str, str]


# --- Health ---
class HealthResponse(BaseModel):
    status: str
    db: str
    active_engine: str | None
    alignment: str | None


# --- Backends ---
class BackendResponse(BaseModel):
    name: str
    display_name: str
    description: str
    size: str
    status: str
    gpu: bool
    builtin_voices: bool

class SelectBackendRequest(BaseModel):
    name: str


# --- Jobs ---
class GenerateRequest(BaseModel):
    voice: str
    language: str | None = None
    regenerate: bool = False

class JobResponse(BaseModel):
    id: int
    user_id: int
    read_id: int
    voice: str
    engine: str
    language: str | None
    status: str
    progress: int
    total: int
    error: str | None
    created_at: str
    started_at: str | None
    completed_at: str | None
