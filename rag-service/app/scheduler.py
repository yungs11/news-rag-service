import logging
from datetime import datetime, timezone

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

from app.services.news_collector import CollectionResult

logger = logging.getLogger(__name__)

scheduler = AsyncIOScheduler()

# 마지막 수집 결과를 메모리에 보관 (상태 조회용)
_last_run: str | None = None
_last_results: list[CollectionResult] = []

# 수집 이력 (최근 50건)
_collection_logs: list[dict] = []

# 클린업 이력 (최근 30일분)
_cleanup_history: list[dict] = []


def get_last_status() -> tuple[str | None, list[CollectionResult]]:
    return _last_run, _last_results


def set_last_status(results: list[CollectionResult]) -> None:
    global _last_run, _last_results
    _last_run = datetime.now(timezone.utc).isoformat(timespec="seconds")
    _last_results = results
    # 수집 로그 기록
    _collection_logs.append({
        "timestamp": _last_run,
        "sources": [r.to_dict() for r in results],
    })
    if len(_collection_logs) > 50:
        _collection_logs.pop(0)


def get_collection_logs() -> list[dict]:
    return _collection_logs


def get_cleanup_history() -> list[dict]:
    return _cleanup_history


def add_cleanup_result(deleted: int, protected: int, active: int) -> None:
    _cleanup_history.append({
        "date": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "deleted": deleted,
        "protected": protected,
        "active": active,
    })
    # 최근 30건만 유지
    if len(_cleanup_history) > 30:
        _cleanup_history.pop(0)


def setup_scheduler(cron_hours: str, job_func, **job_kwargs) -> None:
    hours = cron_hours.strip()
    trigger = CronTrigger(hour=hours, timezone="Asia/Seoul")
    scheduler.add_job(
        job_func,
        trigger,
        id="news_collector",
        replace_existing=True,
        kwargs=job_kwargs,
    )
    logger.info("Scheduler configured: collector cron hours=%s (KST)", hours)


def setup_cleanup_job(job_func, start_date: str | None = None, **job_kwargs) -> None:
    from datetime import datetime as _dt
    trigger = CronTrigger(hour="3", timezone="Asia/Seoul")
    # start_date 이전에는 실행하지 않음
    next_run = None
    if start_date:
        next_run = _dt.fromisoformat(start_date)
    scheduler.add_job(
        job_func,
        trigger,
        id="cleanup",
        replace_existing=True,
        kwargs=job_kwargs,
        next_run_time=next_run,
    )
    if start_date:
        logger.info("Scheduler configured: cleanup at 03:00 KST, starting from %s", start_date)
    else:
        logger.info("Scheduler configured: cleanup at 03:00 KST")


def setup_tombstone_sweep_job(job_func, **job_kwargs) -> None:
    """연 1회 tombstone 일괄 삭제. 매년 1월 1일 04:00 KST."""
    trigger = CronTrigger(month="1", day="1", hour="4", timezone="Asia/Seoul")
    scheduler.add_job(
        job_func,
        trigger,
        id="tombstone_sweep",
        replace_existing=True,
        kwargs=job_kwargs,
    )
    logger.info("Scheduler configured: tombstone sweep yearly at Jan 1 04:00 KST")


def start() -> None:
    if not scheduler.running:
        scheduler.start()
        logger.info("Scheduler started")


def shutdown() -> None:
    if scheduler.running:
        scheduler.shutdown(wait=False)
        logger.info("Scheduler shut down")
