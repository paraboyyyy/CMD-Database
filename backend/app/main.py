from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .db import init_db
from .routers import builder, elements, kpath, materials, symmetry


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    yield


app = FastAPI(
    title="CMD Labs API",
    description="Search crystal structures and material properties; analyze crystal symmetry.",
    version="0.1.0",
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(builder.router)
app.include_router(elements.router)
app.include_router(kpath.router)
app.include_router(materials.router)
app.include_router(symmetry.router)


@app.get("/api/health", tags=["meta"])
def health() -> dict:
    return {"status": "ok"}
