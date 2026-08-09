from datetime import date
from decimal import Decimal
from unittest.mock import patch

import pandas as pd

from app.providers.yahoo import YahooFinanceProvider


def test_history_retries_without_repair_when_repaired_download_is_empty() -> None:
    empty = pd.DataFrame()
    fallback = pd.DataFrame(
        {("^NSEI", "Close"): [24570.650391]},
        index=[pd.Timestamp("2026-08-07")],
    )

    with patch("app.providers.yahoo.yf.download", side_effect=[empty, fallback]) as download:
        result = YahooFinanceProvider._history_sync(
            ["^NSEI"],
            date(2026, 8, 1),
            20,
        )

    assert result == {"^NSEI": {date(2026, 8, 7): Decimal("24570.650391")}}
    assert download.call_args_list[0].kwargs["repair"] is True
    assert download.call_args_list[1].kwargs["repair"] is False
