class PortfolioError(Exception):
    """Base class for domain-level failures."""


class NotFoundError(PortfolioError):
    pass


class InvalidTransactionError(PortfolioError):
    pass


class MarketDataError(PortfolioError):
    pass


class PortfolioBusyError(PortfolioError):
    pass
