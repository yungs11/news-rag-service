import logging
from datetime import datetime

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

from app.services.news_collector import CollectionResult

logger = logging.getLogger(__name__)

scheduler = AsyncIOScheduler()

# 마지막 수집 결과를 메모리에 보관 (상태 조회용)
_last_run: str | None = None
_last_results: list[CollectionResult] = []


def get_last_status() -> tuple[str | None, list[CollectionResult]]:
    return _last_run, _last_results


def set_last_status(results: list[CollectionResult]) -> None:
    global _last_run, _last_results
    _last_run = datetime.now().isoformat(timespec="seconds")
    _last_results = results


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
    logger.info("Scheduler configured: cron hours=%s (KST)", hours)


def start() -> None:
    if not scheduler.running:
        scheduler.start()
        logger.info("Scheduler started")


def shutdown() -> None:
    if scheduler.running:
        scheduler.shutdown(wait=False)
        logger.info("Scheduler shut down")
